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
    (r"\bdefinir\b|\bpendiente\b|\bTODO\b|\bfuturo\b", "Media", "Ambigüedad de alcance", "puede bloquear implementación", "Aterrizar criterio exacto y responsable por fase."),
    (r"\bcriterios de aceptación\b", "Baja", "Validación presente", "ninguno", "Mantener criterios medibles por endpoint/entregable."),
    (r"\bfuera de alcance\b", "Baja", "Delimitación presente", "scope creep reducido", "Confirmar exclusiones con el usuario."),
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
        "title": "Sin red flags lógicas por heurística",
        "evidence": {"file": plan_path, "line": 1, "snippet": "No matches"},
        "risk": "pueden existir casos no detectados automáticamente",
        "recommendation": "Hacer revisión manual de contradicciones entre fases y criterios.",
    })

payload = {
    "agent": "logic",
    "generated_at": datetime.now().isoformat(),
    "findings": findings,
}

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

with open(out_txt, "w", encoding="utf-8") as f:
    f.write("# Agent Logic\n")
    for item in findings:
        ev = item["evidence"]
        f.write(f"- [{item['severity']}] {item['title']} ({ev['file']}:{ev['line']})\n")
PY
