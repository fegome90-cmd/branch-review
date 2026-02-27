#!/usr/bin/env bash
set -euo pipefail
PLAN_PATH="$1"
OUT_JSON="$2"
OUT_TXT="$3"
python - "$PLAN_PATH" "$OUT_JSON" "$OUT_TXT" <<'PY'
import json, re, sys
from datetime import datetime

plan_path, out_json, out_txt = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(plan_path, "r", encoding="utf-8").read().splitlines()

rules = [
    (r"\brefactor\b|\breescritura\b", "Media", "Riesgo de cambios amplios", "incremento de riesgo de regresión", "Dividir en cambios pequeños y verificables."),
    (r"\bsimplific\b|\bhelper\b|\bduplic\b", "Baja", "Señal de simplificación", "ninguno", "Extraer utilidades compartidas y reducir duplicación."),
    (r"\barquitect\b|\bestructural\b", "Media", "Cambio estructural potencial", "desviación del alcance mínimo", "Priorizar fixes críticos antes de mejoras estructurales."),
]

findings = []
for i, line in enumerate(lines, start=1):
    for pattern, severity, title, risk, rec in rules:
        if re.search(pattern, line, flags=re.IGNORECASE):
            findings.append({
                "severity": severity,
                "title": title,
                "evidence": {"file": plan_path, "line": i, "snippet": line.strip()},
                "risk": risk,
                "recommendation": rec,
            })

if not findings:
    findings.append({
        "severity": "Baja",
        "title": "Sin smells claros en plan (heurística)",
        "evidence": {"file": plan_path, "line": 1, "snippet": "No matches"},
        "risk": "smells pueden emerger al implementar",
        "recommendation": "Mantener cambios atómicos y medir complejidad por PR.",
    })

payload = {
    "agent": "code_quality",
    "generated_at": datetime.now().isoformat(),
    "findings": findings,
}

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

with open(out_txt, "w", encoding="utf-8") as f:
    f.write("# Agent Code Quality\n")
    for item in findings:
        ev = item["evidence"]
        f.write(f"- [{item['severity']}] {item['title']} ({ev['file']}:{ev['line']})\n")
PY
