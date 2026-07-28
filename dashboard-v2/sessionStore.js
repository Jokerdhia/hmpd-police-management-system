const session = require("express-session");
const { Pool } = require("pg");

const RAW_DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const DATABASE_URL = RAW_DATABASE_URL.replace(
  /sslmode=(prefer|require|verify-ca)(?=&|$)/i,
  "sslmode=verify-full"
);

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL est obligatoire pour stocker les sessions dans PostgreSQL.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : undefined,
  max: Number.parseInt(process.env.SESSION_DATABASE_POOL_MAX, 10) || 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error("❌ Erreur PostgreSQL du stockage des sessions :", error?.message || error);
});

const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS dashboard_sessions (
    sid TEXT PRIMARY KEY,
    sess JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expire
    ON dashboard_sessions(expire);
`).then(() => {
  console.log("✅ Sessions du dashboard stockées dans Neon PostgreSQL.");
});

function getExpiry(sessionData) {
  const cookieExpiry = sessionData?.cookie?.expires;
  const expiry = cookieExpiry ? new Date(cookieExpiry) : null;

  if (expiry && Number.isFinite(expiry.getTime())) {
    return expiry;
  }

  const maxAge = Number(sessionData?.cookie?.maxAge);
  const duration = Number.isFinite(maxAge) && maxAge > 0
    ? maxAge
    : 8 * 60 * 60 * 1000;

  return new Date(Date.now() + duration);
}

class PostgreSqlSessionStore extends session.Store {
  constructor() {
    super();

    const pruneIntervalMs =
      Number.parseInt(process.env.SESSION_PRUNE_INTERVAL_MS, 10) ||
      15 * 60 * 1000;

    this.pruneTimer = setInterval(() => {
      this.pruneExpiredSessions().catch((error) => {
        console.error("❌ Nettoyage des sessions expirées :", error?.message || error);
      });
    }, Math.max(pruneIntervalMs, 60 * 1000));

    this.pruneTimer.unref?.();
  }

  async pruneExpiredSessions() {
    await ready;
    await pool.query("DELETE FROM dashboard_sessions WHERE expire <= CURRENT_TIMESTAMP");
  }

  get(sid, callback) {
    (async () => {
      await ready;

      const result = await pool.query(
        `DELETE FROM dashboard_sessions
         WHERE sid = $1 AND expire <= CURRENT_TIMESTAMP
         RETURNING sid`,
        [sid]
      );

      if (result.rowCount > 0) {
        return null;
      }

      const sessionResult = await pool.query(
        `SELECT sess
         FROM dashboard_sessions
         WHERE sid = $1 AND expire > CURRENT_TIMESTAMP`,
        [sid]
      );

      return sessionResult.rows[0]?.sess || null;
    })()
      .then((sessionData) => callback(null, sessionData))
      .catch((error) => callback(error));
  }

  set(sid, sessionData, callback = () => {}) {
    (async () => {
      await ready;

      await pool.query(
        `INSERT INTO dashboard_sessions (sid, sess, expire)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (sid)
         DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, JSON.stringify(sessionData), getExpiry(sessionData)]
      );
    })()
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  destroy(sid, callback = () => {}) {
    ready
      .then(() => pool.query("DELETE FROM dashboard_sessions WHERE sid = $1", [sid]))
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  touch(sid, sessionData, callback = () => {}) {
    ready
      .then(() => pool.query(
        `UPDATE dashboard_sessions
         SET expire = $2, sess = $3::jsonb
         WHERE sid = $1`,
        [sid, getExpiry(sessionData), JSON.stringify(sessionData)]
      ))
      .then(() => callback(null))
      .catch((error) => callback(error));
  }
}

module.exports = new PostgreSqlSessionStore();
