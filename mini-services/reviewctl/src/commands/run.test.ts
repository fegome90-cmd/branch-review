import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const createdDirs: string[] = [];

async function loadRunModule() {
  return import(`./run.js?ts=${Date.now()}-${Math.random()}`);
}

function createTempRepo(files: string[] = []): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-run-'));
  createdDirs.push(repoDir);

  for (const relativePath of files) {
    const fullPath = path.join(repoDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, '# fixture\n');
  }

  return repoDir;
}

afterEach(() => {
  process.chdir(originalCwd);
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('evaluateStaticToolRequest', () => {
  test('marks ruff as NOT_APPLICABLE when diff has no Python files', async () => {
    const repoDir = createTempRepo(['ruff.toml']);
    process.chdir(repoDir);

    const { evaluateStaticToolRequest } = await loadRunModule();

    const result = evaluateStaticToolRequest({
      tool: {
        name: 'ruff',
        checkFile: 'ruff.toml',
        command: 'bun run lint:ruff',
        lang: 'Python',
      },
      changedFiles: ['src/app/page.tsx'],
      run: {
        run_id: 'run_1',
        branch: 'review/main--feature--1234',
        base_branch: 'main',
        target_branch: 'feature',
        created_at: new Date().toISOString(),
        status: 'running',
        plan_status: 'FOUND',
      },
    });

    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.shouldGenerateRequest).toBeFalse();
  });

  test('skips pytest when no changed Python test targets are present', async () => {
    const repoDir = createTempRepo(['pytest.ini', 'tests/test_api.py']);
    process.chdir(repoDir);

    const { evaluateStaticToolRequest } = await loadRunModule();

    const result = evaluateStaticToolRequest({
      tool: {
        name: 'pytest',
        checkFile: 'pytest.ini',
        command: 'pytest -q',
        lang: 'Python',
      },
      changedFiles: ['src/service.py'],
      run: {
        run_id: 'run_2',
        branch: 'review/main--feature--1234',
        base_branch: 'main',
        target_branch: 'feature',
        created_at: new Date().toISOString(),
        status: 'running',
        plan_status: 'FOUND',
      },
    });

    expect(result.status).toBe('SKIP');
    expect(result.shouldGenerateRequest).toBeFalse();
    expect(result.reason).toContain('No changed Python test targets');
  });

  test('generates scoped pytest command for changed Python tests', async () => {
    const repoDir = createTempRepo(['pytest.ini']);
    process.chdir(repoDir);

    const { evaluateStaticToolRequest } = await loadRunModule();

    const result = evaluateStaticToolRequest({
      tool: {
        name: 'pytest',
        checkFile: 'pytest.ini',
        command: 'pytest -q',
        lang: 'Python',
      },
      changedFiles: ['tests/test_auth.py', "tests/test user's auth.py"],
      run: {
        run_id: 'run_3',
        branch: 'review/main--feature--1234',
        base_branch: 'main',
        target_branch: 'feature',
        created_at: new Date().toISOString(),
        status: 'running',
        plan_status: 'FOUND',
      },
    });

    expect(result.status).toBe('PENDING');
    expect(result.shouldGenerateRequest).toBeTrue();
    expect(result.command).toContain("pytest -q 'tests/test_auth.py'");
    expect(result.command).toContain("'tests/test user'\\''s auth.py'");
  });

  test('marks required scoped Python gate as PENDING_NO_CONFIG when config is missing', async () => {
    const repoDir = createTempRepo();
    process.chdir(repoDir);

    const { evaluateStaticToolRequest } = await loadRunModule();

    const result = evaluateStaticToolRequest({
      tool: {
        name: 'pytest',
        checkFile: 'pytest.ini',
        command: 'pytest -q',
        lang: 'Python',
      },
      changedFiles: ['tests/test_auth.py'],
      run: {
        run_id: 'run_4',
        branch: 'review/main--feature--1234',
        base_branch: 'main',
        target_branch: 'feature',
        created_at: new Date().toISOString(),
        status: 'running',
        plan_status: 'FOUND',
      },
      planStatic: {
        required: true,
        reason: 'Python test execution gate',
      },
    });

    expect(result.status).toBe('PENDING_NO_CONFIG');
    expect(result.shouldGenerateRequest).toBeTrue();
  });
});
