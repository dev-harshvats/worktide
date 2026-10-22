import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Resolves the default database path.
 * Respects WORKTIDE_HOME environment variable, falling back to ~/.config/worktide/registry.db
 * @returns {string}
 */
export function getDefaultDbPath() {
  const baseDir = process.env.WORKTIDE_HOME || path.join(os.homedir(), '.config', 'worktide');
  return path.join(baseDir, 'registry.db');
}

/**
 * Initializes and returns a SQLite database instance.
 * Automatically runs DDL migrations on initialization.
 * 
 * @param {string} [customPath] - Path to SQLite database file or ':memory:'
 * @returns {import('better-sqlite3').Database}
 */
export function getDb(customPath) {
  const dbPath = customPath || getDefaultDbPath();

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Configure SQLite pragmas for safety, concurrency, and integrity
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  // Apply schema definitions
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schemaSql);

  return db;
}

/**
 * Safely closes a database connection.
 * @param {import('better-sqlite3').Database} db
 */
export function closeDb(db) {
  if (db && db.open) {
    db.close();
  }
}
