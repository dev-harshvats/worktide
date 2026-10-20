import { logger } from '../utils/logger.js';

export async function doneCommand(branch, options = {}) {
  logger.info(`Tearing down worktree for branch: ${branch}`);
}
