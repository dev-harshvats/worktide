import { execa } from 'execa';
import path from 'node:path';
import { GitError } from '../utils/errors.js';

/**
 * Returns the absolute root path of the current Git repository.
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<string>}
 */
export async function getRepoRoot(cwd = process.cwd()) {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--show-toplevel'], { cwd });
    return path.resolve(stdout.trim());
  } catch (err) {
    throw new GitError(`Current directory is not inside a Git repository: ${err.message}`);
  }
}

/**
 * Derives the repository name from its root path.
 * @param {string} repoRoot
 * @returns {string}
 */
export function getRepoName(repoRoot) {
  return path.basename(repoRoot);
}

/**
 * Checks if a branch exists locally or in remote refs.
 * @param {string} branch
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<boolean>}
 */
export async function branchExists(branch, cwd = process.cwd()) {
  try {
    await execa('git', ['rev-parse', '--verify', `refs/heads/${branch}`], { cwd });
    return true;
  } catch {
    try {
      await execa('git', ['rev-parse', '--verify', branch], { cwd });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Creates a git worktree for the specified branch.
 * If the branch already exists, checks it out; otherwise creates a new branch (-b).
 * 
 * @param {object} params
 * @param {string} params.targetPath - Target worktree directory
 * @param {string} params.branch - Branch to checkout or create
 * @param {string} [params.cwd=process.cwd()]
 * @returns {Promise<void>}
 */
export async function createWorktree({ targetPath, branch, cwd = process.cwd() }) {
  const exists = await branchExists(branch, cwd);
  const args = exists
    ? ['worktree', 'add', targetPath, branch]
    : ['worktree', 'add', '-b', branch, targetPath];

  try {
    await execa('git', args, { cwd });
  } catch (err) {
    throw new GitError(`Failed to create git worktree at ${targetPath}: ${err.stderr || err.message}`);
  }
}

/**
 * Removes a git worktree and prunes git metadata.
 * @param {string} targetPath
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()]
 * @param {boolean} [options.force=true]
 * @returns {Promise<void>}
 */
export async function removeWorktree(targetPath, { cwd = process.cwd(), force = true } = {}) {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(targetPath);

  try {
    await execa('git', args, { cwd });
  } catch (err) {
    throw new GitError(`Failed to remove git worktree at ${targetPath}: ${err.stderr || err.message}`);
  } finally {
    try {
      await execa('git', ['worktree', 'prune'], { cwd });
    } catch {
      // Ignore prune errors during cleanup
    }
  }
}

/**
 * Checks whether a worktree contains uncommitted or untracked changes.
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
export async function isWorktreeDirty(targetPath) {
  try {
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: targetPath });
    return stdout.trim().length > 0;
  } catch (err) {
    throw new GitError(`Failed to check git status in ${targetPath}: ${err.message}`);
  }
}

/**
 * Returns a list of all worktrees recognized by git in porcelain format.
 * @param {string} [cwd=process.cwd()]
 * @returns {Promise<Array<{ path: string, head: string, branch?: string }>>}
 */
export async function listGitWorktrees(cwd = process.cwd()) {
  try {
    const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd });
    const worktrees = [];
    let current = {};

    for (const line of stdout.split('\n')) {
      if (!line.trim()) {
        if (current.path) worktrees.push(current);
        current = {};
        continue;
      }

      if (line.startsWith('worktree ')) {
        current.path = path.resolve(line.slice(9).trim());
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5).trim();
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '').trim();
      }
    }

    if (current.path) worktrees.push(current);
    return worktrees;
  } catch (err) {
    throw new GitError(`Failed to list git worktrees: ${err.message}`);
  }
}
