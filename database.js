const path = require("path");
const { DatabaseSync } = require("node:sqlite");

/*
|--------------------------------------------------------------------------
| Chemin de la base SQLite
|--------------------------------------------------------------------------
|
| DATABASE_PATH permet d'utiliser un disque persistant sur Render.
| Sans cette variable, hmpd.sqlite sera utilisé à la racine du projet.
|
*/

const DATABASE_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, "hmpd.sqlite");

const database = new DatabaseSync(DATABASE_PATH);

/*
|--------------------------------------------------------------------------
| Configuration SQLite
|--------------------------------------------------------------------------
*/

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

/*
|--------------------------------------------------------------------------
| Création des tables
|--------------------------------------------------------------------------
*/

database.exec(`
  CREATE TABLE IF NOT EXISTS officers (
    user_id TEXT PRIMARY KEY,
    points INTEGER NOT NULL DEFAULT 0,
    grade TEXT NOT NULL DEFAULT 'Academy',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS points_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('add', 'remove')),
    amount INTEGER NOT NULL CHECK(amount >= 0),
    old_points INTEGER NOT NULL CHECK(old_points >= 0),
    new_points INTEGER NOT NULL CHECK(new_points >= 0),
    reason TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
      REFERENCES officers(user_id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_points_history_user_id
    ON points_history(user_id);

  CREATE INDEX IF NOT EXISTS idx_points_history_created_at
    ON points_history(created_at);

  CREATE INDEX IF NOT EXISTS idx_officers_points
    ON officers(points);
`);

/*
|--------------------------------------------------------------------------
| Requêtes préparées
|--------------------------------------------------------------------------
*/

const findOfficerStatement = database.prepare(`
  SELECT
    user_id,
    points,
    grade,
    created_at,
    updated_at
  FROM officers
  WHERE user_id = ?
`);

const createOfficerStatement = database.prepare(`
  INSERT OR IGNORE INTO officers (
    user_id,
    points,
    grade
  )
  VALUES (?, 0, 'Academy')
`);

const updateOfficerStatement = database.prepare(`
  UPDATE officers
  SET
    points = ?,
    grade = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ?
`);

const addHistoryStatement = database.prepare(`
  INSERT INTO points_history (
    user_id,
    action,
    amount,
    old_points,
    new_points,
    reason,
    moderator_id
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getHistoryStatement = database.prepare(`
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

const getLeaderboardStatement = database.prepare(`
  SELECT
    user_id,
    points,
    grade,
    created_at,
    updated_at
  FROM officers
  ORDER BY points DESC, updated_at ASC
  LIMIT ?
`);

const getAllOfficersStatement = database.prepare(`
  SELECT
    user_id,
    points,
    grade,
    created_at,
    updated_at
  FROM officers
  ORDER BY points DESC, updated_at ASC
`);

const countOfficersStatement = database.prepare(`
  SELECT COUNT(*) AS total
  FROM officers
`);

/*
|--------------------------------------------------------------------------
| Validation
|--------------------------------------------------------------------------
*/

function normalizeUserId(userId) {
  const value = String(userId || "").trim();

  if (!value) {
    throw new Error(
      "L'identifiant Discord du policier est obligatoire."
    );
  }

  if (!/^\d{16,22}$/.test(value)) {
    throw new Error(
      "L'identifiant Discord du policier est invalide."
    );
  }

  return value;
}

function normalizeGrade(grade) {
  const value = String(grade || "").trim();

  if (!value) {
    throw new Error("Le grade est obligatoire.");
  }

  if (value.length > 100) {
    throw new Error(
      "Le grade ne peut pas dépasser 100 caractères."
    );
  }

  return value;
}

function normalizeReason(reason) {
  const value = String(reason || "").trim();

  if (!value) {
    throw new Error("La raison est obligatoire.");
  }

  if (value.length > 2000) {
    throw new Error(
      "La raison ne peut pas dépasser 2000 caractères."
    );
  }

  return value;
}

function normalizeModeratorId(moderatorId) {
  const value = String(moderatorId || "").trim();

  if (!value) {
    throw new Error(
      "L'identifiant du responsable est obligatoire."
    );
  }

  if (value.length > 100) {
    throw new Error(
      "L'identifiant du responsable est trop long."
    );
  }

  return value;
}

function normalizePoints(points) {
  const value = Number(points);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      "Le nombre de points doit être un entier positif ou égal à zéro."
    );
  }

  return value;
}

function normalizeAmount(amount) {
  const value = Number(amount);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      "Le nombre de points doit être un entier supérieur à zéro."
    );
  }

  return value;
}

function normalizeLimit(limit, fallback = 10, maximum = 100) {
  const value = Number.parseInt(limit, 10);

  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return Math.min(value, maximum);
}

/*
|--------------------------------------------------------------------------
| Fonctions publiques
|--------------------------------------------------------------------------
*/

/**
 * Récupère un policier.
 *
 * S'il n'existe pas encore, il est automatiquement créé avec :
 * - 0 point ;
 * - grade Academy.
 */
function getOfficer(userId) {
  const safeUserId = normalizeUserId(userId);

  let officer = findOfficerStatement.get(safeUserId);

  if (!officer) {
    createOfficerStatement.run(safeUserId);
    officer = findOfficerStatement.get(safeUserId);
  }

  return officer || null;
}

/**
 * Met directement à jour les points et le grade.
 *
 * Cette fonction est notamment utilisée par roleSyncService
 * lorsque le rôle Police est retiré.
 */
