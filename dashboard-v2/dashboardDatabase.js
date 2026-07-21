const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, "..", "hmpd.sqlite");

const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

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

  CREATE TABLE IF NOT EXISTS points_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    old_points INTEGER NOT NULL DEFAULT 0,
    new_points INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    moderator_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_notes_user
    ON officer_notes(user_id);

  CREATE INDEX IF NOT EXISTS idx_sanctions_user
    ON officer_sanctions(user_id);

  CREATE INDEX IF NOT EXISTS idx_points_history_user
    ON points_history(user_id);

  CREATE INDEX IF NOT EXISTS idx_points_history_created_at
    ON points_history(created_at);
`);

const listNotesStmt = db.prepare(`
  SELECT
    id,
    user_id,
    content,
    author_id,
    created_at
  FROM officer_notes
  WHERE user_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

const addNoteStmt = db.prepare(`
  INSERT INTO officer_notes (
    user_id,
    content,
    author_id
  )
  VALUES (?, ?, ?)
`);

const deleteNoteStmt = db.prepare(`
  DELETE FROM officer_notes
  WHERE id = ?
`);

const listSanctionsStmt = db.prepare(`
  SELECT
    id,
    user_id,
    sanction_type,
    reason,
    author_id,
    expires_at,
    status,
    created_at
  FROM officer_sanctions
  WHERE user_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

const addSanctionStmt = db.prepare(`
  INSERT INTO officer_sanctions (
    user_id,
    sanction_type,
    reason,
    author_id,
    expires_at
  )
  VALUES (?, ?, ?, ?, ?)
`);

const updateSanctionStatusStmt = db.prepare(`
  UPDATE officer_sanctions
  SET status = ?
  WHERE id = ?
`);

const deleteSanctionStmt = db.prepare(`
  DELETE FROM officer_sanctions
  WHERE id = ?
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

const officerActivityStmt = db.prepare(`
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
  WHERE user_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

function normalizeLimit(limit, fallback = 50, maximum = 200) {
  const parsed = Number.parseInt(limit, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function requireText(value, fieldName, maximumLength) {
  const text = String(value || "").trim();

  if (!text) {
    throw new Error(`${fieldName} est obligatoire.`);
  }

  if (text.length > maximumLength) {
    throw new Error(
      `${fieldName} ne peut pas dépasser ${maximumLength} caractères.`
    );
  }

  return text;
}

function listNotes(userId, limit = 50) {
  const safeUserId = requireText(userId, "userId", 64);

  return listNotesStmt.all(
    safeUserId,
    normalizeLimit(limit)
  );
}

function addNote({ userId, content, authorId }) {
  const safeUserId = requireText(userId, "userId", 64);
  const safeContent = requireText(content, "content", 4000);
  const safeAuthorId = requireText(authorId, "authorId", 64);

  const result = addNoteStmt.run(
    safeUserId,
    safeContent,
    safeAuthorId
  );

  return {
    id: Number(result.lastInsertRowid),
  };
}

function deleteNote(noteId) {
  const id = Number.parseInt(noteId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Identifiant de note invalide.");
  }

  const result = deleteNoteStmt.run(id);

  return {
    deleted: result.changes > 0,
  };
}

function listSanctions(userId, limit = 50) {
  const safeUserId = requireText(userId, "userId", 64);

  return listSanctionsStmt.all(
    safeUserId,
    normalizeLimit(limit)
  );
}

function addSanction({
  userId,
  type,
  reason,
  authorId,
  expiresAt,
}) {
  const safeUserId = requireText(userId, "userId", 64);
  const safeType = requireText(type, "type", 100);
  const safeReason = requireText(reason, "reason", 4000);
  const safeAuthorId = requireText(authorId, "authorId", 64);

  const safeExpiresAt = expiresAt
    ? String(expiresAt).trim()
    : null;

  const result = addSanctionStmt.run(
    safeUserId,
    safeType,
    safeReason,
    safeAuthorId,
    safeExpiresAt
  );

  return {
    id: Number(result.lastInsertRowid),
  };
}

function updateSanctionStatus(sanctionId, status) {
  const id = Number.parseInt(sanctionId, 10);

  const allowedStatuses = new Set([
    "active",
    "expired",
    "cancelled",
  ]);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Identifiant de sanction invalide.");
  }

  const safeStatus = String(status || "")
    .trim()
    .toLowerCase();

  if (!allowedStatuses.has(safeStatus)) {
    throw new Error("Statut de sanction invalide.");
  }

  const result = updateSanctionStatusStmt.run(
    safeStatus,
    id
  );

  return {
    updated: result.changes > 0,
  };
}

function deleteSanction(sanctionId) {
  const id = Number.parseInt(sanctionId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Identifiant de sanction invalide.");
  }

  const result = deleteSanctionStmt.run(id);

  return {
    deleted: result.changes > 0,
  };
}

function listActivity(limit = 50) {
  return activityStmt.all(
    normalizeLimit(limit)
  );
}

function listOfficerActivity(userId, limit = 50) {
  const safeUserId = requireText(userId, "userId", 64);

  return officerActivityStmt.all(
    safeUserId,
    normalizeLimit(limit)
  );
}

function closeDatabase() {
  db.close();
}

console.log(`✅ Dashboard SQLite connecté : ${databasePath}`);

module.exports = {
  listNotes,
  addNote,
  deleteNote,
  listSanctions,
  addSanction,
  updateSanctionStatus,
  deleteSanction,
  listActivity,
  listOfficerActivity,
  closeDatabase,
};