import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { doctorCommand } from './doctor';

const originalCliPath = process.env.REVIEWCTL_CORE_CLI_PATH;
const originalExitCode = process.exitCode;

afterEach(() => {
  if (originalCliPath === undefined) {
    delete process.env.REVIEWCTL_CORE_CLI_PATH;
  } else {
    process.env.REVIEWCTL_CORE_CLI_PATH = originalCliPath;
  }
  process.exitCode = originalExitCode;
});

describe('reviewctl doctor exit status', () => {
  for (const json of [true, false]) {
    it(`returns nonzero on failed preflight (json=${json})`, async () => {
      process.env.REVIEWCTL_CORE_CLI_PATH = '/__reviewctl_missing__/index.ts';
      process.exitCode = 0;
      const log = spyOn(console, 'log').mockImplementation(() => {});
      try {
        await doctorCommand({ json });
        expect(process.exitCode).toBe(1);
      } finally {
        log.mockRestore();
      }
    });
  }
});
