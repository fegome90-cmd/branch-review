#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime

run_dir, run_id, session_name, plan_path = (
    sys.argv[1],
    sys.argv[2],
    sys.argv[3],
    sys.argv[4],
)

files = {
    "logic": os.path.join(run_dir, "agent-logic.json"),
    "code_quality": os.path.join(run_dir, "agent-code-quality.json"),
    "silent_failure": os.path.join(run_dir, "agent-silent-failure.json"),
    "testing_static": os.path.join(run_dir, "agent-testing-static.json"),
}

agents = {}
all_findings = []
for key, fpath in files.items():
    if os.path.exists(fpath):
        with open(fpath, encoding="utf-8") as f:
            data = json.load(f)
        agents[key] = data
        for item in data.get("findings", []):
            item = dict(item)
            item["agent"] = key
            all_findings.append(item)
    else:
        agents[key] = {"agent": key, "status": "pending", "findings": []}

severity_order = {"Alta": 0, "Media": 1, "Baja": 2}
all_findings.sort(key=lambda x: severity_order.get(x.get("severity", "Baja"), 9))

raw_patch_candidates = []
for idx, f in enumerate(all_findings[:30], start=1):
    raw_patch_candidates.append(
        {
            "id": f"patch-{idx}",
            "priority": f.get("severity", "Baja"),
            "source_agent": f.get("agent"),
            "change_summary": f.get("recommendation"),
            "risk_if_not_applied": f.get("risk"),
            "status": "proposed",
            "requires_user_confirmation": True,
            "user_decision": "deferred",
            "user_notes": "",
        }
    )

# Dedup by (priority, change_summary, risk)
dedup_map = {}
for p in raw_patch_candidates:
    key = (p.get("priority"), p.get("change_summary"), p.get("risk_if_not_applied"))
    if key not in dedup_map:
        dedup_map[key] = {
            "id": f"patch-dedup-{len(dedup_map) + 1}",
            "priority": p.get("priority"),
            "change_summary": p.get("change_summary"),
            "risk_if_not_applied": p.get("risk_if_not_applied"),
            "source_agents": [p.get("source_agent")],
            "status": "proposed",
            "requires_user_confirmation": True,
            "user_decision": "deferred",
            "user_notes": "",
        }
    else:
        if p.get("source_agent") not in dedup_map[key]["source_agents"]:
            dedup_map[key]["source_agents"].append(p.get("source_agent"))

deduplicated_patch_candidates = list(dedup_map.values())
deduplicated_patch_candidates.sort(
    key=lambda x: severity_order.get(x.get("priority", "Baja"), 9)
)

confirmation_template = {
    "run_id": run_id,
    "decisions": [
        {
            "patch_id": p["id"],
            "user_decision": "deferred",
            "user_notes": "",
            "approved_by": "",
            "approved_at": "",
        }
        for p in deduplicated_patch_candidates
    ],
}

handoff = {
    "schema_version": "2.0",
    "handoff_version": "2.0",
    "generated_at": datetime.now().isoformat(),
    "run_id": run_id,
    "session_name": session_name,
    "plan_path": plan_path,
    "agent_outputs": files,
    "findings": all_findings,
    "raw_patch_candidates": raw_patch_candidates,
    "deduplicated_patch_candidates": deduplicated_patch_candidates,
    "decision_rules": {
        "allowed_user_decisions": ["approved", "rejected", "deferred"],
        "default": "deferred",
        "requires_user_confirmation": True,
    },
    "next_step_for_parent_agent": "Presentar deduplicated_patch_candidates al usuario, capturar user_decision por patch y aplicar solo approved.",
}

handoff_path = os.path.join(run_dir, "handoff.json")
with open(handoff_path, "w", encoding="utf-8") as f:
    json.dump(handoff, f, ensure_ascii=False, indent=2)

confirmation_path = os.path.join(run_dir, "patch-confirmation-template.json")
with open(confirmation_path, "w", encoding="utf-8") as f:
    json.dump(confirmation_template, f, ensure_ascii=False, indent=2)
