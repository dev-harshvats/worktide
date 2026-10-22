import path from 'node:path';

/**
 * Converts a git branch name into a clean, filesystem-safe slug.
 * Example: 'feature/auth-v2' -> 'feature-auth-v2'
 * Example: 'bugfix/issue#42' -> 'bugfix-issue-42'
 * 
 * @param {string} branch
 * @returns {string}
 */
export function slugifyBranch(branch) {
  if (!branch || typeof branch !== 'string') {
    throw new Error('Branch name must be a non-empty string');
  }

  return branch
    .trim()
    .toLowerCase()
    .replace(/[/\\_:\s]+/g, '-')       // Replace slashes, colons, underscores, whitespace with dashes
    .replace(/[^a-z0-9.-]/g, '-')     // Replace any invalid character with dash
    .replace(/-+/g, '-')              // Collapse multiple dashes
    .replace(/^-+|-+$/g, '');         // Strip leading and trailing dashes
}

/**
 * Computes the target filesystem path for a branch worktree.
 * Worktrees are placed in a sibling directory: ../<repoName>-<branch-slug>
 * 
 * @param {string} repoRoot - Absolute path to primary git repository root
 * @param {string} repoName - Name of the repository
 * @param {string} branch - Branch name
 * @returns {string}
 */
export function getWorktreePath(repoRoot, repoName, branch) {
  const slug = slugifyBranch(branch);
  const parentDir = path.dirname(repoRoot);
  return path.resolve(parentDir, `${repoName}-${slug}`);
}
