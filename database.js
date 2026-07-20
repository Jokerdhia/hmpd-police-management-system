const path = require("path");
const { DatabaseSync } = require("node:sqlite");

/*
|--------------------------------------------------------------------------
| Ouverture de la base de données
|--------------------------------------------------------------------------
*/

const DATABASE_PATH = path.join(__dirname, "hmpd.sqlite");

const database = new DatabaseSync(DATABASE_PATH);

/*
|--------------------------------------------------------------------------
| Configuration SQLite
|--------------------------------------------------------------------------
*/

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
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
  ) STRICT;

  CREATE TABLE IF NOT EXISTS points_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('add', 'remove')),
    amount INTEGER NOT NULL CHECK(amount >= 0),
    old_points INTEGER NOT NULL,
    new_points INTEGER NOT NULL,
    reason TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
      REFERENCES officers(user_id)
      ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_points_history_user_id
  ON points_history(user_id);

  CREATE INDEX IF NOT EXISTS idx_points_history_created_at
  ON points_history(created_at);
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
  INSERT INTO officers (
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
| Fonctions publiques
|--------------------------------------------------------------------------
*/

function getOfficer(userId) {
  if (!userId || typeof userId !== "string") {
    throw new Error("L'identifiant du policier est invalide.");
  }

  let officer = findOfficerStatement.get(userId);

  if (!officer) {
    createOfficerStatement.run(userId);
    officer = findOfficerStatement.get(userId);
  }

  return officer;
}

function updateOfficer(userId, points, grade) {
  if (!userId || typeof userId !== "string") {
    throw new Error("L'identifiant du policier est invalide.");
  }

  if (!Number.isInteger(points) || points < 0) {
    throw new Error(
      "Le nombre de points doit être un entier positif ou égal à zéro."
    );
  }

  if (!grade || typeof grade !== "string") {
    throw new Error("Le grade est invalide.");
  }

  getOfficer(userId);

  updateOfficerStatement.run(
    points,
    grade,
    userId
  );

  return getOfficer(userId);
}

function addPointsHistory({
  userId,
  action,
  amount,
  oldPoints,
  newPoints,
  reason,
  moderatorId,
}) {
  if (!userId || typeof userId !== "string") {
    throw new Error("L'identifiant du policier est invalide.");
  }

  if (!["add", "remove"].includes(action)) {
    throw new Error(
      "L'action doit être 'add' ou 'remove'."
    );
  }

  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(
      "Le nombre de points de l'historique est invalide."
    );
  }

  if (!Number.isInteger(oldPoints) || oldPoints < 0) {
    throw new Error("L'ancien total de points est invalide.");
  }

  if (!Number.isInteger(newPoints) || newPoints < 0) {
    throw new Error("Le nouveau total de points est invalide.");
  }

  if (!reason || typeof reason !== "string") {
    throw new Error("La raison est obligatoire.");
  }

  if (!moderatorId || typeof moderatorId !== "string") {
    throw new Error(
      "L'identifiant du responsable est invalide."
    );
  }

  getOfficer(userId);

  addHistoryStatement.run(
    userId,
    action,
    amount,
    oldPoints,
    newPoints,
    reason,
    moderatorId
  );
}

function changeOfficerPoints({
  userId,
  action,
  amount,
  grade,
  reason,
  moderatorId,
}) {
  if (!userId || typeof userId !== "string") {
    throw new Error("L'identifiant du policier est invalide.");
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(
      "Le nombre de points doit être supérieur à zéro."
    );
  }

  if (!grade || typeof grade !== "string") {
    throw new Error("Le grade est invalide.");
  }

  if (!reason || typeof reason !== "string") {
    throw new Error("La raison est obligatoire.");
  }

  if (!moderatorId || typeof moderatorId !== "string") {
    throw new Error(
      "L'identifiant du responsable est invalide."
    );
  }

  const officer = getOfficer(userId);
  const oldPoints = Number(officer.points);

  let actualAmount = amount;
  let newPoints;

  if (action === "add") {
    newPoints = oldPoints + amount;
  } else if (action === "remove") {
    actualAmount = Math.min(
      amount,
      oldPoints
    );

    newPoints = oldPoints - actualAmount;
  } else {
    throw new Error(
      "L'action doit être 'add' ou 'remove'."
    );
  }

  database.exec("BEGIN");

  try {
    updateOfficerStatement.run(
      newPoints,
      grade,
      userId
    );

    addHistoryStatement.run(
      userId,
      action,
      actualAmount,
      oldPoints,
      newPoints,
      reason,
      moderatorId
    );

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    userId,
    action,
    amount: actualAmount,
    oldPoints,
    newPoints,
    grade,
  };
}

function getOfficerHistory(userId, limit = 10) {
  if (!userId || typeof userId !== "string") {
    throw new Error("L'identifiant du policier est invalide.");
  }

  const parsedLimit = Number(limit);

  const safeLimit = Math.min(
    Math.max(
      Number.isInteger(parsedLimit)
        ? parsedLimit
        : 10,
      1
    ),
    25
  );

  return getHistoryStatement.all(
    userId,
    safeLimit
  );
}

function getLeaderboard(limit = 10) {
  const parsedLimit = Number(limit);

  const safeLimit = Math.min(
    Math.max(
      Number.isInteger(parsedLimit)
        ? parsedLimit
        : 10,
      1
    ),
    25
  );

  return getLeaderboardStatement.all(
    safeLimit
  );
}

function getAllOfficers() {
  return getAllOfficersStatement.all();
}

function countOfficers() {
  const result = countOfficersStatement.get();

  return Number(result.total);
}

function closeDatabase() {
  database.close();
}

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