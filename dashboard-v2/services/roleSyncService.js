const {
  getAllOfficers,
  getOfficer,
  updateOfficer,
  resetOfficerAttendance,
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

/**
 * Synchronise Discord vers la base :
 *
 * - membre avec rôle Police :
 *   création automatique s'il n'existe pas ;
 *
 * - membre sans rôle Police :
 *   points remis à zéro ;
 *   grade remis à Academy ;
 *   il disparaît du dashboard.
 */
async function syncPoliceRoles() {
  if (running) {
    return;
  }

  if (POLICE_ROLE_IDS.length === 0) {
    console.error("❌ ROLE_POLICE n'est pas configuré.");
    return;
  }

  running = true;

  try {
    clearMemberCache();

    const members = await listGuildMembers();

    const membersById = new Map(
      members.map((member) => [
        String(member.userId),
        member,
      ])
    );

    const policeMembers = members.filter(
      (member) =>
        member.found &&
        !member.bot &&
        hasPoliceRole(member)
    );

    const existingOfficers = await getAllOfficers();

    const existingIds = new Set(
      existingOfficers.map((officer) =>
        String(officer.user_id)
      )
    );

    let addedCount = 0;
    let resetCount = 0;
    let attendanceResetCount = 0;

    /*
    |--------------------------------------------------------------------------
    | Ajouter automatiquement les membres ayant le rôle Police
    |--------------------------------------------------------------------------
    */

    for (const member of policeMembers) {
      if (!existingIds.has(member.userId)) {
        await getOfficer(member.userId);

        existingIds.add(member.userId);
        addedCount += 1;
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Remettre à zéro ceux qui n'ont plus le rôle Police
    |--------------------------------------------------------------------------
    */

    for (const officer of existingOfficers) {
      const userId = String(officer.user_id);
      const discordMember = membersById.get(userId);

      const stillHasPoliceRole =
        discordMember &&
        discordMember.found &&
        !discordMember.bot &&
        hasPoliceRole(discordMember);

      if (!stillHasPoliceRole) {
        const currentPoints = Number(officer.points) || 0;
        const currentGrade = String(
          officer.grade || "Academy"
        );

        if (
          currentPoints !== 0 ||
          currentGrade !== "Academy"
        ) {
          await updateOfficer(
            userId,
            0,
            "Academy"
          );

          resetCount += 1;

          console.log(
            `🔄 Points remis à zéro pour ${userId} : rôle Police retiré.`
          );
        }

        const attendanceResult =
          await resetOfficerAttendance(userId);

        if (attendanceResult.reset) {
          attendanceResetCount += 1;

          console.log(
            `⏱️ Présence remise à zéro pour ${userId} : ` +
            `${attendanceResult.deletedSessions} session(s) supprimée(s).`
          );
        }
      }
    }

    invalidateOfficerCache();

    console.log(
      `✅ Synchronisation Police : ` +
      `${policeMembers.length} actif(s), ` +
      `${addedCount} ajouté(s), ` +
      `${resetCount} point(s) remis à zéro, ` +
      `${attendanceResetCount} présence(s) remise(s) à zéro.`
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