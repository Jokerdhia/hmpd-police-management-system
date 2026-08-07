const { pool,
  getAllOfficers,
  getOfficer,
  deleteOfficersCompletely,
} = require("../../database");

const {
  listGuildMembers,
  clearMemberCache,
} = require("./discordService");

const { invalidateOfficerCache } = require("./officerService");

const POLICE_ROLE_IDS = String(process.env.ROLE_POLICE || "")
  .split(",")
  .map((roleId) => roleId.trim())
  .filter(Boolean);

let running = false;
let syncTimer = null;

function getMemberRoles(member) {
  return Array.isArray(member?.roles)
    ? member.roles.map(String)
    : [];
}

function hasPoliceRole(member) {
  const roles = getMemberRoles(member);

  return POLICE_ROLE_IDS.some((roleId) =>
    roles.includes(String(roleId))
  );
}


async function cleanupOperationalData(){
  const maxHours=Math.max(6,Number(process.env.MAX_OPEN_ATTENDANCE_HOURS||18));
  const auditDays=Math.max(30,Number(process.env.AUDIT_RETENTION_DAYS||180));
  const closed=await pool.query(`UPDATE attendance_sessions SET ended_at=CURRENT_TIMESTAMP,duration_seconds=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-started_at)))::int-COALESCE(paused_seconds,0)),ended_by='SYSTEM',end_reason='Session fermée automatiquement après délai de sécurité' WHERE ended_at IS NULL AND started_at < CURRENT_TIMESTAMP-($1::text||' hours')::interval RETURNING id`,[String(maxHours)]).catch(()=>({rowCount:0}));
  const audit=await pool.query(`DELETE FROM admin_audit_log WHERE created_at < CURRENT_TIMESTAMP-($1::text||' days')::interval`,[String(auditDays)]).catch(()=>({rowCount:0}));
  if((closed.rowCount||0)>0||(audit.rowCount||0)>0)console.log(`🧹 Maintenance DB : ${closed.rowCount||0} session(s) abandonnée(s) fermée(s), ${audit.rowCount||0} audit(s) ancien(s) supprimé(s).`);
}

/**
 * Synchronise Discord vers Neon :
 *
 * - membre avec rôle Police : création automatique s'il n'existe pas ;
 * - membre sans rôle Police (ou ayant quitté le serveur) : suppression
 *   complète de son dossier et de ses données HMPD.
 *
 * Ce nettoyage évite d'accumuler des anciens policiers et garde les pages
 * Policiers / Promotions / Présence rapides même après plusieurs mois.
 */
async function syncPoliceRoles() {
  if (running) return;

  if (POLICE_ROLE_IDS.length === 0) {
    console.error("❌ ROLE_POLICE n'est pas configuré.");
    return;
  }

  running = true;

  try {
    clearMemberCache();
    await cleanupOperationalData();

    const members = await listGuildMembers();
    const policeMembers = members.filter(
      (member) => member.found && !member.bot && hasPoliceRole(member)
    );

    const existingOfficers = await getAllOfficers();
    const existingIds = new Set(existingOfficers.map((officer) => String(officer.user_id)));
    const policeIds = new Set(policeMembers.map((member) => String(member.userId)));

    let addedCount = 0;

    for (const member of policeMembers) {
      const userId = String(member.userId);
      if (!existingIds.has(userId)) {
        await getOfficer(userId);
        existingIds.add(userId);
        addedCount += 1;
      }
    }

    const staleIds = existingOfficers
      .map((officer) => String(officer.user_id))
      .filter((userId) => !policeIds.has(userId));

    let deletedCount = 0;
    if (staleIds.length) {
      const result = await deleteOfficersCompletely(staleIds);
      deletedCount = result.deleted;
      console.log(
        `🧹 Nettoyage Police : ${deletedCount} ancien(s) dossier(s) supprimé(s) complètement de Neon.`
      );
    }

    invalidateOfficerCache();

    console.log(
      `✅ Synchronisation Police : ${policeMembers.length} actif(s), ` +
      `${addedCount} ajouté(s), ${deletedCount} supprimé(s) de la base.`
    );
  } catch (error) {
    console.error(
      "❌ Synchronisation des policiers impossible :",
      error?.message || error
    );
  } finally {
    running = false;
  }
}

function startRoleSync() {
  if (syncTimer) {
    return syncTimer;
  }

  const configuredInterval = Number(
    process.env.ROLE_SYNC_INTERVAL_MS
  );

  const interval = Number.isFinite(configuredInterval)
    ? Math.max(configuredInterval, 30000)
    : 60000;

  syncPoliceRoles();

  syncTimer = setInterval(
    syncPoliceRoles,
    interval
  );

  syncTimer.unref?.();

  console.log(
    `🔄 Synchronisation automatique Police toutes les ` +
    `${interval / 1000} seconde(s).`
  );

  return syncTimer;
}

function stopRoleSync() {
  if (!syncTimer) {
    return;
  }

  clearInterval(syncTimer);
  syncTimer = null;
}

module.exports = {
  hasPoliceRole,
  syncPoliceRoles,
  startRoleSync,
  stopRoleSync,
};