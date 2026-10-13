#!/usr/bin/env bash
#
# Safe production deploy.
#
# The failure this prevents: `next build` writes straight into .next-build,
# which is the directory the running server reads from. Client chunks are
# content-hashed, so the moment a build finishes, the live process is still
# serving HTML that references chunk filenames the build has just deleted.
# Every page load then fails with "The application could not load" until the
# service is restarted -- and if the restart does not happen, the site stays
# broken with a green build.
#
# So: build into a staging directory, prove it serves, and only then swap it
# into place and restart. The live tree is untouched until the new one works,
# and a failed health check rolls straight back.
set -euo pipefail

APP_DIR="/home/ec2-user/TMS/TMS/TMS"
LIVE=".next-build"
STAGE=".next-stage"
PREV=".next-build.prev"
SERVICE="tms.service"
SMOKE_PORT="${SMOKE_PORT:-3021}"
LIVE_URL="http://127.0.0.1:3010"

cd "$APP_DIR"
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

cleanup_smoke() {
  if [[ -n "${SMOKE_PID:-}" ]] && kill -0 "$SMOKE_PID" 2>/dev/null; then
    kill "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
  fi
}
cleanup() { cleanup_smoke; rm -f "$DEPLOY_LOCK"; }
trap cleanup EXIT

# Resource fence. This host has 2 vCPUs and ~3.7 GB RAM shared with the live
# server; an unfenced `next build` once exhausted memory and froze the whole
# instance (2026-09-28). The build runs in its own cgroup capped at one core
# and BUILD_MEM_MAX, at the lowest CPU/IO priority, so the live site always
# keeps a core and its memory. tms-guard.service throttles or kills the build
# if the host still gets tight.
BUILD_CPU_QUOTA="${BUILD_CPU_QUOTA:-100%}"
BUILD_MEM_HIGH="${BUILD_MEM_HIGH:-1600M}"
BUILD_MEM_MAX="${BUILD_MEM_MAX:-2200M}"
MIN_FREE_MB="${MIN_FREE_MB:-900}"
DEPLOY_LOCK="/tmp/tms-deploy.lock"

fenced() {
  # Args: the full command to run (including any leading VAR=value env
  # assignments understood by `env`). Runs it in a transient systemd scope
  # capped at one core / BUILD_MEM_MAX at the lowest CPU+IO priority so the
  # live server always keeps a core and its memory.
  #
  # NOTE: the command MUST be passed as ordinary positional arguments. A bash
  # array-assignment command prefix (FOO=(a b) fenced ...) does not create a
  # usable array inside the callee on bash 5.x -- it arrives as the single
  # literal token "(a b)", which then fails to exec. That was the 2026-09-28
  # deploy breakage; do not reintroduce it.
  sudo systemd-run --quiet --scope --unit="tms-build-$$-$RANDOM" \
    -p CPUQuota="$BUILD_CPU_QUOTA" -p CPUWeight=20 \
    -p MemoryHigh="$BUILD_MEM_HIGH" -p MemoryMax="$BUILD_MEM_MAX" \
    --uid="$(id -u)" --gid="$(id -g)" \
    nice -n 19 ionice -c 3 \
    env HOME="$HOME" PATH="$PATH" NODE_OPTIONS="--max-old-space-size=1536" "$@"
}

mem_avail_mb() { awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo; }

if [[ -e "$DEPLOY_LOCK" ]] && kill -0 "$(cat "$DEPLOY_LOCK")" 2>/dev/null; then
  echo "Another deploy (pid $(cat "$DEPLOY_LOCK")) is running. Aborting." >&2; exit 1
fi
echo $$ > "$DEPLOY_LOCK"

say "0/5 Pre-flight: waiting for ${MIN_FREE_MB}MB free memory"
for i in $(seq 1 60); do
  (( $(mem_avail_mb) >= MIN_FREE_MB )) && break
  (( i == 60 )) && { echo "Only $(mem_avail_mb)MB available after 5 min -- not building now. Live site untouched." >&2; exit 1; }
  sleep 5
done
echo "Memory available: $(mem_avail_mb)MB, load: $(cut -d' ' -f1-3 /proc/loadavg)"

say "1/5 Building into $STAGE (live site untouched)"
rm -rf "$STAGE"
fenced NEXT_DIST_DIR="$STAGE" NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build
NEXT_DIST_DIR="$STAGE" nice -n 19 node scripts/prepare-standalone.mjs

say "2/5 Smoke-testing the new build on port $SMOKE_PORT"
# The standalone server chdir()s to its own directory and resolves distDir
# relative to that, so the staged tree runs as-is from where it was built.
HOSTNAME=127.0.0.1 PORT="$SMOKE_PORT" \
  nice -n 19 node --max-old-space-size=512 --env-file="$APP_DIR/.env.local" "$STAGE/standalone/server.js" \
  >/tmp/tms-smoke.log 2>&1 &
SMOKE_PID=$!

smoke_ok=false
for _ in $(seq 1 40); do
  sleep 1
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/" || true)
  if [[ "$code" == "200" ]]; then
    chunk=$(curl -s "http://127.0.0.1:$SMOKE_PORT/" \
      | grep -oE 'static/chunks/app/page-[a-z0-9]+\.js' | head -1 || true)
    # The page is useless without its main chunk -- this is the exact
    # condition that broke the site before, so it is checked explicitly.
    if [[ -n "$chunk" ]]; then
      ccode=$(curl -s -o /dev/null -w '%{http_code}' \
        "http://127.0.0.1:$SMOKE_PORT/_next/$chunk" || true)
      [[ "$ccode" == "200" ]] && smoke_ok=true && break
    fi
  fi
done

if [[ "$smoke_ok" != true ]]; then
  echo "Smoke test FAILED -- staged build not served correctly. Live site untouched." >&2
  tail -20 /tmp/tms-smoke.log >&2 || true
  exit 1
fi
echo "Staged build serves page + main chunk."
cleanup_smoke
unset SMOKE_PID

say "3/5 Swapping $STAGE into $LIVE"
rm -rf "$PREV"
[[ -d "$LIVE" ]] && mv "$LIVE" "$PREV"
mv "$STAGE" "$LIVE"

say "4/5 Restarting $SERVICE"
if ! sudo systemctl restart "$SERVICE"; then
  echo "Restart failed -- rolling back." >&2
  rm -rf "$LIVE"; mv "$PREV" "$LIVE"
  sudo systemctl restart "$SERVICE" || true
  exit 1
fi

say "5/5 Verifying the live site"
live_ok=false
for _ in $(seq 1 30); do
  sleep 1
  code=$(curl -s -o /dev/null -w '%{http_code}' "$LIVE_URL/" || true)
  if [[ "$code" == "200" ]]; then
    chunk=$(curl -s "$LIVE_URL/" \
      | grep -oE 'static/chunks/app/page-[a-z0-9]+\.js' | head -1 || true)
    if [[ -n "$chunk" ]]; then
      ccode=$(curl -s -o /dev/null -w '%{http_code}' "$LIVE_URL/_next/$chunk" || true)
      [[ "$ccode" == "200" ]] && live_ok=true && break
    fi
  fi
done

if [[ "$live_ok" != true ]]; then
  echo "Live health check FAILED -- rolling back to previous build." >&2
  rm -rf "$LIVE"; mv "$PREV" "$LIVE"
  sudo systemctl restart "$SERVICE"
  exit 1
fi

echo
echo "Deployed. BUILD_ID $(cat "$LIVE/BUILD_ID"). Previous build kept in $PREV."
