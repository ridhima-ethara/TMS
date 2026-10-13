#!/usr/bin/env bash
# Security scan for the Ethara Service Hub codebase.
#
#   npm run security:scan            # Gitleaks, Trivy, Semgrep, Bandit, Hadolint, npm audit
#   npm run security:sonar           # SonarQube (separate: needs Docker and ~1.5 GB RAM)
#
# Tools are downloaded once into security/.tools (git-ignored) at pinned
# versions. Reports go to security/reports/<date>/ (git-ignored), with a
# SUMMARY.md that splits findings by tool, severity and frontend/backend.
# Everything runs at the lowest CPU/IO priority so a live server keeps serving.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEC="$ROOT/security"
TOOLS="$SEC/.tools"
DAY="$(date -u +%Y-%m-%d)"
OUT="$SEC/reports/$DAY"
mkdir -p "$TOOLS/bin" "$OUT"
cd "$ROOT"
low() { nice -n 19 ionice -c 3 "$@"; }

GITLEAKS_VERSION=8.30.1
TRIVY_VERSION=0.75.0
HADOLINT_VERSION=2.15.1
BANDIT_VERSION=1.9.4
SEMGREP_VERSION=1.180.0

install_tools() {
  local b="$TOOLS/bin"
  if [ ! -x "$b/gitleaks" ]; then
    echo "Installing Gitleaks $GITLEAKS_VERSION"
    curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar -xz -C "$b" gitleaks
  fi
  if [ ! -x "$b/trivy" ]; then
    echo "Installing Trivy $TRIVY_VERSION"
    curl -sSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" | tar -xz -C "$b" trivy
  fi
  if [ ! -x "$b/hadolint" ]; then
    echo "Installing Hadolint $HADOLINT_VERSION"
    curl -sSL -o "$b/hadolint" "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-Linux-x86_64"
    chmod +x "$b/hadolint"
  fi
  if [ ! -x "$TOOLS/venv/bin/semgrep" ] || [ ! -x "$TOOLS/venv/bin/bandit" ]; then
    echo "Installing Bandit $BANDIT_VERSION and Semgrep $SEMGREP_VERSION"
    PY="$(command -v python3.11 || command -v python3)"
    "$PY" -m venv "$TOOLS/venv"
    "$TOOLS/venv/bin/pip" install -q "bandit==$BANDIT_VERSION" "semgrep==$SEMGREP_VERSION"
  fi
}

install_tools
B="$TOOLS/bin"; V="$TOOLS/venv/bin"
SOURCE_DIRS=(app components hooks lib scripts tests docker)

echo "== Gitleaks: secrets in git history and in tracked source files"
low "$B/gitleaks" git "$ROOT" --config "$ROOT/.gitleaks.toml" --redact --no-banner \
  --report-format json --report-path "$OUT/gitleaks-history.json" >/dev/null 2>&1
low "$B/gitleaks" dir "$ROOT" --config "$ROOT/.gitleaks.toml" --redact --no-banner --max-target-megabytes 5 \
  --report-format json --report-path "$OUT/gitleaks-files.json" >/dev/null 2>&1

echo "== Trivy: npm dependency CVEs, misconfiguration (Dockerfile), secrets"
low "$B/trivy" fs --quiet --cache-dir "$TOOLS/trivy-cache" --scanners vuln,misconfig,secret \
  --ignorefile "$ROOT/.trivyignore.yaml" \
  --skip-dirs node_modules --skip-dirs .next --skip-dirs .next-build --skip-dirs .next-build.prev \
  --skip-dirs .next-stage --skip-dirs security/.tools --skip-dirs security/reports \
  --format json --output "$OUT/trivy.json" .

echo "== Semgrep: insecure code patterns (JS/Node/React/Next.js, OWASP Top 10, JWT, SQLi, XSS, secrets)"
SEMGREP_SEND_METRICS=off low "$V/semgrep" scan --metrics=off --quiet --jobs 1 --max-memory 900 --timeout 60 \
  --config p/javascript --config p/nodejs --config p/react --config p/nextjs --config p/owasp-top-ten \
  --config p/jwt --config p/sql-injection --config p/xss --config p/secrets --config p/dockerfile \
  --json -o "$OUT/semgrep.json" "${SOURCE_DIRS[@]}" >/dev/null 2>&1

echo "== Bandit: Python code"
low "$V/bandit" -q -c "$ROOT/security/bandit.yaml" -r tests *.py -f json -o "$OUT/bandit.json" 2>/dev/null

echo "== Hadolint: Dockerfiles"
# Every Dockerfile in the project, tracked or not, so new files are linted before they are committed.
mapfile -t DOCKERFILES < <(find . -name '*Dockerfile*' -not -path './node_modules/*' -not -path './.next*' -not -path './security/.tools/*' | sort)
if [ "${#DOCKERFILES[@]}" -gt 0 ]; then
  "$B/hadolint" --config "$ROOT/.hadolint.yaml" -f json "${DOCKERFILES[@]}" > "$OUT/hadolint.json" || true
else
  echo "[]" > "$OUT/hadolint.json"
fi

echo "== npm audit (cross-check of dependency advisories)"
npm audit --json > "$OUT/npm-audit.json" 2>/dev/null || true

"$V/python" "$SEC/summarize.py" "$OUT" ${SONAR_JSON:+"$SONAR_JSON"}
echo
echo "Reports: $OUT"
echo "Summary: $OUT/SUMMARY.md"
