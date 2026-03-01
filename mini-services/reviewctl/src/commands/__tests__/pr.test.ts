import { describe, expect, mock, test } from 'bun:test';
import type ora from 'ora';
import {
  hasCommits,
  isWorkingTreeClean,
  MAX_BODY_LENGTH,
  MAX_BRANCH_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  validateBranchName,
  validateLengths,
  validateRequiredArgs,
} from '../../lib/validation.js';
import { type PrCommandDeps, prCommand } from '../pr.js';

// ============================================================================
// Unit Tests: Validation Functions
// ============================================================================

describe('validateRequiredArgs', () => {
  test('returns invalid when title is missing', () => {
    const result = validateRequiredArgs({ body: 'test' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('MISSING_ARGS');
      expect(result.error).toContain('title');
    }
  });

  test('returns invalid when body is missing', () => {
    const result = validateRequiredArgs({ title: 'test' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('MISSING_ARGS');
      expect(result.error).toContain('body');
    }
  });

  test('returns invalid when both are missing', () => {
    const result = validateRequiredArgs({});
    expect(result.valid).toBe(false);
  });

  test('returns valid when both are present', () => {
    const result = validateRequiredArgs({ title: 'test', body: 'test' });
    expect(result.valid).toBe(true);
  });

  test('returns invalid when title is empty string', () => {
    const result = validateRequiredArgs({ title: '', body: 'test' });
    expect(result.valid).toBe(false);
  });

  test('returns invalid when body is empty string', () => {
    const result = validateRequiredArgs({ title: 'test', body: '' });
    expect(result.valid).toBe(false);
  });
});

describe('validateLengths', () => {
  test('returns valid for normal lengths', () => {
    const result = validateLengths({
      title: 'Short title',
      body: 'Short body',
    });
    expect(result.valid).toBe(true);
  });

  test('returns invalid when title exceeds max length', () => {
    const longTitle = 'a'.repeat(MAX_TITLE_LENGTH + 1);
    const result = validateLengths({ title: longTitle, body: 'body' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('TITLE_TOO_LONG');
    }
  });

  test('returns valid when title is exactly max length', () => {
    const maxTitle = 'a'.repeat(MAX_TITLE_LENGTH);
    const result = validateLengths({ title: maxTitle, body: 'body' });
    expect(result.valid).toBe(true);
  });

  test('returns invalid when body exceeds max length', () => {
    const longBody = 'a'.repeat(MAX_BODY_LENGTH + 1);
    const result = validateLengths({ title: 'title', body: longBody });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('BODY_TOO_LONG');
    }
  });

  test('returns valid when body is exactly max length', () => {
    const maxBody = 'a'.repeat(MAX_BODY_LENGTH);
    const result = validateLengths({ title: 'title', body: maxBody });
    expect(result.valid).toBe(true);
  });
});

describe('validateBranchName', () => {
  test('returns valid for simple branch name', () => {
    const result = validateBranchName('main');
    expect(result.valid).toBe(true);
  });

  test('returns valid for branch with slash', () => {
    const result = validateBranchName('feature/my-feature');
    expect(result.valid).toBe(true);
  });

  test('returns valid for branch with dot', () => {
    const result = validateBranchName('release/v1.0.0');
    expect(result.valid).toBe(true);
  });

  test('returns valid for branch with hyphen', () => {
    const result = validateBranchName('feature-api-pr');
    expect(result.valid).toBe(true);
  });

  test('returns valid for branch with underscore', () => {
    const result = validateBranchName('feature_api_pr');
    expect(result.valid).toBe(true);
  });

  test('returns invalid for empty branch name', () => {
    const result = validateBranchName('');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('EMPTY_BRANCH_NAME');
    }
  });

  test('returns invalid for branch with path traversal', () => {
    const result = validateBranchName('../etc/passwd');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('INVALID_BRANCH_NAME');
    }
  });

  test('returns invalid for branch with shell metacharacters', () => {
    const result = validateBranchName('feature;rm -rf /');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('INVALID_BRANCH_NAME');
    }
  });

  test('returns invalid for branch with spaces', () => {
    const result = validateBranchName('feature my feature');
    expect(result.valid).toBe(false);
  });

  test('returns invalid for branch with backtick', () => {
    const result = validateBranchName('feature`whoami`');
    expect(result.valid).toBe(false);
  });

  test('returns invalid for branch with $(...)', () => {
    const result = validateBranchName('$(id)');
    expect(result.valid).toBe(false);
  });

  test('returns invalid for branch name too long', () => {
    const longBranch = 'a'.repeat(MAX_BRANCH_NAME_LENGTH + 1);
    const result = validateBranchName(longBranch);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('BRANCH_NAME_TOO_LONG');
    }
  });

  test('returns valid for branch at max length', () => {
    const maxBranch = 'a'.repeat(MAX_BRANCH_NAME_LENGTH);
    const result = validateBranchName(maxBranch);
    expect(result.valid).toBe(true);
  });
});

