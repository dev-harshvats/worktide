/**
 * Standardized logger enforcing separation between stdout (data/status) and stderr (errors/warnings).
 */
export const logger = {
  info(message) {
    process.stdout.write(`${message}\n`);
  },

  success(message) {
    process.stdout.write(`✓ ${message}\n`);
  },

  warn(message) {
    process.stderr.write(`! ${message}\n`);
  },

  error(message) {
    process.stderr.write(`✗ ${message}\n`);
  },

  raw(message) {
    process.stdout.write(`${message}\n`);
  }
};
