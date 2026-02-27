#!/usr/bin/env bash
set -euo pipefail
PLAN_PATH="$1"
OUT_JSON="$2"
OUT_TXT="$3"
python - "$PLAN_PATH" "$OUT_JSON" "$OUT_TXT" <<'PY'
import json, re, subprocess, sys
from datetime import datetime

plan_path, out_json, out_txt = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(plan_path, "r", encoding="utf-8").read().splitlines()

findings = []
for i, line in enumerate(lines, start=1):
    if re.search(r"\btest|coverage|cobertura|lint|typecheck|contrato|smoke|assert", line, flags=re.IGNORECASE):
        findings.append({
            "severity": "Baja",
            "title": "Referencia a testing/quality gates",
            "evidence": {"file": plan_path, "line": i, "snippet": line.strip()},
            "risk": "ninguno",
            "recommendation": "Mantener pruebas mínimas por ruta crítica.",
        })

commands = []
for cmd in (["bun", "run", "lint"], ["bun", "run", "typecheck:app"]):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        commands.append({
            "command": " ".join(cmd),
            "exit_code": p.returncode,
            "ok": p.returncode == 0,
            "stdout_tail": "\n".join(p.stdout.splitlines()[-20:]),
            "stderr_tail": "\n".join(p.stderr.splitlines()[-20:]),
        })
        if p.returncode != 0:
            findings.append({
                "severity": "Media",
                "title": f"Falla en {' '.join(cmd)}",
                "evidence": {"file": "runtime", "line": 0, "snippet": f"exit_code={p.returncode}"},
                "risk": "quality gate inestable",
                "recommendation": "Corregir errores o separar scope de validación.",
            })
    except Exception as e:
        commands.append({"command": " ".join(cmd), "ok": False, "error": str(e)})
        findings.append({
            "severity": "Media",
            "title": f"No se pudo ejecutar {' '.join(cmd)}",
            "evidence": {"file": "runtime", "line": 0, "snippet": str(e)},
            "risk": "sin señal de calidad estática",
            "recommendation": "Verificar entorno y scripts de validación.",
        })

payload = {
    "agent": "testing_static",
    "generated_at": datetime.now().isoformat(),
    "commands": commands,
    "findings": findings,
}

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

with open(out_txt, "w", encoding="utf-8") as f:
    f.write("# Agent Testing Static\n")
    for item in findings:
        ev = item["evidence"]
        f.write(f"- [{item['severity']}] {item['title']} ({ev['file']}:{ev['line']})\n")
PY