function updateOfficer(userId, points, grade) {
  const safeUserId = normalizeUserId(userId);
  const safePoints = normalizePoints(points);
  const safeGrade = normalizeGrade(grade);

  createOfficerStatement.run(safeUserId);

  const result = updateOfficerStatement.run(
    safePoints,
    safeGrade,
    safeUserId
  );

  if (result.changes === 0) {
    throw new Error(
      `Impossible de mettre à jour le policier ${safeUserId}.`
    );
  }

  return findOfficerStatement.get(safeUserId);
}

/**
 * Ajoute manuellement une entrée dans l'historique.
 */
function addPointsHistory({
  userId,
  action,
  amount,
  oldPoints,
  newPoints,
  reason,
  moderatorId,
}) {
  const safeUserId = normalizeUserId(userId);
  const safeAction = String(action || "").trim().toLowerCase();
  const safeAmount = Number(amount);
  const safeOldPoints = normalizePoints(oldPoints);
  const safeNewPoints = normalizePoints(newPoints);
  const safeReason = normalizeReason(reason);
  const safeModeratorId = normalizeModeratorId(moderatorId);

  if (!["add", "remove"].includes(safeAction)) {
    throw new Error(
      "L'action doit être « add » ou « remove »."
    );
  }

  if (!Number.isInteger(safeAmount) || safeAmount < 0) {
    throw new Error(
      "Le nombre de points de l'historique est invalide."
    );
  }

  createOfficerStatement.run(safeUserId);

  const result = addHistoryStatement.run(
    safeUserId,
    safeAction,
    safeAmount,
    safeOldPoints,
    safeNewPoints,
    safeReason,
    safeModeratorId
  );

  return {
    id: Number(result.lastInsertRowid),
  };
}

/**
 * Ajoute ou retire des points avec historique.
 *
 * Pour retirer tous les points :
 *
 * changeOfficerPoints({
 *   userId,
 *   action: "remove",
 *   amount: officer.points,
 *   grade: "Academy",
 *   reason: "...",
 *   moderatorId: "SYSTEM_ROLE_SYNC"
 * });
 */
function changeOfficerPoints({
  userId,
  action,
  amount,
  grade,
  reason,
  moderatorId,
}) {
  const safeUserId = normalizeUserId(userId);
  const safeAction = String(action || "").trim().toLowerCase();
  const safeAmount = normalizeAmount(amount);
  const safeGrade = normalizeGrade(grade);
  const safeReason = normalizeReason(reason);
  const safeModeratorId = normalizeModeratorId(moderatorId);

  if (!["add", "remove"].includes(safeAction)) {
    throw new Error(
      "L'action doit être « add » ou « remove »."
    );
  }

  const officer = getOfficer(safeUserId);
  const oldPoints = normalizePoints(officer.points);

  let actualAmount = safeAmount;
  let newPoints = oldPoints;

  if (safeAction === "add") {
    newPoints = oldPoints + safeAmount;
  }

  if (safeAction === "remove") {
    actualAmount = Math.min(safeAmount, oldPoints);
    newPoints = oldPoints - actualAmount;
  }

  /*
   * Lorsque le total est déjà à zéro, il n'est pas nécessaire
   * d'ajouter une opération de retrait vide dans l'historique.
   * Le grade est toutefois mis à jour.
   */
  if (safeAction === "remove" && actualAmount === 0) {
    const updatedOfficer = updateOfficer(
      safeUserId,
      0,
      safeGrade
    );

    return {
      userId: safeUserId,
      action: safeAction,
      amount: 0,
      oldPoints,
      newPoints: 0,
      grade: safeGrade,
      officer: updatedOfficer,
    };
  }

  database.exec("BEGIN IMMEDIATE TRANSACTION");

  try {
    updateOfficerStatement.run(
      newPoints,
      safeGrade,
      safeUserId
    );

    addHistoryStatement.run(
      safeUserId,
      safeAction,
      actualAmount,
      oldPoints,
      newPoints,
      safeReason,
      safeModeratorId
    );

    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "❌ Erreur pendant le rollback SQLite :",
        rollbackError
      );
    }

    throw error;
  }

  return {
    userId: safeUserId,
    action: safeAction,
    amount: actualAmount,
    oldPoints,
    newPoints,
    grade: safeGrade,
  };
}

/**
 * Historique d'un policier.
 */
function getOfficerHistory(userId, limit = 10) {
  const safeUserId = normalizeUserId(userId);
  const safeLimit = normalizeLimit(limit, 10, 100);

  return getHistoryStatement.all(
    safeUserId,
    safeLimit
  );
}

/**
 * Classement des policiers.
 */
function getLeaderboard(limit = 10) {
  const safeLimit = normalizeLimit(limit, 10, 100);

  return getLeaderboardStatement.all(safeLimit);
}

/**
 * Retourne tous les policiers enregistrés.
 *
 * Cette fonction est utilisée par roleSyncService.
 */
function getAllOfficers() {
  const officers = getAllOfficersStatement.all();

  return Array.isArray(officers)
    ? officers
    : [];
}

/**
 * Compte le nombre de policiers enregistrés.
 */
function countOfficers() {
  const result = countOfficersStatement.get();

  return Number(result?.total || 0);
}

/**
 * Ferme proprement SQLite.
 */
function closeDatabase() {
  try {
    database.close();
    console.log("✅ Base SQLite fermée.");
  } catch (error) {
    console.error(
      "❌ Impossible de fermer la base SQLite :",
      error?.message || error
    );
  }
}

console.log(`✅ Base SQLite connectée : ${DATABASE_PATH}`);
console.log(`👮 Policiers enregistrés : ${countOfficers()}`);

/*
|--------------------------------------------------------------------------
| Exportation
|--------------------------------------------------------------------------
*/

module.exports = {
  getOfficer,
  updateOfficer,
  changeOfficerPoints,
  addPointsHistory,
  getOfficerHistory,
  getLeaderboard,
  getAllOfficers,
  countOfficers,
  closeDatabase,
};