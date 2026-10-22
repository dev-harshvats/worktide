import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Creates a directory symlink for node_modules in the target worktree.
 * Gracefully skips if node_modules does not exist in the source checkout.
 * 
 * @param {string} sourceRepoRoot - Path to primary repository checkout
 * @param {string} targetWorktreePath - Path to target worktree
 * @returns {Promise<{ symlinked: boolean, target?: string }>}
 */
export async function symlinkNodeModules(sourceRepoRoot, targetWorktreePath) {
  const sourceNodeModules = path.join(sourceRepoRoot, 'node_modules');
  const targetNodeModules = path.join(targetWorktreePath, 'node_modules');

  if (!existsSync(sourceNodeModules)) {
    return { symlinked: false };
  }

  // If already exists, do not overwrite
  if (existsSync(targetNodeModules)) {
    return { symlinked: true, target: targetNodeModules };
  }

  // Use 'junction' on Windows to bypass symlink privilege requirements; 'dir' on POSIX
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(sourceNodeModules, targetNodeModules, symlinkType);

  return { symlinked: true, target: targetNodeModules };
}

/**
 * Copies all .env and .env.* files from the root repository into the worktree.
 * Preserves user-defined variables and ignores non-env files.
 * 
 * @param {string} sourceRepoRoot
 * @param {string} targetWorktreePath
 * @returns {Promise<string[]>} List of copied filenames
 */
export async function copyEnvFiles(sourceRepoRoot, targetWorktreePath) {
  const entries = await fs.readdir(sourceRepoRoot, { withFileTypes: true });
  const copiedFiles = [];

  for (const entry of entries) {
    if (entry.isFile() && /^\.env(\..+)?$/.test(entry.name)) {
      const srcFile = path.join(sourceRepoRoot, entry.name);
      const destFile = path.join(targetWorktreePath, entry.name);

      await fs.copyFile(srcFile, destFile);
      copiedFiles.push(entry.name);
    }
  }

  return copiedFiles;
}
