import { describe, expect, it } from 'bun:test';
import { getReviewctlArtifactRoot } from './reviewctl-artifact-root';

describe('getReviewctlArtifactRoot', () => {
  it('returns stable roots for the same repo path', () => {
    const repoPath = '/tmp/same/app';
    expect(getReviewctlArtifactRoot(repoPath)).toBe(
      getReviewctlArtifactRoot(repoPath),
    );
  });

  it('returns different roots for different repos with the same basename', () => {
    const repoA = '/tmp/root-a/app';
    const repoB = '/tmp/root-b/app';

    expect(getReviewctlArtifactRoot(repoA)).not.toBe(
      getReviewctlArtifactRoot(repoB),
    );
  });
});
