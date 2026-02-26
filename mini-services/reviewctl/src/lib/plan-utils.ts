import fs from 'fs';
import path from 'path';

export interface PlanJson {
  required_agents: string[];
  optional_agents: string[];
  statics: Array<{ name: string; required: boolean; reason: string }>;
}

export function loadPlanJson(runDir: string): PlanJson | null {
  const planJsonPath = path.join(runDir, 'plan.json');
  if (!fs.existsSync(planJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(planJsonPath, 'utf-8'));
  } catch {
    return null;
  }
}
