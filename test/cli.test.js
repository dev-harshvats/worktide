import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/cli.js';

describe('CLI Program Structure', () => {
  it('registers correct metadata and version', () => {
    const program = createProgram();
    expect(program.name()).toBe('worktide');
    expect(program.version()).toBe('0.1.0');
  });

  it('registers all four required commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toContain('start');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('done');
    expect(commandNames).toContain('doctor');
  });

  it('registers expected options on commands', () => {
    const program = createProgram();
    const statusCmd = program.commands.find((c) => c.name() === 'status');
    const doneCmd = program.commands.find((c) => c.name() === 'done');
    const doctorCmd = program.commands.find((c) => c.name() === 'doctor');

    expect(statusCmd.options.some((opt) => opt.long === '--json')).toBe(true);
    expect(doneCmd.options.some((opt) => opt.long === '--force')).toBe(true);
    expect(doctorCmd.options.some((opt) => opt.long === '--fix')).toBe(true);
  });
});
