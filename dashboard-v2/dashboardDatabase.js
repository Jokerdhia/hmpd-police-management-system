const { pool, ready: coreReady } = require("../database");

// V2: le dashboard et le bot partagent le même pool PostgreSQL.
// Cela évite de doubler les connexions Neon sur Render.
const ready = coreReady.then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS officer_notes (
    id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL,
    author_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS officer_sanctions (
    id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, sanction_type TEXT NOT NULL,
    reason TEXT NOT NULL, author_id TEXT NOT NULL, expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE officer_notes ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS idx_notes_user ON officer_notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_notes_user_created ON officer_notes(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notes_unread ON officer_notes(user_id, read_at);
  CREATE INDEX IF NOT EXISTS idx_sanctions_user ON officer_sanctions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sanctions_user_status ON officer_sanctions(user_id, status, created_at DESC);
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_log(target_id, created_at DESC);
`)).then(() => console.log("✅ Tables Dashboard PostgreSQL prêtes."));

function lim(v,f=50,m=200){const n=parseInt(v,10);return Number.isInteger(n)&&n>0?Math.min(n,m):f}
function txt(v,n,m){const s=String(v||"").trim();if(!s||s.length>m)throw new Error(`${n} est invalide.`);return s}
async function listNotes(userId,limit=50){await ready;return (await pool.query("SELECT id,user_id,content,author_id,created_at,read_at FROM officer_notes WHERE user_id=$1 ORDER BY id DESC LIMIT $2",[txt(userId,"userId",64),lim(limit)])).rows}
async function countUnreadNotes(userId){await ready;const r=await pool.query("SELECT COUNT(*)::int AS count FROM officer_notes WHERE user_id=$1 AND read_at IS NULL",[txt(userId,"userId",64)]);return Number(r.rows[0]?.count||0)}
async function markNotesRead(userId){await ready;const r=await pool.query("UPDATE officer_notes SET read_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND read_at IS NULL",[txt(userId,"userId",64)]);return{updated:r.rowCount}}
async function addNote({userId,content,authorId}){await ready;const r=await pool.query("INSERT INTO officer_notes(user_id,content,author_id) VALUES($1,$2,$3) RETURNING id",[txt(userId,"userId",64),txt(content,"content",4000),txt(authorId,"authorId",64)]);return{id:Number(r.rows[0].id)}}
async function deleteNote(id){await ready;const r=await pool.query("DELETE FROM officer_notes WHERE id=$1",[parseInt(id,10)]);return{deleted:r.rowCount>0}}
async function listSanctions(userId,limit=50){await ready;return (await pool.query("SELECT id,user_id,sanction_type,reason,author_id,expires_at,status,created_at FROM officer_sanctions WHERE user_id=$1 ORDER BY id DESC LIMIT $2",[txt(userId,"userId",64),lim(limit)])).rows}
async function addSanction({userId,type,reason,authorId,expiresAt}){await ready;const r=await pool.query("INSERT INTO officer_sanctions(user_id,sanction_type,reason,author_id,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id",[txt(userId,"userId",64),txt(type,"type",100),txt(reason,"reason",4000),txt(authorId,"authorId",64),expiresAt||null]);return{id:Number(r.rows[0].id)}}
async function updateSanctionStatus(id,status){await ready;const s=String(status||"").toLowerCase();if(!["active","expired","cancelled"].includes(s))throw new Error("Statut invalide.");const r=await pool.query("UPDATE officer_sanctions SET status=$1 WHERE id=$2",[s,parseInt(id,10)]);return{updated:r.rowCount>0}}
async function deleteSanction(id){await ready;const r=await pool.query("DELETE FROM officer_sanctions WHERE id=$1",[parseInt(id,10)]);return{deleted:r.rowCount>0}}
async function listActivity(limit=50){await ready;return (await pool.query("SELECT id,user_id,action,amount,old_points,new_points,reason,moderator_id,created_at FROM points_history ORDER BY id DESC LIMIT $1",[lim(limit)])).rows}
async function listOfficerActivity(userId,limit=50){await ready;return (await pool.query("SELECT id,user_id,action,amount,old_points,new_points,reason,moderator_id,created_at FROM points_history WHERE user_id=$1 ORDER BY id DESC LIMIT $2",[txt(userId,"userId",64),lim(limit)])).rows}
async function getAttendanceSessions(limit=100){
  await ready;
  return (await pool.query(`
    SELECT id,user_id,started_at,ended_at,duration_seconds,paused_at,
           COALESCE(paused_seconds,0) AS paused_seconds,
           COALESCE(pause_count,0) AS pause_count,
           started_by,ended_by,end_reason
    FROM attendance_sessions
    ORDER BY started_at DESC
    LIMIT $1`,[lim(limit,100,500)])).rows;
}
async function getAttendanceActive(){
  await ready;
  return (await pool.query(`
    SELECT id,user_id,started_at,paused_at,
           COALESCE(paused_seconds,0) AS paused_seconds,
           COALESCE(pause_count,0) AS pause_count,started_by
    FROM attendance_sessions
    WHERE ended_at IS NULL
    ORDER BY CASE WHEN paused_at IS NULL THEN 0 ELSE 1 END, started_at ASC`)).rows;
}
async function getAttendanceTotalsDashboard(period='week',limit=100){
  await ready;
  const allowed={day:'day',week:'week',month:'month'};
  const unit=allowed[period]||'week';
  const rows=(await pool.query(`
    SELECT user_id,
      SUM(CASE WHEN ended_at IS NULL THEN GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (COALESCE(paused_at,CURRENT_TIMESTAMP)-started_at)))::int
        - COALESCE(paused_seconds,0))
      ELSE COALESCE(duration_seconds,0) END)::bigint AS total_seconds,
      COUNT(*)::int AS sessions
    FROM attendance_sessions
    WHERE started_at >= date_trunc($1,CURRENT_TIMESTAMP)
    GROUP BY user_id
    ORDER BY total_seconds DESC
    LIMIT $2`,[unit,lim(limit,100,500)])).rows;
  return rows.map(r=>({...r,total_seconds:Number(r.total_seconds||0),sessions:Number(r.sessions||0)}));
}
async function getAttendanceDaily(days=7){
  await ready;
  const safe=Math.min(Math.max(parseInt(days,10)||7,1),31);
  const rows=(await pool.query(`
    WITH dates AS (
      SELECT generate_series(
        date_trunc('day',CURRENT_TIMESTAMP)-($1::int-1)*interval '1 day',
        date_trunc('day',CURRENT_TIMESTAMP),interval '1 day') AS day
    )
    SELECT d.day,
      COALESCE(SUM(CASE WHEN s.id IS NULL THEN 0 ELSE
        CASE WHEN s.ended_at IS NULL THEN GREATEST(0,
          FLOOR(EXTRACT(EPOCH FROM (COALESCE(s.paused_at,CURRENT_TIMESTAMP)-s.started_at)))::int
          - COALESCE(s.paused_seconds,0))
        ELSE COALESCE(s.duration_seconds,0) END END),0)::bigint AS total_seconds
    FROM dates d
    LEFT JOIN attendance_sessions s ON date_trunc('day',s.started_at)=d.day
    GROUP BY d.day ORDER BY d.day`,[safe])).rows;
  return rows.map(r=>({day:r.day,total_seconds:Number(r.total_seconds||0)}));
}

async function getOfficerAttendanceTotal(userId){
  await ready;
  const safeUserId=txt(userId,"userId",64);
  const result=await pool.query(`
    SELECT COALESCE(SUM(
      CASE WHEN ended_at IS NULL THEN GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (COALESCE(paused_at,CURRENT_TIMESTAMP)-started_at)))::int
        - COALESCE(paused_seconds,0))
      ELSE COALESCE(duration_seconds,0) END
    ),0)::bigint AS total_seconds,
    COUNT(*)::int AS sessions
    FROM attendance_sessions
    WHERE user_id=$1`,[safeUserId]);
  const row=result.rows[0]||{};
  return {total_seconds:Number(row.total_seconds||0),sessions:Number(row.sessions||0)};
}

async function getWeeklyBestOfficer(){
  await ready;
  const result=await pool.query(`
    WITH period AS (
      SELECT
        (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Brussels') AT TIME ZONE 'Europe/Brussels') AS starts_at,
        ((date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Brussels') + interval '7 days') AT TIME ZONE 'Europe/Brussels') AS ends_at
    ), weekly_scores AS (
      SELECT
        user_id,
        SUM(CASE WHEN action='add' THEN amount WHEN action='remove' THEN -amount ELSE 0 END)::bigint AS weekly_points,
        SUM(CASE WHEN action='add' THEN amount ELSE 0 END)::bigint AS points_added,
        SUM(CASE WHEN action='remove' THEN amount ELSE 0 END)::bigint AS points_removed
      FROM points_history, period
      WHERE created_at >= period.starts_at AND created_at < period.ends_at
      GROUP BY user_id
    )
    SELECT w.user_id,w.weekly_points,w.points_added,w.points_removed,p.starts_at,p.ends_at
    FROM weekly_scores w CROSS JOIN period p
    WHERE w.weekly_points > 0
    ORDER BY w.weekly_points DESC,w.points_added DESC,w.user_id ASC
    LIMIT 1`);
  if(result.rows.length){
    const row=result.rows[0];
    return {
      user_id:String(row.user_id),
      weekly_points:Number(row.weekly_points||0),
      points_added:Number(row.points_added||0),
      points_removed:Number(row.points_removed||0),
      starts_at:row.starts_at,
      ends_at:row.ends_at,
    };
  }
  const period=await pool.query(`
    SELECT
      (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Brussels') AT TIME ZONE 'Europe/Brussels') AS starts_at,
      ((date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Brussels') + interval '7 days') AT TIME ZONE 'Europe/Brussels') AS ends_at`);
  return {user_id:null,weekly_points:0,points_added:0,points_removed:0,...period.rows[0]};
}

async function closeDatabase(){ /* pool partagé: fermeture gérée par database.js */ }
module.exports={listNotes,countUnreadNotes,markNotesRead,addNote,deleteNote,listSanctions,addSanction,updateSanctionStatus,deleteSanction,listActivity,listOfficerActivity,getAttendanceSessions,getAttendanceActive,getAttendanceTotalsDashboard,getAttendanceDaily,getOfficerAttendanceTotal,getWeeklyBestOfficer,closeDatabase};
