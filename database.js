const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL est obligatoire pour utiliser Neon PostgreSQL.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  max: Number.parseInt(process.env.DATABASE_POOL_MAX, 10) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error("❌ Erreur PostgreSQL inattendue :", error?.message || error);
});

const ready = (async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS officers (
      user_id TEXT PRIMARY KEY,
      points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
      grade TEXT NOT NULL DEFAULT 'Academy',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS points_history (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES officers(user_id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('add', 'remove')),
      amount INTEGER NOT NULL CHECK(amount >= 0),
      old_points INTEGER NOT NULL CHECK(old_points >= 0),
      new_points INTEGER NOT NULL CHECK(new_points >= 0),
      reason TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_points_history_user_id ON points_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_points_history_created_at ON points_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_officers_points ON officers(points);
  `);
  const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM officers");
  console.log("✅ Neon PostgreSQL connecté.");
  console.log(`👮 Policiers enregistrés : ${rows[0]?.total || 0}`);
})();

function normalizeUserId(userId) {
  const value = String(userId || "").trim();
  if (!/^\d{16,22}$/.test(value)) throw new Error("L'identifiant Discord du policier est invalide.");
  return value;
}
function normalizeGrade(grade) {
  const value = String(grade || "").trim();
  if (!value || value.length > 100) throw new Error("Le grade est invalide.");
  return value;
}
function normalizeReason(reason) {
  const value = String(reason || "").trim();
  if (!value || value.length > 2000) throw new Error("La raison est invalide.");
  return value;
}
function normalizeModeratorId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 100) throw new Error("L'identifiant du responsable est invalide.");
  return id;
}
function normalizePoints(value) {
  const points = Number(value);
  if (!Number.isInteger(points) || points < 0) throw new Error("Le nombre de points est invalide.");
  return points;
}
function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Le nombre de points doit être supérieur à zéro.");
  return amount;
}
function normalizeLimit(value, fallback = 10, maximum = 100) {
  const limit = Number.parseInt(value, 10);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, maximum) : fallback;
}

async function ensureOfficer(client, userId) {
  await client.query(
    `INSERT INTO officers (user_id, points, grade) VALUES ($1, 0, 'Academy') ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function getOfficer(userId) {
  await ready;
  const safeUserId = normalizeUserId(userId);
  await ensureOfficer(pool, safeUserId);
  const { rows } = await pool.query(`SELECT user_id, points, grade, created_at, updated_at FROM officers WHERE user_id=$1`, [safeUserId]);
  return rows[0] || null;
}

async function updateOfficer(userId, points, grade) {
  await ready;
  const safeUserId = normalizeUserId(userId);
  const safePoints = normalizePoints(points);
  const safeGrade = normalizeGrade(grade);
  await ensureOfficer(pool, safeUserId);
  const { rows } = await pool.query(
    `UPDATE officers SET points=$2, grade=$3, updated_at=CURRENT_TIMESTAMP WHERE user_id=$1 RETURNING user_id, points, grade, created_at, updated_at`,
    [safeUserId, safePoints, safeGrade]
  );
  return rows[0];
}

async function addPointsHistory({ userId, action, amount, oldPoints, newPoints, reason, moderatorId }) {
  await ready;
  const safeUserId = normalizeUserId(userId);
  const safeAction = String(action || "").toLowerCase();
  if (!["add", "remove"].includes(safeAction)) throw new Error("Action invalide.");
  await ensureOfficer(pool, safeUserId);
  const { rows } = await pool.query(
    `INSERT INTO points_history (user_id, action, amount, old_points, new_points, reason, moderator_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [safeUserId, safeAction, normalizePoints(amount), normalizePoints(oldPoints), normalizePoints(newPoints), normalizeReason(reason), normalizeModeratorId(moderatorId)]
  );
  return { id: Number(rows[0].id) };
}

async function changeOfficerPoints({ userId, action, amount, grade, reason, moderatorId }) {
  await ready;
  const safeUserId = normalizeUserId(userId);
  const safeAction = String(action || "").trim().toLowerCase();
  const safeAmount = normalizeAmount(amount);
  const safeGrade = normalizeGrade(grade);
  const safeReason = normalizeReason(reason);
  const safeModeratorId = normalizeModeratorId(moderatorId);
  if (!["add", "remove"].includes(safeAction)) throw new Error("Action invalide.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureOfficer(client, safeUserId);
    const current = await client.query("SELECT points FROM officers WHERE user_id=$1 FOR UPDATE", [safeUserId]);
    const oldPoints = Number(current.rows[0]?.points || 0);
    const actualAmount = safeAction === "remove" ? Math.min(safeAmount, oldPoints) : safeAmount;
    const newPoints = safeAction === "add" ? oldPoints + actualAmount : oldPoints - actualAmount;

    await client.query("UPDATE officers SET points=$2, grade=$3, updated_at=CURRENT_TIMESTAMP WHERE user_id=$1", [safeUserId, newPoints, safeGrade]);
    if (!(safeAction === "remove" && actualAmount === 0)) {
      await client.query(
        `INSERT INTO points_history (user_id, action, amount, old_points, new_points, reason, moderator_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [safeUserId, safeAction, actualAmount, oldPoints, newPoints, safeReason, safeModeratorId]
      );
    }
    await client.query("COMMIT");
    return { userId: safeUserId, action: safeAction, amount: actualAmount, oldPoints, newPoints, grade: safeGrade };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getOfficerHistory(userId, limit = 10) {
  await ready;
  const { rows } = await pool.query(
    `SELECT id, user_id, action, amount, old_points, new_points, reason, moderator_id, created_at FROM points_history WHERE user_id=$1 ORDER BY id DESC LIMIT $2`,
    [normalizeUserId(userId), normalizeLimit(limit)]
  );
  return rows;
}
async function getLeaderboard(limit = 10) {
  await ready;
  const { rows } = await pool.query(`SELECT user_id, points, grade, created_at, updated_at FROM officers ORDER BY points DESC, updated_at ASC LIMIT $1`, [normalizeLimit(limit)]);
  return rows;
}
async function getAllOfficers() {
  await ready;
  const { rows } = await pool.query(`SELECT user_id, points, grade, created_at, updated_at FROM officers ORDER BY points DESC, updated_at ASC`);
  return rows;
}
async function countOfficers() {
  await ready;
  const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM officers");
  return Number(rows[0]?.total || 0);
}
async function closeDatabase() {
  await pool.end();
  console.log("✅ Connexion Neon PostgreSQL fermée.");
}

module.exports = { ready, getOfficer, updateOfficer, changeOfficerPoints, addPointsHistory, getOfficerHistory, getLeaderboard, getAllOfficers, countOfficers, closeDatabase };
