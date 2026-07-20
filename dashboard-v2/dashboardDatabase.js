const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = path.join(__dirname, "..", "hmpd.sqlite");
const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS officer_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS officer_sanctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    sanction_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    author_id TEXT NOT NULL,
    expires_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_notes_user ON officer_notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_sanctions_user ON officer_sanctions(user_id);
`);

const listNotesStmt = db.prepare(`
  SELECT * FROM officer_notes
  WHERE user_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

const addNoteStmt = db.prepare(`
  INSERT INTO officer_notes (user_id, content, author_id)
  VALUES (?, ?, ?)
`);

const listSanctionsStmt = db.prepare(`
  SELECT * FROM officer_sanctions
  WHERE user_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

const addSanctionStmt = db.prepare(`
  INSERT INTO officer_sanctions
    (user_id, sanction_type, reason, author_id, expires_at)
  VALUES (?, ?, ?, ?, ?)
`);

const activityStmt = db.prepare(`
  SELECT
    id,
    user_id,
    action,
    amount,
    old_points,
    new_points,
    reason,
    moderator_id,
    created_at
  FROM points_history
  ORDER BY id DESC
  LIMIT ?
`);

function listNotes(userId, limit = 50) {
  return listNotesStmt.all(userId, limit);
}

function addNote({ userId, content, authorId }) {
  const result = addNoteStmt.run(userId, content, authorId);
  return { id: Number(result.lastInsertRowid) };
}

function listSanctions(userId, limit = 50) {
  return listSanctionsStmt.all(userId, limit);
}

function addSanction({ userId, type, reason, authorId, expiresAt }) {
  const result = addSanctionStmt.run(
    userId,
    type,
    reason,
    authorId,
    expiresAt || null
  );
  return { id: Number(result.lastInsertRowid) };
}

function listActivity(limit = 50) {
  return activityStmt.all(limit);
}

module.exports = {
  listNotes,
  addNote,
  listSanctions,
  addSanction,
  listActivity,
};
