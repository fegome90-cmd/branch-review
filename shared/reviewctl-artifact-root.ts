#!/usr/bin/env bun
import crypto from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getCanonicalRepoPath(repoPath: string): string {
  const resolved = path.resolve(repoPath);

  try {
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
  } catch {
    return resolved;
  }
}

export function getReviewctlArtifactRoot(repoPath: string): string {
  const canonicalRepoPath = getCanonicalRepoPath(repoPath);
  const repoName = path.basename(canonicalRepoPath) || 'repo';
  const repoHash = crypto
    .createHash('sha1')
    .update(canonicalRepoPath)
    .digest('hex')
    .slice(0, 10);

  return path.join(os.tmpdir(), 'reviewctl-artifacts', `${repoName}-${repoHash}`);
}

if (import.meta.main) {
  const repoPath = process.argv[2];
  if (!repoPath) {
    console.error(
      'Usage: bun shared/reviewctl-artifact-root.ts <repo-path>',
    );
    process.exit(1);
  }

  console.log(getReviewctlArtifactRoot(repoPath));
}
