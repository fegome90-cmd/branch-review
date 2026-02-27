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
    (r"\bsilent\b|\bfalla silenciosa\b", "Alta", "Riesgo explícito de silent failure", "errores podrían pasar como éxito", "Definir status codes y contrato de error explícitos."),
    (r"\bstatus\b|\berror\b|\bobservab\b|\blog\b", "Media", "Necesidad de observabilidad y semántica HTTP", "detección tardía de incidentes", "Agregar checklist de errores y logs estructurados."),
    (r"\bfallback\b|\bdegrad\b", "Media", "Riesgo de degradación ambigua", "cliente puede interpretar estado incorrecto", "Explicitar mapeo estado lógico -> HTTP."),
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
        "severity": "Media",
        "title": "Sin sección explícita de silent failures",
        "evidence": {"file": plan_path, "line": 1, "snippet": "No matches"},
        "risk": "riesgos de errores silenciosos no cubiertos",
        "recommendation": "Agregar sección de semántica de error y observabilidad mínima.",
    })

payload = {
    "agent": "silent_failure",
    "generated_at": datetime.now().isoformat(),
    "findings": findings,
}

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

with open(out_txt, "w", encoding="utf-8") as f:
    f.write("# Agent Silent Failure\n")
    for item in findings:
        ev = item["evidence"]
        f.write(f"- [{item['severity']}] {item['title']} ({ev['file']}:{ev['line']})\n")
PY
