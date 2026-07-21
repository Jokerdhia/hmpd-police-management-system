const {
  getAllOfficers,
  getOfficer,
} = require("../../database");

const {
  listGuildMembers,
  clearMemberCache,
} = require("./discordService");

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
 * - toute personne ayant le rôle Police est créée automatiquement ;
 * - une personne sans le rôle Police reste en base pour conserver
 *   son historique, mais elle n'est plus affichée dans le dashboard.
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
    const policeMembers = members.filter(
      (member) => member.found && !member.bot && hasPoliceRole(member)
    );

    const existingIds = new Set(
      getAllOfficers().map((officer) => String(officer.user_id))
    );

    let addedCount = 0;

    for (const member of policeMembers) {
      if (!existingIds.has(member.userId)) {
        getOfficer(member.userId);
        existingIds.add(member.userId);
        addedCount += 1;
      }
    }

    console.log(
      `✅ Synchronisation Police : ${policeMembers.length} actif(s), ` +
        `${addedCount} ajouté(s) au dashboard.`
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
    ? Math.max(configuredInterval, 15000)
    : 30000;

  syncPoliceRoles();

  syncTimer = setInterval(syncPoliceRoles, interval);
  syncTimer.unref?.();

  console.log(
    `🔄 Synchronisation automatique Police toutes les ${interval / 1000} seconde(s).`
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
