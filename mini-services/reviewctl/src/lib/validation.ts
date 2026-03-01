/**
 * Shared validation functions for reviewctl commands.
 * Pure functions for easy testing without mocks.
 */

// Constants
export const MAX_TITLE_LENGTH = 500;
export const MAX_BODY_LENGTH = 10000;
export const MAX_BRANCH_NAME_LENGTH = 255;

// Allowed characters for branch names (security: prevent injection)
export const BRANCH_NAME_REGEX = /^[a-zA-Z0-9_/.-]+$/;

// Result types for validation functions
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string; code: string };

/**
 * Validates that required arguments are present.
 */
export function validateRequiredArgs(options: {
  title?: string;
  body?: string;
}): ValidationResult {
  if (!options.title || !options.body) {
    return {
      valid: false,
      error: 'Missing required arguments: --title and --body are required',
      code: 'MISSING_ARGS',
    };
  }
  return { valid: true };
}

/**
 * Validates title and body length limits.
 */
export function validateLengths(options: {
  title: string;
  body: string;
}): ValidationResult {
  if (options.title.length > MAX_TITLE_LENGTH) {
    return {
      valid: false,
      error: `Title too long (max ${MAX_TITLE_LENGTH} characters)`,
      code: 'TITLE_TOO_LONG',
    };
  }

  if (options.body.length > MAX_BODY_LENGTH) {
    return {
      valid: false,
      error: `Body too long (max ${MAX_BODY_LENGTH} characters)`,
      code: 'BODY_TOO_LONG',
    };
  }

  return { valid: true };
}

/**
 * Validates branch name format (security: prevent command injection).
 */
export function validateBranchName(branch: string): ValidationResult {
  if (!branch || branch.length === 0) {
    return {
      valid: false,
      error: 'Branch name cannot be empty',
      code: 'EMPTY_BRANCH_NAME',
    };
  }

  if (branch.length > MAX_BRANCH_NAME_LENGTH) {
    return {
      valid: false,
      error: `Branch name too long (max ${MAX_BRANCH_NAME_LENGTH} characters)`,
      code: 'BRANCH_NAME_TOO_LONG',
    };
  }

  // Security: reject path traversal attempts
  if (branch.includes('..')) {
    return {
      valid: false,
      error: `Invalid branch name: ${branch}`,
      code: 'INVALID_BRANCH_NAME',
    };
  }

  if (!BRANCH_NAME_REGEX.test(branch)) {
    return {
      valid: false,
      error: `Invalid branch name: ${branch}`,
      code: 'INVALID_BRANCH_NAME',
    };
  }

  return { valid: true };
}

/**
 * Checks if working tree is clean based on git status --porcelain output.
 */
export function isWorkingTreeClean(statusOutput: string): boolean {
  return statusOutput.trim().length === 0;
}

/**
 * Checks if there are commits between base and HEAD.
 */
export function hasCommits(logOutput: string): boolean {
  return logOutput.trim().length > 0;
}
