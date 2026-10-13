"""Builds SUMMARY.md from the raw reports written by security/scan.sh.

Every finding is normalised to Critical / High / Medium / Low and tagged with
the part of the codebase it lives in (frontend, backend, shared, dependencies,
docker) so the result reads as one table per tool.
"""
import json
import os
import stat
import sys
from collections import Counter, defaultdict

OUT = sys.argv[1]
SONAR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(OUT, "sonarqube.json")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LEVELS = ["Critical", "High", "Medium", "Low"]


def area(path):
    p = path.replace(ROOT + "/", "").lstrip("./")
    if p.startswith("app/api/") or p in ("lib/postgres-document-db.js",) or p.startswith(("scripts/", "tests/")) or p.endswith(".py"):
        return "Backend"
    if p.startswith(("components/", "hooks/")) or p.startswith("app/") or p in ("lib/appapi.js", "lib/utils.js"):
        return "Frontend"
    if p.startswith("lib/"):
        return "Shared"
    if p in ("package.json", "package-lock.json"):
        return "Dependencies"
    if p.startswith("docker/") or "Dockerfile" in p:
        return "Docker"
    return "Repo"


def load(name, default=None):
    try:
        with open(os.path.join(OUT, name)) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


findings = []  # (tool, level, area, rule, location, message)


def add(tool, level, path, rule, line, message):
    findings.append((tool, level, area(path), rule, f"{path.replace(ROOT + '/', '')}{':' + str(line) if line else ''}", message))


# Bandit
for r in (load("bandit.json", {}) or {}).get("results", []):
    lvl = {"HIGH": "High", "MEDIUM": "Medium", "LOW": "Low"}[r["issue_severity"]]
    add("Bandit", lvl, r["filename"], r["test_id"], r["line_number"], r["issue_text"])

# Semgrep
for r in (load("semgrep.json", {}) or {}).get("results", []):
    lvl = {"ERROR": "High", "WARNING": "Medium", "INFO": "Low"}.get(r["extra"]["severity"], "Low")
    add("Semgrep", lvl, r["path"], r["check_id"].split(".")[-1], r["start"]["line"], r["extra"]["message"].split("\n")[0][:140])

# Gitleaks (every unallowlisted secret is High)
for name, label in (("gitleaks-history.json", "git history"), ("gitleaks-files.json", "tracked files")):
    for r in load(name, []) or []:
        add("Gitleaks", "High", r["File"], r["RuleID"], r.get("StartLine"), f"Possible secret in {label}")

# Hadolint
for r in load("hadolint.json", []) or []:
    lvl = {"error": "High", "warning": "Medium"}.get(r["level"], "Low")
    add("Hadolint", lvl, r["file"], r["code"], r["line"], r["message"])

# Trivy
for res in (load("trivy.json", {}) or {}).get("Results", []):
    for v in res.get("Vulnerabilities") or []:
        add("Trivy", v["Severity"].title(), res["Target"], v["VulnerabilityID"], None,
            f"{v['PkgName']} {v.get('InstalledVersion')} -> {v.get('FixedVersion') or 'no fix'}: {(v.get('Title') or '')[:90]}")
    for m in res.get("Misconfigurations") or []:
        if m.get("Status") == "FAIL":
            add("Trivy", m["Severity"].title(), res["Target"], m["ID"], None, m.get("Title", ""))
    for s in res.get("Secrets") or []:
        add("Trivy", s["Severity"].title(), res["Target"], s["RuleID"], s.get("StartLine"), s.get("Title", "secret"))

# SonarQube (optional, written by security/sonar-scan.sh)
sonar = None
try:
    with open(SONAR) as fh:
        sonar = json.load(fh)
except (OSError, ValueError):
    pass
if sonar:
    sev = {"BLOCKER": "Critical", "CRITICAL": "High", "MAJOR": "Medium", "MINOR": "Low", "INFO": "Low"}
    for i in sonar.get("issues", []):
        path = i["component"].split(":", 1)[-1]
        kind = i.get("type", "")
        add("SonarQube", sev.get(i.get("severity"), "Low"), path, f"{kind}:{i['rule']}", i.get("line"), i.get("message", "")[:140])
    hp = {"HIGH": "High", "MEDIUM": "Medium", "LOW": "Low"}
    for h in sonar.get("hotspots", []):
        path = h["component"].split(":", 1)[-1]
        add("SonarQube", hp.get(h.get("vulnerabilityProbability"), "Low"), path, f"HOTSPOT:{h.get('ruleKey')}", h.get("line"), h.get("message", "")[:140])

tools = ["Bandit", "Semgrep", "Gitleaks", "Hadolint", "Trivy", "SonarQube"]
by_tool = defaultdict(Counter)
for f in findings:
    by_tool[f[0]][f[1]] += 1

lines = ["# Security scan summary", "", f"Reports folder: `{OUT}`", "",
         "| Tool | Critical | High | Medium | Low | Total |", "| --- | --- | --- | --- | --- | --- |"]
total = Counter()
for t in tools:
    c = by_tool[t]
    ran = t != "SonarQube" or sonar is not None
    if not ran:
        lines.append(f"| {t} | – | – | – | – | not run |")
        continue
    total.update(c)
    lines.append(f"| {t} | " + " | ".join(str(c[l]) for l in LEVELS) + f" | {sum(c.values())} |")
lines.append("| **Total** | " + " | ".join(f"**{total[l]}**" for l in LEVELS) + f" | **{sum(total.values())}** |")

areas = ["Frontend", "Backend", "Shared", "Dependencies", "Docker", "Repo"]
by_area = defaultdict(Counter)
for f in findings:
    by_area[f[2]][f[1]] += 1
lines += ["", "## By part of the codebase", "", "| Area | Critical | High | Medium | Low |", "| --- | --- | --- | --- | --- |"]
for a in areas:
    if by_area[a]:
        lines.append(f"| {a} | " + " | ".join(str(by_area[a][l]) for l in LEVELS) + " |")

env = os.path.join(ROOT, ".env.local")
if os.path.exists(env):
    mode = stat.S_IMODE(os.stat(env).st_mode)
    lines += ["", f"Runtime secrets file `.env.local`: mode {oct(mode)} — {'OK (owner-only)' if mode & 0o077 == 0 else 'TOO OPEN, run chmod 600'}"]

lines += ["", "## Findings (Critical, High, Medium)", "", "| Level | Tool | Area | Rule | Location | Detail |", "| --- | --- | --- | --- | --- | --- |"]
for f in sorted(findings, key=lambda x: (LEVELS.index(x[1]), x[0])):
    if f[1] != "Low":
        lines.append(f"| {f[1]} | {f[0]} | {f[2]} | {f[3]} | {f[4]} | {f[5].replace('|', '/')} |")
low = Counter((f[0], f[3]) for f in findings if f[1] == "Low")
if low:
    lines += ["", "## Low findings (grouped)", "", "| Tool | Rule | Count |", "| --- | --- | --- |"]
    for (t, r), n in low.most_common():
        lines.append(f"| {t} | {r} | {n} |")

with open(os.path.join(OUT, "SUMMARY.md"), "w") as fh:
    fh.write("\n".join(lines) + "\n")
with open(os.path.join(OUT, "findings.json"), "w") as fh:
    json.dump([dict(zip(["tool", "level", "area", "rule", "location", "detail"], f)) for f in findings], fh, indent=1)
print("\n".join(lines[:len(tools) + 8]))
