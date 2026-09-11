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
trap cleanup_smoke EXIT

say "1/5 Building into $STAGE (live site untouched)"
rm -rf "$STAGE"
NEXT_DIST_DIR="$STAGE" npx next build
NEXT_DIST_DIR="$STAGE" node scripts/prepare-standalone.mjs

say "2/5 Smoke-testing the new build on port $SMOKE_PORT"
# The standalone server chdir()s to its own directory and resolves distDir
# relative to that, so the staged tree runs as-is from where it was built.
HOSTNAME=127.0.0.1 PORT="$SMOKE_PORT" \
  node --env-file="$APP_DIR/.env.local" "$STAGE/standalone/server.js" \
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