describe('isWorkingTreeClean', () => {
  test('returns true for empty output', () => {
    expect(isWorkingTreeClean('')).toBe(true);
  });

  test('returns true for whitespace only', () => {
    expect(isWorkingTreeClean('   ')).toBe(true);
  });

  test('returns false for modified file', () => {
    expect(isWorkingTreeClean('M file.ts')).toBe(false);
  });

  test('returns false for untracked file', () => {
    expect(isWorkingTreeClean('?? newfile.ts')).toBe(false);
  });

  test('returns false for staged file', () => {
    expect(isWorkingTreeClean('A staged.ts')).toBe(false);
  });

  test('returns false for multiple files', () => {
    expect(isWorkingTreeClean('M file1.ts\n?? file2.ts')).toBe(false);
  });
});

describe('hasCommits', () => {
  test('returns false for empty output', () => {
    expect(hasCommits('')).toBe(false);
  });

  test('returns false for whitespace only', () => {
    expect(hasCommits('   ')).toBe(false);
  });

  test('returns true for single commit', () => {
    expect(hasCommits('abc123 Commit message')).toBe(true);
  });

  test('returns true for multiple commits', () => {
    expect(hasCommits('abc123 First\ndef456 Second')).toBe(true);
  });
});

// ============================================================================
// Integration Tests: prCommand
// ============================================================================

