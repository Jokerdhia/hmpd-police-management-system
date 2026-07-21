const {
  getAllOfficers,
  getOfficer,
  updateOfficer,
  changeOfficerPoints,
} = require("../../database");

const {
  getDiscordMember,
  clearMemberCache,
} = require("./discordService");

const POLICE_ROLE_IDS = String(process.env.ROLE_POLICE || "")
  .split(",")
  .map((roleId) => roleId.trim())
  .filter(Boolean);

const POLICE_GRADE_ROLE_IDS = [
  process.env.ROLE_ACADEMY,
  process.env.ROLE_OFFICER,
  process.env.ROLE_SENIOR_OFFICER,
  process.env.ROLE_SERGEANT,
  process.env.ROLE_FIRST_SERGENT,
  process.env.ROLE_LIEUTENANT,
  process.env.ROLE_CAPTAIN,
  process.env.ROLE_COMMANDER,
]
  .map((roleId) => String(roleId || "").trim())
  .filter(Boolean);

const POLICE_ACCESS_ROLE_IDS = [
  ...new Set([
    ...POLICE_ROLE_IDS,
    ...POLICE_GRADE_ROLE_IDS,
  ]),
];

const MODERATOR_ID = "SYSTEM_ROLE_SYNC";

let running = false;
let syncTimer = null;

/**
 * Récupère les rôles Discord du membre.
 */
function getMemberRoles(member) {
  if (!member) {
    return [];
  }

  if (Array.isArray(member.roles)) {
    return member.roles.map(String);
  }

  if (Array.isArray(member.roleIds)) {
    return member.roleIds.map(String);
  }

  return [];
}

/**
 * Vérifie si le membre possède au moins un rôle Police.
 */
function hasPoliceRole(member) {
  const memberRoles = getMemberRoles(member);

  return POLICE_ACCESS_ROLE_IDS.some((policeRoleId) =>
    memberRoles.includes(String(policeRoleId))
  );
}

/**
 * Détermine si Discord confirme que le membre existe.
 */
function isMemberFound(member) {
  if (!member) {
    return false;
  }

  // Format utilisé par discordService :
  // { found: true, roles: [...] }
  if (typeof member.found === "boolean") {
    return member.found;
  }

  // Compatibilité si discordService retourne directement le membre Discord.
  return Boolean(member.user || member.id || Array.isArray(member.roles));
}

/**
 * Remet les points d'un policier à zéro
 * et son grade sur Academy.
 */
function resetOfficer(officer) {
  if (!officer?.user_id) {
    return false;
  }

  const userId = String(officer.user_id);
  const currentPoints = Number(officer.points) || 0;
  const currentGrade = String(officer.grade || "").trim();

  /*
   * Si le policier a des points, on utilise changeOfficerPoints
   * afin de conserver une trace dans points_history.
   */
  if (currentPoints > 0) {
    changeOfficerPoints({
      userId,
      action: "remove",
      amount: currentPoints,
      grade: "Academy",
      reason: "Rôle Police retiré — remise à zéro automatique",
      moderatorId: MODERATOR_ID,
    });

    return true;
  }

  /*
   * Si les points sont déjà à zéro mais que le grade
   * n'est pas Academy, on corrige directement le grade.
   */
  if (currentPoints !== 0 || currentGrade !== "Academy") {
    updateOfficer(userId, 0, "Academy");
    return true;
  }

  return false;
}

/**
 * Vérifie tous les policiers enregistrés.
 *
 * Si un utilisateur :
 * - n'est plus membre du serveur ;
 * - ou ne possède plus le rôle Police ;
 *
 * ses points sont remis à zéro et son grade devient Academy.
 */
