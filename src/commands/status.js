import { logger } from '../utils/logger.js';

export async function statusCommand(options = {}) {
  if (options.json) {
    logger.raw(JSON.stringify([], null, 2));
  } else {
    logger.info('No active worktrees registered.');
  }
}
