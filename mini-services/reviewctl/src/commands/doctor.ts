import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import {
  ARTIFACT_ROOT,
  PROJECT_ROOT,
  type PreflightCheck,
  type PreflightReport,
  REVIEW_RUNS_DIR,
  SAFE_MODE,
} from '../lib/constants.js';

function checkBun(): PreflightCheck {
  try {
    const version = execFileSync('bun', ['--version'], {
      encoding: 'utf-8',
    }).trim();
    return { name: 'bun', status: 'PASS', detail: `bun ${version}` };
  } catch {
    return { name: 'bun', status: 'FAIL', detail: 'bun is not available' };
  }
}

function checkGit(): PreflightCheck {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
    }).trim();
    return { name: 'git', status: 'PASS', detail: `repo root: ${root}` };
  } catch {
    return {
      name: 'git',
      status: 'FAIL',
      detail: 'not inside a git repository',
    };
  }
}

function checkCliPath(): PreflightCheck {
  const configured = process.env.REVIEWCTL_CORE_CLI_PATH;
  if (!configured) {
    return {
      name: 'core-cli-path',
      status: SAFE_MODE ? 'WARN' : 'PASS',
      detail: SAFE_MODE
        ? 'REVIEWCTL_CORE_CLI_PATH is not set; external wrapper should set it explicitly'
        : 'internal mode can resolve the CLI path from repo layout',
    };
  }

  const resolved = path.resolve(configured);
  return {
    name: 'core-cli-path',
    status: fs.existsSync(resolved) ? 'PASS' : 'FAIL',
    detail: fs.existsSync(resolved)
      ? resolved
      : `Configured path does not exist: ${resolved}`,
  };
}

function checkTokenMode(): PreflightCheck {
  return {
    name: 'token-mode',
    status: process.env.REVIEW_API_TOKEN ? 'PASS' : 'WARN',
    detail: process.env.REVIEW_API_TOKEN
      ? 'API token available; wrapper may use API mode'
      : 'No REVIEW_API_TOKEN; wrapper will use local mode',
  };
}

function checkArtifactRoot(): PreflightCheck {
  const explicit = process.env.REVIEWCTL_ARTIFACT_ROOT;
  const detail = explicit
    ? `explicit artifact root: ${ARTIFACT_ROOT}`
    : SAFE_MODE
      ? `safe mode default artifact root: ${ARTIFACT_ROOT}`
      : `artifacts will be written in repo root: ${PROJECT_ROOT}`;

  return {
    name: 'artifact-root',
    status: SAFE_MODE && !explicit ? 'WARN' : 'PASS',
    detail,
  };
}

function checkRepoPolicy(): PreflightCheck {
  const allowedRepos = process.env.ALLOWED_REPOS?.split(path.delimiter).filter(
    Boolean,
  );
  if (!allowedRepos || allowedRepos.length === 0) {
    return {
      name: 'repo-policy',
      status: SAFE_MODE ? 'WARN' : 'PASS',
      detail: SAFE_MODE
        ? 'No ALLOWED_REPOS configured; API multi-repo mode will fail closed'
        : 'No ALLOWED_REPOS configured',
    };
  }

  return {
    name: 'repo-policy',
    status: 'PASS',
    detail: `ALLOWED_REPOS configured (${allowedRepos.length} path(s))`,
  };
}

export function buildPreflightReport(): PreflightReport {
  const checks: PreflightCheck[] = [
    checkBun(),
    checkGit(),
    checkCliPath(),
    checkTokenMode(),
    checkArtifactRoot(),
    checkRepoPolicy(),
    {
      name: 'run-state-dir',
      status: fs.existsSync(REVIEW_RUNS_DIR) ? 'PASS' : 'WARN',
      detail: REVIEW_RUNS_DIR,
    },
  ];

  return {
    passed: checks.every((check) => check.status !== 'FAIL'),
    checks,
  };
}

export async function doctorCommand(options: { json?: boolean }) {
  const report = buildPreflightReport();

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(chalk.bold('reviewctl doctor'));
  console.log(chalk.gray(`Project root: ${PROJECT_ROOT}`));
  console.log(chalk.gray(`Artifact root: ${ARTIFACT_ROOT}`));
  console.log(chalk.gray(`Safe mode: ${SAFE_MODE ? 'on' : 'off'}`));
  console.log('');

  for (const check of report.checks) {
    const color =
      check.status === 'PASS'
        ? chalk.green
        : check.status === 'WARN'
          ? chalk.yellow
          : chalk.red;
    console.log(
      `${color(check.status.padEnd(4))} ${check.name}: ${check.detail}`,
    );
  }

  console.log('');
  console.log(
    report.passed ? chalk.green('Doctor passed') : chalk.red('Doctor failed'),
  );
}