async function syncPoliceRoles() {
  if (running) {
    console.log("⏳ Synchronisation déjà en cours.");
    return;
  }

  if (POLICE_ACCESS_ROLE_IDS.length === 0) {
    console.error(
      "❌ Synchronisation désactivée : ROLE_POLICE n'est pas configuré."
    );
    return;
  }

  running = true;

  let checkedCount = 0;
  let resetCount = 0;
  let errorCount = 0;

  try {
    if (typeof clearMemberCache === "function") {
      clearMemberCache();
    }

    const result = getAllOfficers();

    const officers = Array.isArray(result)
      ? result
      : Array.isArray(result?.officers)
        ? result.officers
        : [];

    console.log(
      `🔍 Synchronisation Discord : ${officers.length} policier(s) enregistré(s).`
    );

    if (officers.length === 0) {
      console.warn(
        "⚠️ Aucun policier trouvé dans la base de données."
      );
      return;
    }

    for (const officer of officers) {
      const userId = String(officer?.user_id || "").trim();

      if (!userId) {
        console.warn(
          "⚠️ Policier ignoré : user_id absent ou invalide."
        );
        continue;
      }

      checkedCount += 1;

      try {
        const member = await getDiscordMember(userId, true);

        const memberFound = isMemberFound(member);
        const policeRoleFound =
          memberFound && hasPoliceRole(member);

        if (memberFound && policeRoleFound) {
          continue;
        }

        /*
         * Relit le policier juste avant la modification
         * pour utiliser ses points les plus récents.
         */
        const currentOfficer =
          getOfficer(userId) || officer;

        const changed = resetOfficer(currentOfficer);

        if (changed) {
          resetCount += 1;

          const reason = !memberFound
            ? "membre Discord introuvable"
            : "rôle Police absent";

          console.log(
            `🔄 ${userId} : points remis à zéro et grade Academy (${reason}).`
          );
        }
      } catch (error) {
        errorCount += 1;

        /*
         * Une erreur Discord temporaire ne doit pas arrêter
         * la synchronisation des autres policiers.
         */
        console.error(
          `❌ Erreur pendant la vérification de ${userId} :`,
          error?.message || error
        );
      }
    }

    console.log(
      `✅ Synchronisation terminée : ${checkedCount} vérifié(s), ` +
        `${resetCount} remis à zéro, ${errorCount} erreur(s).`
    );
  } catch (error) {
    console.error(
      "❌ Synchronisation générale des rôles impossible :",
      error?.message || error
    );
  } finally {
    running = false;
  }
}

/**
 * Lance la synchronisation automatique.
 */
function startRoleSync() {
  if (syncTimer) {
    console.log("ℹ️ La synchronisation des rôles est déjà active.");
    return syncTimer;
  }

  if (POLICE_ACCESS_ROLE_IDS.length === 0) {
    console.error(
      "❌ Impossible de lancer la synchronisation : ROLE_POLICE est vide."
    );
    return null;
  }

  const configuredInterval = Number(
    process.env.ROLE_SYNC_INTERVAL_MS
  );

  const interval = Number.isFinite(configuredInterval)
    ? Math.max(configuredInterval, 15000)
    : 30000;

  /*
   * Première vérification immédiate au démarrage.
   */
  syncPoliceRoles().catch((error) => {
    console.error(
      "❌ Première synchronisation impossible :",
      error?.message || error
    );
  });

  syncTimer = setInterval(() => {
    syncPoliceRoles().catch((error) => {
      console.error(
        "❌ Synchronisation planifiée impossible :",
        error?.message || error
      );
    });
  }, interval);

  /*
   * Le timer n'empêche pas Node.js de s'arrêter proprement.
   */
  syncTimer.unref?.();

  console.log(
    `🔄 Vérification des rôles toutes les ${interval / 1000} seconde(s).`
  );

  console.log(
    `👮 Rôle(s) donnant accès Police : ${POLICE_ACCESS_ROLE_IDS.join(", ")}`
  );

  return syncTimer;
}

/**
 * Arrête la synchronisation automatique.
 */
function stopRoleSync() {
  if (!syncTimer) {
    return;
  }

  clearInterval(syncTimer);
  syncTimer = null;

  console.log("🛑 Synchronisation des rôles arrêtée.");
}

module.exports = {
  hasPoliceRole,
  resetOfficer,
  syncPoliceRoles,
  startRoleSync,
  stopRoleSync,
};