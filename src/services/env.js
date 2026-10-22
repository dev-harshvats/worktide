import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const MANAGED_START = '# >>> worktide managed >>>';
export const MANAGED_END = '# <<< worktide managed <<<';

/**
 * Generates the deterministic managed environment block.
 * @param {number} portStart
 * @param {number} portEnd
 * @returns {string}
 */
export function formatManagedBlock(portStart, portEnd) {
  return `${MANAGED_START}\nPORT=${portStart}\nPORT_END=${portEnd}\n${MANAGED_END}`;
}

/**
 * Injects or updates the managed block within existing file content.
 * All variables, comments, and empty lines outside the markers are preserved verbatim.
 * 
 * @param {string} existingContent
 * @param {number} portStart
 * @param {number} portEnd
 * @returns {string}
 */
export function injectManagedBlock(existingContent, portStart, portEnd) {
  const newBlock = formatManagedBlock(portStart, portEnd);

  const startIndex = existingContent.indexOf(MANAGED_START);
  const endIndex = existingContent.indexOf(MANAGED_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex);
    const after = existingContent.slice(endIndex + MANAGED_END.length);
    return `${before}${newBlock}${after}`;
  }

  // Markers not present: append to end with clean newline separation
  const trimmed = existingContent.trimEnd();
  if (!trimmed) {
    return `${newBlock}\n`;
  }

  return `${trimmed}\n\n${newBlock}\n`;
}

/**
 * Extracts PORT and PORT_END from a managed block in an environment file.
 * @param {string} content
 * @returns {{ portStart?: number, portEnd?: number } | null}
 */
export function extractManagedPorts(content) {
  const startIndex = content.indexOf(MANAGED_START);
  const endIndex = content.indexOf(MANAGED_END);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  const block = content.slice(startIndex, endIndex + MANAGED_END.length);
  const portMatch = block.match(/^PORT=(\d+)$/m);
  const portEndMatch = block.match(/^PORT_END=(\d+)$/m);

  return {
    portStart: portMatch ? parseInt(portMatch[1], 10) : undefined,
    portEnd: portEndMatch ? parseInt(portEndMatch[1], 10) : undefined,
  };
}

/**
 * Writes or updates .env.local inside the worktree directory with the managed block.
 * @param {string} targetWorktreePath
 * @param {number} portStart
 * @param {number} portEnd
 * @returns {Promise<string>} Updated file path
 */
export async function writeManagedEnvLocal(targetWorktreePath, portStart, portEnd) {
  const envLocalPath = path.join(targetWorktreePath, '.env.local');
  let currentContent = '';

  if (existsSync(envLocalPath)) {
    currentContent = await fs.readFile(envLocalPath, 'utf8');
  }

  const updatedContent = injectManagedBlock(currentContent, portStart, portEnd);
  await fs.writeFile(envLocalPath, updatedContent, 'utf8');

  return envLocalPath;
}
