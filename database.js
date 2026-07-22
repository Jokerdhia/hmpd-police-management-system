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

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMPTZ,
      duration_seconds INTEGER,
      paused_at TIMESTAMPTZ,
      paused_seconds INTEGER NOT NULL DEFAULT 0,
      pause_count INTEGER NOT NULL DEFAULT 0,
      started_by TEXT NOT NULL,
      ended_by TEXT,
      end_reason TEXT,
      CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_one_active_per_user
      ON attendance_sessions(user_id) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_attendance_user_started
      ON attendance_sessions(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attendance_active
      ON attendance_sessions(started_at) WHERE ended_at IS NULL;

    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE attendance_sessions
      ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

    ALTER TABLE attendance_sessions
      ADD COLUMN IF NOT EXISTS paused_seconds INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE attendance_sessions
      ADD COLUMN IF NOT EXISTS pause_count INTEGER NOT NULL DEFAULT 0;
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
async function startAttendance(userId, startedBy = userId) {
  await ready;
  const safeUserId = normalizeUserId(userId);
  const safeStartedBy = normalizeModeratorId(startedBy);

  try {
    const { rows } = await pool.query(
      `INSERT INTO attendance_sessions (
         user_id,
         started_by,
         paused_at,
         paused_seconds,
         pause_count
       )
       VALUES ($1, $2, NULL, 0, 0)
       RETURNING
         id,
         user_id,
         started_at,
         ended_at,
         duration_seconds,
         paused_at,
         paused_seconds,
         pause_count`,
      [safeUserId, safeStartedBy]
    );

    return { started: true, session: rows[0] };
  } catch (error) {
    if (error?.code === "23505") {
      const current = await getActiveAttendance(safeUserId);
      return {
        started: false,
        reason: "already_active",
        session: current,
      };
    }

    throw error;
  }
}

async function pauseAttendance(userId) {
  await ready;
  const safeUserId = normalizeUserId(userId);

  const { rows } = await pool.query(
    `UPDATE attendance_sessions
     SET paused_at = CURRENT_TIMESTAMP,
         pause_count = COALESCE(pause_count, 0) + 1
     WHERE id = (
       SELECT id
       FROM attendance_sessions
       WHERE user_id = $1
         AND ended_at IS NULL
         AND paused_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1
     )
     RETURNING
       id,
       user_id,
       started_at,
       paused_at,
       paused_seconds,
       pause_count`,
    [safeUserId]
  );

  if (rows[0]) {
    return { paused: true, session: rows[0] };
  }

  const current = await getActiveAttendance(safeUserId);

  return {
    paused: false,
    reason: current ? "already_paused" : "not_active",
    session: current,
  };
}

async function resumeAttendance(userId) {
  await ready;
  const safeUserId = normalizeUserId(userId);

  const { rows } = await pool.query(
    `UPDATE attendance_sessions
     SET paused_seconds =
           COALESCE(paused_seconds, 0)
           + GREATEST(
               0,
               FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - paused_at)))::int
             ),
         paused_at = NULL
     WHERE id = (
       SELECT id
       FROM attendance_sessions
       WHERE user_id = $1
         AND ended_at IS NULL
         AND paused_at IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 1
     )
     RETURNING
       id,
       user_id,
       started_at,
       paused_at,
       paused_seconds,
       pause_count`,
    [safeUserId]
  );

  if (rows[0]) {
    return { resumed: true, session: rows[0] };
  }

  const current = await getActiveAttendance(safeUserId);

  return {
    resumed: false,
    reason: current ? "not_paused" : "not_active",
    session: current,
  };
}

async function stopAttendance(
  userId,
  endedBy = userId,
  endReason = "manual"
) {
  await ready;

  const safeUserId = normalizeUserId(userId);
  const safeEndedBy = normalizeModeratorId(endedBy);
  const safeReason =
    String(endReason || "manual").trim().slice(0, 200) || "manual";

  const { rows } = await pool.query(
    `UPDATE attendance_sessions
     SET ended_at = CURRENT_TIMESTAMP,
         paused_seconds =
           COALESCE(paused_seconds, 0)
           + CASE
               WHEN paused_at IS NOT NULL
               THEN GREATEST(
                 0,
                 FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - paused_at)))::int
               )
               ELSE 0
             END,
         duration_seconds = GREATEST(
           0,
           FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)))::int
           - COALESCE(paused_seconds, 0)
           - CASE
               WHEN paused_at IS NOT NULL
               THEN GREATEST(
                 0,
                 FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - paused_at)))::int
               )
               ELSE 0
             END
         ),
         paused_at = NULL,
         ended_by = $2,
         end_reason = $3
     WHERE id = (
       SELECT id
       FROM attendance_sessions
       WHERE user_id = $1
         AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1
     )
     RETURNING
       id,
       user_id,
       started_at,
       ended_at,
       duration_seconds,
       paused_at,
       paused_seconds,
       pause_count,
       started_by,
       ended_by,
       end_reason`,
    [safeUserId, safeEndedBy, safeReason]
  );

  return rows[0]
    ? { stopped: true, session: rows[0] }
    : { stopped: false, reason: "not_active" };
}

async function getActiveAttendance(userId) {
  await ready;

  const { rows } = await pool.query(
    `SELECT
       id,
       user_id,
       started_at,
       ended_at,
       duration_seconds,
       paused_at,
       COALESCE(paused_seconds, 0) AS paused_seconds,
       COALESCE(pause_count, 0) AS pause_count,
       started_by
     FROM attendance_sessions
     WHERE user_id = $1
       AND ended_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1`,
    [normalizeUserId(userId)]
  );

  return rows[0] || null;
}

async function getActiveAttendances() {
  await ready;

  const { rows } = await pool.query(
    `SELECT
       id,
       user_id,
       started_at,
       paused_at,
       COALESCE(paused_seconds, 0) AS paused_seconds,
       COALESCE(pause_count, 0) AS pause_count,
       started_by
     FROM attendance_sessions
     WHERE ended_at IS NULL
     ORDER BY
       CASE WHEN paused_at IS NULL THEN 0 ELSE 1 END,
       started_at ASC`
  );

  return rows;
}

async function getAttendanceTotals(period = "week", limit = 25) {
  await ready;

  const allowed = {
    day: "day",
    week: "week",
    month: "month",
  };

  const unit = allowed[period] || "week";

  const { rows } = await pool.query(
    `SELECT
       user_id,
       SUM(
         CASE
           WHEN ended_at IS NULL
           THEN GREATEST(
             0,
             FLOOR(EXTRACT(EPOCH FROM (
               COALESCE(paused_at, CURRENT_TIMESTAMP) - started_at
             )))::int
             - COALESCE(paused_seconds, 0)
           )
           ELSE COALESCE(duration_seconds, 0)
         END
       )::bigint AS total_seconds
     FROM attendance_sessions
     WHERE started_at >= date_trunc($1, CURRENT_TIMESTAMP)
     GROUP BY user_id
     ORDER BY total_seconds DESC
     LIMIT $2`,
    [unit, normalizeLimit(limit, 25, 100)]
  );

  return rows.map((row) => ({
    ...row,
    total_seconds: Number(row.total_seconds || 0),
  }));
}

async function setBotSetting(key, value) {
  await ready;
  const safeKey = String(key || "").trim();
  if (!safeKey || safeKey.length > 100) throw new Error("Clé de paramètre invalide.");
  const safeValue = String(value || "").trim();
  await pool.query(
    `INSERT INTO bot_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [safeKey, safeValue]
  );
}

async function getBotSetting(key) {
  await ready;
  const { rows } = await pool.query(`SELECT value FROM bot_settings WHERE key=$1`, [String(key || "").trim()]);
  return rows[0]?.value || null;
}

async function closeDatabase() {
  await pool.end();
  console.log("✅ Connexion Neon PostgreSQL fermée.");
}

module.exports = {
  ready, getOfficer, updateOfficer, changeOfficerPoints, addPointsHistory,
  getOfficerHistory, getLeaderboard, getAllOfficers, countOfficers,
  startAttendance,
  pauseAttendance,
  resumeAttendance,
  stopAttendance,
  getActiveAttendance,
  getActiveAttendances,
  getAttendanceTotals,
  setBotSetting,
  getBotSetting,
  closeDatabase
};
