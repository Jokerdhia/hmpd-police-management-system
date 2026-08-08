const { pool,
  getAllOfficers,
  getOfficer,
  updateOfficer,
  addPointsHistory,
  deleteOfficersCompletely,
} = require("../../database");

const {
  listGuildMembers,
  getDiscordMember,
  clearMemberCache,
} = require("./discordService");

const { invalidateOfficerCache } = require("./officerService");
const { GRADES, getDiscordGradeFromRoles } = require("../config/grades");
const { isManagedGradeChange } = require("../../services/gradeChangeGuard");
const { getPointsAfterGradeSync } = require("../../services/gradePointPolicy");

const POLICE_ROLE_IDS = String(process.env.ROLE_POLICE || "")
  .split(",")
  .map((roleId) => roleId.trim())
  .filter(Boolean);

let running = false;
let syncTimer = null;
let lastMaintenanceAt = 0;
let unchangedSyncCount = 0;

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
    if (Date.now() - lastMaintenanceAt >= 60 * 60 * 1000) {
      await cleanupOperationalData();
      lastMaintenanceAt = Date.now();
    }

    const members = await listGuildMembers();
    const policeMembers = members.filter(
      (member) => member.found && !member.bot && hasPoliceRole(member)
    );

    const existingOfficers = await getAllOfficers();
    const existingIds = new Set(existingOfficers.map((officer) => String(officer.user_id)));
    const policeIds = new Set(policeMembers.map((member) => String(member.userId)));

    let addedCount = 0;
    let gradeSyncedCount = 0;
    const officerById = new Map(existingOfficers.map((officer) => [String(officer.user_id), officer]));

    for (const member of policeMembers) {
      const userId = String(member.userId);
      let officer = officerById.get(userId);
      if (!existingIds.has(userId)) {
        officer = await getOfficer(userId);
        existingIds.add(userId);
        officerById.set(userId, officer);
        addedCount += 1;
      }

      // Filet de sécurité : si un événement Discord a été manqué pendant un
      // redémarrage, le prochain cycle resynchronise le grade. Les points sont
      // cumulatifs : ils ne peuvent jamais diminuer à cause d'un rôle Discord.
      const discordGradeName = getDiscordGradeFromRoles(getMemberRoles(member));
      if (discordGradeName && String(officer?.grade || "") !== discordGradeName && !isManagedGradeChange(userId)) {
        const grade = GRADES.find((item) => item.name === discordGradeName);
        if (grade) {
          const oldGrade = String(officer?.grade || "Academy");
          const oldPoints = Number(officer?.points || 0);
          const newPoints = getPointsAfterGradeSync(oldPoints, grade.points);
          await updateOfficer(userId, newPoints, grade.name);
          // Un changement de grade redémarre l'ancienneté de carrière.
          await pool.query(`UPDATE officers SET rank_started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1`,[userId]).catch(()=>{});
          await pool.query(`UPDATE promotion_cases SET status='rejected',decision_reason=$2,decided_by='SYSTEM',decided_at=CURRENT_TIMESTAMP,closed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND closed_at IS NULL AND status<>'approved'`,[userId,`Dossier clôturé automatiquement : grade Discord changé vers ${grade.name}`]).catch(()=>{});
          if (oldPoints !== newPoints) {
            await addPointsHistory({
              userId,
              action: newPoints > oldPoints ? "add" : "remove",
              amount: Math.abs(newPoints - oldPoints),
              oldPoints,
              newPoints,
              reason: `Synchronisation automatique du grade Discord : ${oldGrade} → ${grade.name}`,
              moderatorId: "SYSTEM",
            }).catch(() => {});
          }
          await pool.query(
            `INSERT INTO grade_history(user_id,from_grade,to_grade,action,reason,actor_id) VALUES($1,$2,$3,'discord_sync',$4,'SYSTEM')`,
            [userId, oldGrade, grade.name, 'Synchronisation périodique Discord → Neon']
          ).catch(() => {});
          officerById.set(userId, { ...officer, points: newPoints, grade: grade.name });
          gradeSyncedCount += 1;
        }
      }
    }

    const staleCandidates = existingOfficers
      .map((officer) => String(officer.user_id))
      .filter((userId) => !policeIds.has(userId));

    // Sécurité anti-effacement massif : chaque dossier absent de la liste est
    // confirmé individuellement auprès de Discord avant suppression définitive.
    // Une erreur REST temporaire ne doit jamais vider Neon.
    const staleIds = [];
    const verifyConcurrency = Math.min(6, Math.max(1, staleCandidates.length));
    let verifyCursor = 0;
    await Promise.all(Array.from({ length: verifyConcurrency }, async () => {
      while (true) {
        const i = verifyCursor++;
        if (i >= staleCandidates.length) break;
        const userId = staleCandidates[i];
        try {
          const member = await getDiscordMember(userId, true);
          if (!member?.found || !hasPoliceRole(member)) staleIds.push(userId);
        } catch (error) {
          console.warn(`⚠️ Suppression différée pour ${userId} : vérification Discord impossible (${error?.message || error}).`);
        }
      }
    }));

    let deletedCount = 0;
    if (staleIds.length) {
      const result = await deleteOfficersCompletely(staleIds);
      deletedCount = result.deleted;
      console.log(
        `🧹 Nettoyage Police : ${deletedCount} ancien(s) dossier(s) supprimé(s) complètement de Neon.`
      );
    }

    invalidateOfficerCache();

    const hasChanges = addedCount > 0 || gradeSyncedCount > 0 || deletedCount > 0;
    unchangedSyncCount += 1;
    // Évite de saturer les logs Render : on affiche toujours les changements,
    // sinon seulement un état périodique (toutes les 10 synchronisations).
    if (hasChanges || unchangedSyncCount >= 10) {
      console.log(
        `✅ Synchronisation Police : ${policeMembers.length} actif(s), ` +
        `${addedCount} ajouté(s), ${gradeSyncedCount} grade(s) synchronisé(s) (points cumulés protégés), ${deletedCount} supprimé(s) de la base.`
      );
      unchangedSyncCount = 0;
    }
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
    ? Math.max(configuredInterval, 60000)
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