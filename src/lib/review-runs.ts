import { readFile } from 'node:fs/promises';
import path from 'node:path';

function runsRootPath() {
  return path.join(process.cwd(), '_ctx', 'review_runs');
}

// Security: Validate that resolved path stays within runsRootPath
// P0-2: Log path traversal attempts for security monitoring
function safeResolve(basePath: string, ...segments: string[]): string | null {
  const resolved = path.resolve(basePath, ...segments);
  const normalizedBase = path.resolve(basePath);

  if (
    !resolved.startsWith(normalizedBase + path.sep) &&
    resolved !== normalizedBase
  ) {
    // P0-2: Security event logging for path traversal detection
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: 'Path traversal attempt blocked',
        attemptedSegments: segments.join('/'),
        basePath: normalizedBase,
      }),
    );
    return null;
  }

  return resolved;
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
  const runsRoot = runsRootPath();
  // Security: Validate path stays within runsRootPath to prevent traversal
  const finalPath = safeResolve(runsRoot, runId, 'final.json');

  if (!finalPath) {
    return null; // Path traversal attempt blocked
  }

  return readJsonIfExists<T>(finalPath);
}