describe('prCommand', () => {
  // Mock dependencies
  const createMockDeps = (
    overrides: Partial<PrCommandDeps> = {},
  ): PrCommandDeps => {
    const mockSpinner = {
      start: mock(() => mockSpinner),
      text: '',
      fail: mock(() => {}),
      succeed: mock(() => {}),
      // Add minimal ora properties to satisfy type
      isSpinning: false,
      stop: mock(() => {}),
      clear: mock(() => {}),
      render: mock(() => {}),
      frame: mock(() => ''),
      stopAndPersist: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      spinner: { interval: 100, frames: [''] },
      color: 'cyan',
      indent: 0,
      prefixText: '',
      suffixText: '',
      id: undefined,
      stream: process.stdout,
    } as unknown as ReturnType<typeof ora>;

    return {
      execFileSync: mock(() => ''),
      ora: mock(() => mockSpinner),
      consoleLog: mock(() => {}),
      consoleError: mock(() => {}),
      processExit: mock(((code: number) => {
        throw new Error(`ProcessExit(${code})`);
      }) as PrCommandDeps['processExit']),
      ...overrides,
    };
  };

  describe('validations', () => {
    test('exits when title is missing', async () => {
      const deps = createMockDeps();
      const options = { title: '', body: 'test body' };

      expect(async () => {
        await prCommand(options, deps);
      }).toThrow('ProcessExit(1)');

      expect(deps.processExit).toHaveBeenCalled();
    });

    test('exits when body is missing', async () => {
      const deps = createMockDeps();
      const options = { title: 'test title', body: '' };

      expect(async () => {
        await prCommand(options, deps);
      }).toThrow('ProcessExit(1)');
    });

    test('exits when title is too long', async () => {
      const deps = createMockDeps();
      const options = {
        title: 'a'.repeat(MAX_TITLE_LENGTH + 1),
        body: 'test body',
      };

      expect(async () => {
        await prCommand(options, deps);
      }).toThrow('ProcessExit(1)');
    });

    test('exits when body is too long', async () => {
      const deps = createMockDeps();
      const options = {
        title: 'test title',
        body: 'a'.repeat(MAX_BODY_LENGTH + 1),
      };

      expect(async () => {
        await prCommand(options, deps);
      }).toThrow('ProcessExit(1)');
    });
  });

  describe('gh auth check', () => {
    test('exits with GH_NOT_AUTHENTICATED when gh auth fails', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string) => {
          if (cmd === 'gh') throw new Error('not authenticated');
          return '';
        }),
      });

      const options = { title: 'test', body: 'test' };

      try {
        await prCommand(options, deps);
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(deps.consoleError).toHaveBeenCalledWith(
          expect.stringContaining('GH_NOT_AUTHENTICATED'),
        );
      }
    });
  });

  describe('working tree check', () => {
    test('exits with WORKING_TREE_DIRTY when tree is dirty', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh') return '';
          if (cmd === 'git' && args[0] === 'status') return 'M file.ts';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          return '';
        }),
      });

      const options = { title: 'test', body: 'test' };

      try {
        await prCommand(options, deps);
        expect(true).toBe(false);
      } catch (error) {
        expect(deps.consoleError).toHaveBeenCalledWith(
          expect.stringContaining('WORKING_TREE_DIRTY'),
        );
      }
    });

    test('exits when git status fails', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh') return '';
          if (cmd === 'git' && args[0] === 'status')
            throw new Error('git error');
          return '';
        }),
      });

      const options = { title: 'test', body: 'test' };

      expect(async () => {
        await prCommand(options, deps);
      }).toThrow('ProcessExit(1)');
    });
  });

  describe('branch validation', () => {
    test('exits when current branch cannot be determined', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return '';
          return '';
        }),
      });

      const options = { title: 'test', body: 'test' };

      expect(async () => {
        await prCommand(options, deps);
      }).toThrow('ProcessExit(1)');
    });

    test('exits with INVALID_BRANCH_NAME for malicious base', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          return '';
        }),
      });

      const options = { title: 'test', body: 'test', base: '../etc/passwd' };

      try {
        await prCommand(options, deps);
        expect(true).toBe(false);
      } catch (error) {
        expect(deps.consoleError).toHaveBeenCalledWith(
          expect.stringContaining('INVALID_BRANCH_NAME'),
        );
      }
    });
  });

  describe('commits check', () => {
    test('exits with NO_COMMITS when no commits ahead', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          if (cmd === 'git' && args[0] === 'log') return '';
          return '';
        }),
      });

      const options = { title: 'test', body: 'test' };

      try {
        await prCommand(options, deps);
        expect(true).toBe(false);
      } catch (error) {
        expect(deps.consoleError).toHaveBeenCalledWith(
          expect.stringContaining('NO_COMMITS'),
        );
      }
    });

    test('exits when git log fails', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          if (cmd === 'git' && args[0] === 'log') throw new Error('git error');
          return '';
        }),
      });

      const options = { title: 'test', body: 'test' };

      expect(async () => {
        await prCommand(options, deps);
      }).toThrow('ProcessExit(1)');
    });
  });

  describe('PR exists check', () => {
    test('returns PR_EXISTS when PR already exists', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh' && args[0] === 'auth') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          if (cmd === 'git' && args[0] === 'log') return 'abc123 commit';
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
            return 'https://github.com/org/repo/pull/123';
          }
          return '';
        }),
      });

      const options = { title: 'test', body: 'test' };
      const result = await prCommand(options, deps);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('PR_EXISTS');
      }
    });
  });

  describe('PR creation', () => {
    test('creates PR successfully', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh' && args[0] === 'auth') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          if (cmd === 'git' && args[0] === 'log') return 'abc123 commit';
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
            throw new Error('no PR');
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
            return 'https://github.com/org/repo/pull/456';
          }
          return '';
        }),
      });

      const options = { title: 'Test PR', body: 'Test body' };
      const result = await prCommand(options, deps);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.url).toBe('https://github.com/org/repo/pull/456');
      }
    });

    test('creates draft PR when draft flag is set', async () => {
      let capturedArgs: string[] = [];
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh' && args[0] === 'auth') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          if (cmd === 'git' && args[0] === 'log') return 'abc123 commit';
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
            throw new Error('no PR');
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
            capturedArgs = args;
            return 'https://github.com/org/repo/pull/456';
          }
          return '';
        }),
      });

      const options = { title: 'Test PR', body: 'Test body', draft: true };
      await prCommand(options, deps);

      expect(capturedArgs).toContain('--draft');
    });

    test('uses custom base branch', async () => {
      let capturedArgs: string[] = [];
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh' && args[0] === 'auth') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          if (cmd === 'git' && args[0] === 'log') return 'abc123 commit';
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
            throw new Error('no PR');
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
            capturedArgs = args;
            return 'https://github.com/org/repo/pull/456';
          }
          return '';
        }),
      });

      const options = { title: 'Test PR', body: 'Test body', base: 'develop' };
      await prCommand(options, deps);

      expect(capturedArgs).toContain('--base');
      expect(capturedArgs).toContain('develop');
    });

    test('exits with GH_CLI_ERROR when pr create fails', async () => {
      const deps = createMockDeps({
        execFileSync: mock((cmd: string, args: string[]) => {
          if (cmd === 'gh' && args[0] === 'auth') return '';
          if (cmd === 'git' && args[0] === 'status') return '';
          if (cmd === 'git' && args[0] === 'branch') return 'feature/test';
          if (cmd === 'git' && args[0] === 'log') return 'abc123 commit';
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
            throw new Error('no PR');
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
            throw new Error('rate limited');
          }
          return '';
        }),
      });

      const options = { title: 'test', body: 'test' };

      try {
        await prCommand(options, deps);
        expect(true).toBe(false);
      } catch (error) {
        expect(deps.consoleError).toHaveBeenCalledWith(
          expect.stringContaining('GH_CLI_ERROR'),
        );
      }
    });
  });
});
