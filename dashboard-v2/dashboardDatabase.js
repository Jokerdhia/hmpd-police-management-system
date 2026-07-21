const { Pool } = require("pg");
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) throw new Error("DATABASE_URL est obligatoire pour Neon PostgreSQL.");
const pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false } });
const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS officer_notes (
    id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL,
    author_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS officer_sanctions (
    id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, sanction_type TEXT NOT NULL,
    reason TEXT NOT NULL, author_id TEXT NOT NULL, expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_notes_user ON officer_notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_sanctions_user ON officer_sanctions(user_id);
`).then(() => console.log("✅ Dashboard connecté à Neon PostgreSQL."));

function lim(v,f=50,m=200){const n=parseInt(v,10);return Number.isInteger(n)&&n>0?Math.min(n,m):f}
function txt(v,n,m){const s=String(v||"").trim();if(!s||s.length>m)throw new Error(`${n} est invalide.`);return s}
async function listNotes(userId,limit=50){await ready;return (await pool.query("SELECT id,user_id,content,author_id,created_at FROM officer_notes WHERE user_id=$1 ORDER BY id DESC LIMIT $2",[txt(userId,"userId",64),lim(limit)])).rows}
async function addNote({userId,content,authorId}){await ready;const r=await pool.query("INSERT INTO officer_notes(user_id,content,author_id) VALUES($1,$2,$3) RETURNING id",[txt(userId,"userId",64),txt(content,"content",4000),txt(authorId,"authorId",64)]);return{id:Number(r.rows[0].id)}}
async function deleteNote(id){await ready;const r=await pool.query("DELETE FROM officer_notes WHERE id=$1",[parseInt(id,10)]);return{deleted:r.rowCount>0}}
async function listSanctions(userId,limit=50){await ready;return (await pool.query("SELECT id,user_id,sanction_type,reason,author_id,expires_at,status,created_at FROM officer_sanctions WHERE user_id=$1 ORDER BY id DESC LIMIT $2",[txt(userId,"userId",64),lim(limit)])).rows}
async function addSanction({userId,type,reason,authorId,expiresAt}){await ready;const r=await pool.query("INSERT INTO officer_sanctions(user_id,sanction_type,reason,author_id,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id",[txt(userId,"userId",64),txt(type,"type",100),txt(reason,"reason",4000),txt(authorId,"authorId",64),expiresAt||null]);return{id:Number(r.rows[0].id)}}
async function updateSanctionStatus(id,status){await ready;const s=String(status||"").toLowerCase();if(!["active","expired","cancelled"].includes(s))throw new Error("Statut invalide.");const r=await pool.query("UPDATE officer_sanctions SET status=$1 WHERE id=$2",[s,parseInt(id,10)]);return{updated:r.rowCount>0}}
async function deleteSanction(id){await ready;const r=await pool.query("DELETE FROM officer_sanctions WHERE id=$1",[parseInt(id,10)]);return{deleted:r.rowCount>0}}
async function listActivity(limit=50){await ready;return (await pool.query("SELECT id,user_id,action,amount,old_points,new_points,reason,moderator_id,created_at FROM points_history ORDER BY id DESC LIMIT $1",[lim(limit)])).rows}
async function listOfficerActivity(userId,limit=50){await ready;return (await pool.query("SELECT id,user_id,action,amount,old_points,new_points,reason,moderator_id,created_at FROM points_history WHERE user_id=$1 ORDER BY id DESC LIMIT $2",[txt(userId,"userId",64),lim(limit)])).rows}
async function closeDatabase(){await pool.end()}
module.exports={listNotes,addNote,deleteNote,listSanctions,addSanction,updateSanctionStatus,deleteSanction,listActivity,listOfficerActivity,closeDatabase};
