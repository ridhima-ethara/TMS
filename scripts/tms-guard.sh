#!/usr/bin/env bash
#
# Resource guard for the TMS host (runs as tms-guard.service, root).
#
# This 2-vCPU / 3.7 GB box froze on 2026-09-28 05:34 when a `next build` ran
# next to the live server, the editor server and Postgres: memory ran out, the
# kernel thrashed (major faults 0.1/s -> 18/s), CPU pegged on reclaim and the
# instance had to be force-stopped. This loop watches CPU, memory and the live
# site every few seconds and sacrifices the *build*, never the platform:
#
#   CPU >= CPU_HIGH% sustained   -> renice/ionice any build to the lowest priority
#   MemAvailable < MEM_LOW_MB    -> same, plus warn
#   MemAvailable < MEM_CRIT_MB   -> kill the running build (live site keeps serving)
#   live site fails HEALTH_FAILS checks in a row (outside a deploy) -> restart tms
#
# Logs go to the journal:  journalctl -u tms-guard -f
set -uo pipefail

INTERVAL="${INTERVAL:-5}"
CPU_HIGH="${CPU_HIGH:-85}"
CPU_SUSTAIN="${CPU_SUSTAIN:-3}"
MEM_LOW_MB="${MEM_LOW_MB:-600}"
MEM_CRIT_MB="${MEM_CRIT_MB:-300}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3010/}"
HEALTH_EVERY="${HEALTH_EVERY:-6}"     # samples between health checks (~30s)
HEALTH_FAILS="${HEALTH_FAILS:-3}"
STATUS_EVERY="${STATUS_EVERY:-60}"    # samples between status lines (~5min)
DEPLOY_LOCK="/tmp/tms-deploy.lock"

log() { echo "[$1] $2"; }

read_cpu() { read -r _ u n s i w q sq st _ < /proc/stat; echo "$((u+n+s+q+sq+st)) $((i+w))"; }
mem_avail_mb() { awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo; }
swap_used_mb() { awk '/^SwapTotal:/ {t=$2} /^SwapFree:/ {f=$2} END {print int((t-f)/1024)}' /proc/meminfo; }

# PIDs of any production build: deploy.sh's tms-build-* scopes, plus a bare
# `next build` someone started by hand, plus all their descendants.
build_pids() {
  local roots=() unit
  for unit in $(systemctl list-units --plain --no-legend --state=active 'tms-build-*' 2>/dev/null | awk '{print $1}'); do
    roots+=($(cat "/sys/fs/cgroup/system.slice/$unit/cgroup.procs" 2>/dev/null))
  done
  roots+=($(pgrep -f 'next(/dist/bin/next)? build' 2>/dev/null))
  local queue=("${roots[@]}") seen=" " p
  while (( ${#queue[@]} )); do
    p=${queue[0]}; queue=("${queue[@]:1}")
    [[ -z "$p" || "$seen" == *" $p "* ]] && continue
    seen+="$p "; echo "$p"
    queue+=($(pgrep -P "$p" 2>/dev/null))
  done
}

throttle_build() {
  local pids; pids=$(build_pids | tr '\n' ' ')
  [[ -z "${pids// }" ]] && return 1
  renice -n 19 -p $pids >/dev/null 2>&1
  ionice -c 3 -p $pids >/dev/null 2>&1
  return 0
}

kill_build() {
  local pids; pids=$(build_pids | tr '\n' ' ')
  [[ -z "${pids// }" ]] && return 1
  systemctl kill --signal=KILL 'tms-build-*' >/dev/null 2>&1
  kill -KILL $pids 2>/dev/null
  return 0
}

top_procs() { ps -eo pid,%cpu,rss,comm --sort=-rss | head -6 | awk 'NR>1 {printf "%s(%s,%dMB,%s%%) ", $4,$1,$3/1024,$2}'; }

read -r prev_busy prev_idle < <(read_cpu)
hot=0; n=0; health_bad=0; throttled=0

log INFO "tms-guard started: cpu>=${CPU_HIGH}% x${CPU_SUSTAIN}, mem low<${MEM_LOW_MB}MB crit<${MEM_CRIT_MB}MB"

while sleep "$INTERVAL"; do
  n=$((n+1))
  read -r busy idle < <(read_cpu)
  db=$((busy-prev_busy)); di=$((idle-prev_idle)); prev_busy=$busy; prev_idle=$idle
  cpu=$(( (db+di) > 0 ? 100*db/(db+di) : 0 ))
  mem=$(mem_avail_mb); swp=$(swap_used_mb)
  load=$(cut -d' ' -f1 /proc/loadavg)
  building=false; [[ -n "$(build_pids)" ]] && building=true

  (( cpu >= CPU_HIGH )) && hot=$((hot+1)) || hot=0

  if (( mem < MEM_CRIT_MB )); then
    if $building && kill_build; then
      log CRIT "mem_avail=${mem}MB < ${MEM_CRIT_MB}MB during build -> build KILLED to protect platform. Re-run deploy when load is lower."
    else
      log CRIT "mem_avail=${mem}MB swap_used=${swp}MB cpu=${cpu}% load=${load} top: $(top_procs)"
    fi
  elif (( mem < MEM_LOW_MB )) || (( hot >= CPU_SUSTAIN )); then
    if $building && throttle_build; then
      (( throttled == 0 )) && log WARN "cpu=${cpu}% mem_avail=${mem}MB load=${load} -> build throttled to lowest CPU/IO priority"
      throttled=1
    else
      (( hot == CPU_SUSTAIN || (n % 12 == 0) )) && log WARN "cpu=${cpu}% mem_avail=${mem}MB swap_used=${swp}MB load=${load} top: $(top_procs)"
    fi
  fi
  $building || throttled=0

  if (( n % HEALTH_EVERY == 0 )); then
    code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$HEALTH_URL" || true)
    if [[ "$code" == "200" ]]; then
      health_bad=0
    elif [[ -e "$DEPLOY_LOCK" ]] || [[ "$(systemctl is-active tms.service)" == "activating" ]]; then
      health_bad=0   # deploy in progress / service starting: expected blip
    else
      health_bad=$((health_bad+1))
      log WARN "live site returned '${code}' (${health_bad}/${HEALTH_FAILS})"
      if (( health_bad >= HEALTH_FAILS )); then
        log CRIT "live site down ${HEALTH_FAILS} checks in a row -> restarting tms.service"
        systemctl restart tms.service; health_bad=0
      fi
    fi
  fi

  (( n % STATUS_EVERY == 0 )) && log INFO "cpu=${cpu}% mem_avail=${mem}MB swap_used=${swp}MB load=${load} build=${building}"
done
