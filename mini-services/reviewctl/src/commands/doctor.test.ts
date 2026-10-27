import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

const cliPath = fileURLToPath(new URL('../index.ts', import.meta.url));

describe('reviewctl doctor exit status', () => {
  for (const json of [true, false]) {
    it(`returns nonzero on failed preflight (json=${json})`, () => {
      const result = spawnSync(
        'bun',
        [cliPath, 'doctor', ...(json ? ['--json'] : [])],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            REVIEWCTL_CORE_CLI_PATH: '/__reviewctl_missing__/index.ts',
          },
          encoding: 'utf-8',
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(json ? '"passed": false' : 'Doctor failed');
    });
  }
  it('rejects artifact roots resolving to the filesystem root', () => {
    const result = spawnSync('bun', [cliPath, 'doctor', '--json'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REVIEWCTL_CORE_CLI_PATH: cliPath,
        REVIEWCTL_ARTIFACT_ROOT: '/tmp/..',
      },
      encoding: 'utf-8',
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('unsafe artifact root: /');
  });

});
