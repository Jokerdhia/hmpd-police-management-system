const session = require("express-session");
const { pool, ready: databaseReady } = require("../database");

// V7.2.1 : le stockage des sessions partage le pool PostgreSQL principal.
// Cela évite un second pool Neon et réduit le nombre de connexions ouvertes.
const ready = databaseReady.then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS dashboard_sessions (
    sid TEXT PRIMARY KEY,
    sess JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expire
    ON dashboard_sessions(expire);
`)).then(() => {
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

    // Évite une écriture Neon à chaque requête quand rolling=true.
    // La durée de session est prolongée au maximum une fois toutes les 15 min.
    this.touchIntervalMs = Math.max(60 * 1000, Number.parseInt(process.env.SESSION_TOUCH_INTERVAL_MS, 10) || 15 * 60 * 1000);

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
    const newExpiry = getExpiry(sessionData);
    ready
      .then(() => pool.query(
        `UPDATE dashboard_sessions
         SET expire = $2
         WHERE sid = $1
           AND expire < $2::timestamptz - ($3::text || ' milliseconds')::interval`,
        [sid, newExpiry, String(this.touchIntervalMs)]
      ))
      .then(() => callback(null))
      .catch((error) => callback(error));
  }
}

module.exports = new PostgreSqlSessionStore();
