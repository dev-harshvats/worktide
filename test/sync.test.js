import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { symlinkNodeModules, copyEnvFiles } from '../src/services/sync.js';

describe('sync service', () => {
  let tempDir;
  let sourceDir;
  let targetDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktide-sync-test-'));
    sourceDir = path.join(tempDir, 'source');
    targetDir = path.join(tempDir, 'target');

    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows locks
    }
  });

  describe('symlinkNodeModules', () => {
    it('gracefully skips if source node_modules is missing', async () => {
      const result = await symlinkNodeModules(sourceDir, targetDir);
      expect(result.symlinked).toBe(false);
    });

    it('creates symlink when source node_modules exists', async () => {
      const sourceNm = path.join(sourceDir, 'node_modules');
      await fs.mkdir(sourceNm);
      await fs.writeFile(path.join(sourceNm, 'package.json'), '{}');

      const result = await symlinkNodeModules(sourceDir, targetDir);
      expect(result.symlinked).toBe(true);

      const targetNm = path.join(targetDir, 'node_modules');
      const stats = await fs.lstat(targetNm);
      expect(stats.isSymbolicLink()).toBe(true);
    });
  });

  describe('copyEnvFiles', () => {
    it('copies only .env and .env.* files into target', async () => {
      // Create sample files in source
      await fs.writeFile(path.join(sourceDir, '.env'), 'VAR1=A');
      await fs.writeFile(path.join(sourceDir, '.env.development'), 'VAR2=B');
      await fs.writeFile(path.join(sourceDir, '.env.test'), 'VAR3=C');
      await fs.writeFile(path.join(sourceDir, 'package.json'), '{}');
      await fs.writeFile(path.join(sourceDir, 'README.md'), '# Test');

      const copied = await copyEnvFiles(sourceDir, targetDir);
      expect(copied.sort()).toEqual(['.env', '.env.development', '.env.test'].sort());

      // Verify files in target
      const targetFiles = await fs.readdir(targetDir);
      expect(targetFiles.sort()).toEqual(['.env', '.env.development', '.env.test'].sort());

      const content = await fs.readFile(path.join(targetDir, '.env.development'), 'utf8');
      expect(content).toBe('VAR2=B');
    });

    it('returns empty array if no .env files exist', async () => {
      await fs.writeFile(path.join(sourceDir, 'main.js'), 'console.log()');
      const copied = await copyEnvFiles(sourceDir, targetDir);
      expect(copied).toEqual([]);
    });
  });
});
