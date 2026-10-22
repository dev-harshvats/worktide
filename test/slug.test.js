import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { slugifyBranch, getWorktreePath } from '../src/utils/slug.js';

describe('slug utility', () => {
  describe('slugifyBranch', () => {
    it('converts slashes and uppercase characters', () => {
      expect(slugifyBranch('feature/Auth-V2')).toBe('feature-auth-v2');
      expect(slugifyBranch('fix/login/modal')).toBe('fix-login-modal');
    });

    it('sanitizes special characters and underscores', () => {
      expect(slugifyBranch('bugfix/issue#42')).toBe('bugfix-issue-42');
      expect(slugifyBranch('hotfix_user_tokens')).toBe('hotfix-user-tokens');
    });

    it('collapses multiple dashes and strips edges', () => {
      expect(slugifyBranch('---feat---test---')).toBe('feat-test');
      expect(slugifyBranch('feature//double-slash')).toBe('feature-double-slash');
    });

    it('throws on empty or non-string input', () => {
      expect(() => slugifyBranch('')).toThrow();
      expect(() => slugifyBranch(null)).toThrow();
    });
  });

  describe('getWorktreePath', () => {
    it('returns a sibling directory path', () => {
      const repoRoot = path.resolve('/workspace/projects/my-app');
      const target = getWorktreePath(repoRoot, 'my-app', 'feature/auth');
      const expected = path.resolve('/workspace/projects/my-app-feature-auth');

      expect(target).toBe(expected);
    });
  });
});
