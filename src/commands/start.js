import { logger } from '../utils/logger.js';

export async function startCommand(branch, options = {}) {
  logger.info(`Starting worktree for branch: ${branch}`);
}
