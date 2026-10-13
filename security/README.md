# Security scanning

Six scanners cover the frontend, backend, dependencies, secrets and Docker files.

| Tool | Checks | Config |
| --- | --- | --- |
| Gitleaks | Secrets in git history and tracked files | `.gitleaks.toml` |
| Trivy | npm dependency CVEs, Dockerfile misconfiguration, secrets | `.trivyignore.yaml` (accepted risks, with expiry) |
| Semgrep | Insecure code patterns: JS/Node/React/Next.js, OWASP Top 10, JWT, SQL injection, XSS | `.semgrepignore` |
| Bandit | Python code (`tests/`, root `*_test.py`) | `security/bandit.yaml` |
| Hadolint | Dockerfiles (`docker/db/Dockerfile`) | `.hadolint.yaml` |
| SonarQube | Bugs, vulnerabilities, security hotspots, code smells | `sonar-project.properties` |

## Run

```bash
npm run security:scan    # Gitleaks, Trivy, Semgrep, Bandit, Hadolint, npm audit
npm run security:sonar   # SonarQube in Docker (needs ~1.5 GB free RAM); then re-run security:scan to include it
```

Tools install themselves into `security/.tools/` on first run (pinned versions;
git-ignored). Reports land in `security/reports/<date>/` (git-ignored);
`SUMMARY.md` there lists every finding by tool, severity (Critical / High /
Medium / Low) and area (Frontend / Backend / Shared / Dependencies / Docker).

Everything runs at the lowest CPU/IO priority. The SonarQube script refuses to
start below 900 MB free memory and stops itself if free memory drops under
350 MB, then removes all of its containers.

## Accepting a risk

Add it to `.trivyignore.yaml` (dependencies) with a `statement` explaining why
and an `expired_at` date so it is reviewed again. Do not silence findings
without a written reason.
