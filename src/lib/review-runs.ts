import { readFile } from 'fs/promises';
import path from 'path';

function runsRootPath() {
  return path.join(process.cwd(), '_ctx', 'review_runs');
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = String((error as { code?: string }).code);
      if (code === 'ENOENT') {
        return null;
      }
    }

    throw error;
  }
}

export async function readCurrentRun<T = unknown>() {
  const currentPath = path.join(runsRootPath(), 'current.json');
  return readJsonIfExists<T>(currentPath);
}

export async function readFinalByRunId<T = unknown>(runId: string) {
  const finalPath = path.join(runsRootPath(), runId, 'final.json');
  return readJsonIfExists<T>(finalPath);
}
