import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { doneCommand } from './commands/done.js';
import { doctorCommand } from './commands/doctor.js';
import { logger } from './utils/logger.js';
import { WorktideError } from './utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

export function createProgram() {
  const program = new Command();

  program
    .name('worktide')
    .description('CLI that makes git worktrees immediately runnable and isolated')
    .version(packageJson.version, '-v, --version', 'Output the current version');

  program
    .command('start <branch>')
    .description('Create and provision a new isolated worktree')
    .action(async (branch, options) => {
      try {
        await startCommand(branch, options);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('status')
    .description('List active worktrees, port allocations, and process liveness')
    .option('--json', 'Output results as JSON')
    .action(async (options) => {
      try {
        await statusCommand(options);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('done <branch>')
    .description('Tear down a worktree, terminate its processes, and release ports')
    .option('-f, --force', 'Force removal even if worktree has uncommitted changes')
    .action(async (branch, options) => {
      try {
        await doneCommand(branch, options);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('doctor')
    .description('Inspect system health, broken symlinks, and orphaned allocations')
    .option('--fix', 'Automatically repair detected issues')
    .action(async (options) => {
      try {
        await doctorCommand(options);
      } catch (err) {
        handleError(err);
      }
    });

  return program;
}

export function handleError(err) {
  if (err instanceof WorktideError) {
    logger.error(err.message);
    process.exitCode = err.exitCode;
  } else {
    logger.error(err.message || 'An unexpected error occurred.');
    process.exitCode = 1;
  }
}
