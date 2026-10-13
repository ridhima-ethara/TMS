#!/usr/bin/env bash
# SonarQube analysis of the codebase, run fully local and torn down afterwards.
#
#   npm run security:sonar
#
# Starts SonarQube Community and the scanner in Docker with tight memory caps,
# analyses the code, saves the issues and security hotspots to
# security/reports/<date>/sonarqube.json, then removes every container and
# volume it created. A watchdog stops everything if the host runs low on free
# memory, so a live server sharing the machine keeps priority.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAY="$(date -u +%Y-%m-%d)"
OUT="$ROOT/security/reports/$DAY"
mkdir -p "$OUT"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
NET="tms-sonar-net"; SQ="tms-sonarqube"; PORT=19000
MIN_FREE_MB="${SONAR_MIN_FREE_MB:-350}"
KEY="ethara-service-hub"

cleanup() {
  [ -n "${WATCH_PID:-}" ] && kill "$WATCH_PID" 2>/dev/null
  $DOCKER rm -f "$SQ" tms-sonar-scanner >/dev/null 2>&1
  $DOCKER network rm "$NET" >/dev/null 2>&1
}
trap cleanup EXIT

free_mb() { awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo; }
if [ "$(free_mb)" -lt 900 ]; then
  echo "Only $(free_mb) MB free memory — not starting SonarQube. Try again when the host is quieter."
  exit 1
fi

$DOCKER network create "$NET" >/dev/null 2>&1
$DOCKER run -d --name "$SQ" --network "$NET" --memory 1400m --cpus 1 \
  -p "127.0.0.1:$PORT:9000" \
  -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
  -e SONAR_WEB_JAVAOPTS="-Xmx256m -Xms128m" \
  -e SONAR_CE_JAVAOPTS="-Xmx384m -Xms128m" \
  -e SONAR_SEARCH_JAVAOPTS="-Xmx384m -Xms384m" \
  -e SONAR_TELEMETRY_ENABLE=false \
  sonarqube:community >/dev/null || { echo "Could not start SonarQube"; exit 1; }

# Watchdog: abort if the host gets too tight on memory.
( while sleep 5; do
    if [ "$(free_mb)" -lt "$MIN_FREE_MB" ]; then
      echo "Free memory below ${MIN_FREE_MB} MB — stopping SonarQube to protect the host." >&2
      $DOCKER rm -f "$SQ" tms-sonar-scanner >/dev/null 2>&1; exit 0
    fi
  done ) & WATCH_PID=$!

echo "Waiting for SonarQube to start..."
for _ in $(seq 1 120); do
  status=$(curl -s "http://127.0.0.1:$PORT/api/system/status" | sed -n 's/.*"status":"\([A-Z]*\)".*/\1/p')
  [ "$status" = "UP" ] && break
  $DOCKER ps -q -f name="$SQ" | grep -q . || { echo "SonarQube stopped"; exit 1; }
  sleep 5
done
[ "$status" = "UP" ] || { echo "SonarQube did not become ready"; exit 1; }

# Throwaway instance: replace the default admin password, then mint a token.
ADMIN_PW="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)Aa1!"
# admin:admin is SonarQube's public first-boot default on this throwaway local container; it is replaced immediately.
curl -s -u admin:admin -X POST "http://127.0.0.1:$PORT/api/users/change_password" --data-urlencode login=admin --data-urlencode previousPassword=admin --data-urlencode "password=$ADMIN_PW" >/dev/null # gitleaks:allow
TOKEN=$(curl -s -u "admin:$ADMIN_PW" -X POST "http://127.0.0.1:$PORT/api/user_tokens/generate" \
  --data-urlencode name=scan --data-urlencode type=GLOBAL_ANALYSIS_TOKEN | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "Could not create a SonarQube token"; exit 1; }

echo "Analysing the codebase..."
$DOCKER run --rm --name tms-sonar-scanner --network "$NET" --memory 1100m --cpus 1 \
  -e SONAR_HOST_URL="http://$SQ:9000" -e SONAR_TOKEN="$TOKEN" \
  -e SONAR_SCANNER_OPTS="-Xmx384m" \
  -v "$ROOT:/usr/src" sonarsource/sonar-scanner-cli \
  -Dsonar.javascript.node.maxspace=768 -Dsonar.scm.disabled=true \
  > "$OUT/sonar-scanner.log" 2>&1 || { echo "Scanner failed — see $OUT/sonar-scanner.log"; tail -20 "$OUT/sonar-scanner.log"; exit 1; }

echo "Waiting for SonarQube to process the analysis..."
for _ in $(seq 1 120); do
  q=$(curl -s -u "admin:$ADMIN_PW" "http://127.0.0.1:$PORT/api/ce/component?component=$KEY")
  echo "$q" | grep -q '"queue":\[\]' && echo "$q" | grep -q '"current":{[^}]*"status":"SUCCESS"' && break
  sleep 5
done

python3 - "$PORT" "$ADMIN_PW" "$KEY" "$OUT/sonarqube.json" <<'PY'
import base64, json, sys, urllib.request
port, pw, key, out = sys.argv[1:]
auth = "Basic " + base64.b64encode(f"admin:{pw}".encode()).decode()
def get(path):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers={"Authorization": auth})
    return json.load(urllib.request.urlopen(req))
issues, page = [], 1
while True:
    d = get(f"/api/issues/search?componentKeys={key}&resolved=false&ps=500&p={page}")
    issues += d["issues"]
    if page * 500 >= d["paging"]["total"] or page >= 20: break
    page += 1
hotspots = get(f"/api/hotspots/search?projectKey={key}&ps=500").get("hotspots", [])
measures = get(f"/api/measures/component?component={key}&metricKeys=ncloc,bugs,vulnerabilities,security_hotspots,code_smells,duplicated_lines_density,security_rating,reliability_rating,sqale_rating").get("component", {}).get("measures", [])
json.dump({"issues": issues, "hotspots": hotspots, "measures": measures}, open(out, "w"), indent=1)
print(f"SonarQube: {len(issues)} open issues, {len(hotspots)} security hotspots")
PY
echo "Saved $OUT/sonarqube.json"
