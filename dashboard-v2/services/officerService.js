const {
  getOfficer,
  getAllOfficers,
  getOfficerHistory,
  getLeaderboard,
  changeOfficerPoints,
} = require("../../database");

const {
  getGradeFromPoints,
  getNextGrade,
  getNextGradeByName,
  getGradeProgress,
  getGradeIndex,
  getDiscordGradeFromRoles,
  normalizeGradeName,
} = require("../config/grades");

const { getOfficerAttendanceTotal } = require("../dashboardDatabase");

const {
  getDiscordMember,
  setMemberGradeRole,
  sendChannelMessage,
} = require("./discordService");

const LOG_CHANNEL_ID = String(
  process.env.LOG_CHANNEL_ID || ""
).trim();

const PROMOTION_CHANNEL_ID = String(
  process.env.PROMOTION_CHANNEL_ID || ""
).trim();

const DEFAULT_MODERATOR_ID = String(
  process.env.DASHBOARD_MODERATOR_ID || "DASHBOARD"
).trim();

const POLICE_ROLE_IDS = String(process.env.ROLE_POLICE || "")
  .split(",")
  .map((roleId) => roleId.trim())
  .filter(Boolean);

/*
|--------------------------------------------------------------------------
| Validation
|--------------------------------------------------------------------------
*/

function normalizeUserId(userId) {
  const value = String(userId || "").trim();

  if (!/^\d{16,22}$/.test(value)) {
    throw new Error("L'identifiant Discord du policier est invalide.");
  }

  return value;
}

function normalizeModeratorId(moderatorId) {
  const value = String(
    moderatorId || DEFAULT_MODERATOR_ID
  ).trim();

  if (!value) {
    return "DASHBOARD";
  }

  return value;
}

function normalizeAction(action) {
  const value = String(action || "").trim().toLowerCase();

  if (!["add", "remove"].includes(value)) {
    throw new Error("L'action doit être « add » ou « remove ».");
  }

  return value;
}

function normalizeAmount(amount) {
  const value = Number(amount);

  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error(
      "Le nombre de points doit être compris entre 1 et 1000."
    );
  }

  return value;
}

function normalizeReason(reason) {
  const value = String(reason || "").trim();

  if (value.length < 3) {
    throw new Error(
      "La raison doit contenir au moins 3 caractères."
    );
  }

  if (value.length > 1000) {
    throw new Error(
      "La raison ne peut pas dépasser 1000 caractères."
    );
  }

  return value;
}

function normalizeLimit(limit, fallback = 25, maximum = 100) {
  const value = Number.parseInt(limit, 10);

  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return Math.min(value, maximum);
}

function hasPoliceRole(member) {
  const roles = Array.isArray(member?.roles)
    ? member.roles.map(String)
    : [];

  return POLICE_ROLE_IDS.some((roleId) =>
    roles.includes(roleId)
  );
}

/*
|--------------------------------------------------------------------------
| Enrichissement des policiers
|--------------------------------------------------------------------------
*/

async function enrichOfficer(officer) {
  if (!officer?.user_id) {
    throw new Error("Données du policier invalides.");
  }

  const discordMember = await getDiscordMember(
    officer.user_id
  );

  const points = Number(officer.points) || 0;
  const discordGrade = getDiscordGradeFromRoles(discordMember.roles);
  const displayedGrade = normalizeGradeName(
    discordGrade || officer.grade || "Academy"
  );
  const nextGrade = getNextGradeByName(displayedGrade);
  // Conservé pour compatibilité d'affichage : les points sont un score d'activité,
  // ils ne déterminent plus le grade ni une promotion automatique.
  const gradeProgress = {
    currentGrade: displayedGrade,
    currentGradePoints: 0,
    nextGrade: nextGrade?.name || null,
    nextGradePoints: null,
    pointsRemaining: 0,
    progressPercent: 0,
    isMaximum: !nextGrade,
  };

  return {
    ...officer,
    points,
    grade: displayedGrade,
    discord_grade: discordGrade,

    display_name:
      discordMember.displayName ||
      discordMember.username ||
      officer.user_id,

    username:
      discordMember.username ||
      officer.user_id,

    avatar_url:
      discordMember.avatarUrl ||
      "https://cdn.discordapp.com/embed/avatars/0.png",

    is_in_server: Boolean(discordMember.found),
    has_police_role:
      discordMember.found &&
      hasPoliceRole(discordMember),

    joined_at:
      discordMember.joinedAt || null,

    next_grade:
      nextGrade?.name || null,

    next_grade_points:
      Number.isFinite(Number(nextGrade?.points))
        ? Number(nextGrade.points)
        : null,

    points_until_next_grade: gradeProgress.pointsRemaining,
    grade_progress_percent: gradeProgress.progressPercent,
    current_grade_points: gradeProgress.currentGradePoints,
    grade_progress: gradeProgress,
  };
}

/*
 * Traite les membres par petits groupes pour ne pas envoyer
 * trop de requêtes simultanément à Discord.
 */
async function enrichOfficers(officers) {
  const list = Array.isArray(officers)
    ? officers
    : [];

  const enriched = [];
  const batchSize = 5;

  for (
    let index = 0;
    index < list.length;
    index += batchSize
  ) {
    const batch = list.slice(
      index,
      index + batchSize
    );

    const results = await Promise.allSettled(
      batch.map((officer) =>
        enrichOfficer(officer)
      )
    );

    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
      const result = results[resultIndex];

      if (result.status === "fulfilled") {
        enriched.push(result.value);
      } else {
        const officer = batch[resultIndex];

        console.error(
          `❌ Enrichissement impossible pour ${officer?.user_id || "inconnu"} :`,
          result.reason?.message || result.reason
        );

        enriched.push({
          ...officer,
          display_name: officer?.user_id || "Membre inconnu",
          username: officer?.user_id || "inconnu",
          avatar_url:
            "https://cdn.discordapp.com/embed/avatars/0.png",
          is_in_server: false,
          has_police_role: false,
          joined_at: null,
          next_grade: null,
          next_grade_points: null,
          points_until_next_grade: 0,
        });
      }
    }
  }

  return enriched;
}

/*
|--------------------------------------------------------------------------
| Cache léger du dashboard
|--------------------------------------------------------------------------
*/

let officersCache = null;
let officersCacheAt = 0;
let officersCachePromise = null;
const OFFICERS_CACHE_TTL_MS = Math.max(
  5000,
  Number(process.env.OFFICERS_CACHE_TTL_MS) || 15000
);

function invalidateOfficerCache() {
  officersCache = null;
  officersCacheAt = 0;
  officersCachePromise = null;
}

/*
|--------------------------------------------------------------------------
| Lecture des données
|--------------------------------------------------------------------------
*/

async function listOfficers() {
  const now = Date.now();

  if (officersCache && now - officersCacheAt < OFFICERS_CACHE_TTL_MS) {
    return officersCache;
  }

  if (officersCachePromise) {
    return officersCachePromise;
  }

  officersCachePromise = (async () => {
    const enriched = await enrichOfficers(await getAllOfficers());
    const filtered = enriched.filter(
      (officer) => officer.is_in_server && officer.has_police_role
    );
    officersCache = filtered;
    officersCacheAt = Date.now();
    return filtered;
  })();

  try {
    return await officersCachePromise;
  } finally {
    officersCachePromise = null;
  }
}

async function getOfficerProfile(userId) {
  const safeUserId = normalizeUserId(userId);
  const officer = await getOfficer(safeUserId);

  if (!officer) {
    const error = new Error("Dossier policier introuvable.");
    error.status = 404;
    error.publicMessage = error.message;
    throw error;
  }

  let enriched;
  try {
    enriched = await enrichOfficer(officer);
  } catch (error) {
    console.error(`⚠️ Profil Discord partiel pour ${safeUserId}:`, error?.message || error);
    const fallbackGrade = normalizeGradeName(officer.grade || "Academy");
    const nextGrade = getNextGradeByName(fallbackGrade);
    enriched = {
      ...officer,
      points: Number(officer.points) || 0,
      grade: fallbackGrade,
      discord_grade: null,
      display_name: officer.display_name || safeUserId,
      username: officer.username || safeUserId,
      avatar_url: officer.avatar_url || "https://cdn.discordapp.com/embed/avatars/0.png",
      is_in_server: true,
      has_police_role: true,
      joined_at: null,
      next_grade: nextGrade?.name || null,
      next_grade_points: null,
      points_until_next_grade: 0,
      grade_progress_percent: 0,
    };
  }

  let attendance = { total_seconds: 0, sessions: 0 };
  try {
    attendance = await getOfficerAttendanceTotal(safeUserId) || attendance;
  } catch (error) {
    console.error(`⚠️ Total présence indisponible pour ${safeUserId}:`, error?.message || error);
  }

  return {
    ...enriched,
    total_attendance_seconds: Number(attendance.total_seconds) || 0,
    total_attendance_sessions: Number(attendance.sessions) || 0,
  };
}

async function getEnrichedLeaderboard(limit = 25) {
  const safeLimit = normalizeLimit(limit);
  // V2: réutilise le cache enrichi commun au lieu de refaire un cycle Discord complet.
  const officers = await listOfficers();

  return [...officers]
    .sort((a, b) => Number(b.points) - Number(a.points))
    .slice(0, safeLimit);
}

async function getHistory(userId, limit = 25) {
  const safeUserId = normalizeUserId(userId);
  const safeLimit = normalizeLimit(limit);

  return await getOfficerHistory(
    safeUserId,
    safeLimit
  );
}

/*
|--------------------------------------------------------------------------
| Messages Discord
|--------------------------------------------------------------------------
*/

async function logPointsChange({
  member,
  action,
  result,
  reason,
  oldGrade,
  newGrade,
  moderatorId,
}) {
  if (!LOG_CHANNEL_ID) {
    return;
  }

  const isAddition = action === "add";
  const responsibleId = normalizeModeratorId(
    moderatorId
  );

  const responsibleText =
    responsibleId === "DASHBOARD"
      ? "Dashboard HMPD"
      : `<@${responsibleId}>`;

  const avatarUrl =
    member?.avatarUrl ||
    "https://cdn.discordapp.com/embed/avatars/0.png";

  await sendChannelMessage(LOG_CHANNEL_ID, {
    embeds: [
      {
        color: isAddition
          ? 0x2ecc71
          : 0xe74c3c,

        title: isAddition
          ? "📈 Ajout de points via Dashboard"
          : "📉 Retrait de points via Dashboard",

        thumbnail: {
          url: avatarUrl,
        },

        fields: [
          {
            name: "👤 Policier",
            value: `<@${member.userId}>`,
            inline: true,
          },
          {
            name: "👮 Responsable",
            value: responsibleText,
            inline: true,
          },
          {
            name: isAddition
              ? "➕ Points ajoutés"
              : "➖ Points retirés",
            value: String(result.amount),
            inline: true,
          },
          {
            name: "⭐ Ancien total",
            value: String(result.oldPoints),
            inline: true,
          },
          {
            name: "⭐ Nouveau total",
            value: String(result.newPoints),
            inline: true,
          },
          {
            name: "🎖️ Grade",
            value:
              oldGrade.name === newGrade.name
                ? newGrade.name
                : `${oldGrade.name} ➜ ${newGrade.name}`,
            inline: true,
          },
          {
            name: "📝 Raison",
            value: reason,
            inline: false,
          },
        ],

        timestamp: new Date().toISOString(),
      },
    ],

    allowed_mentions: {
      parse: [],
    },
  });
}

async function sendPromotionMessage({
  userId,
  oldGrade,
  newGrade,
  newPoints,
}) {
  if (!PROMOTION_CHANNEL_ID) {
    return;
  }

  await sendChannelMessage(
    PROMOTION_CHANNEL_ID,
    {
      content: `🎉 Félicitations <@${userId}> !`,

      embeds: [
        {
          color: 0xf1c40f,
          title: "🎖️ PROMOTION OFFICIELLE",

          description:
            `👤 **Agent :** <@${userId}>\n\n` +
            `⬆️ **Ancien grade :** ${oldGrade.name}\n\n` +
            `🏅 **Nouveau grade :** ${newGrade.name}\n\n` +
            `⭐ **Total des points :** ${newPoints}`,

          timestamp: new Date().toISOString(),
        },
      ],

      allowed_mentions: {
        users: [userId],
        parse: [],
      },
    }
  );
}

async function sendDemotionMessage({
  userId,
  oldGrade,
  newGrade,
  newPoints,
}) {
  if (!PROMOTION_CHANNEL_ID) {
    return;
  }

  await sendChannelMessage(
    PROMOTION_CHANNEL_ID,
    {
      content: `🔻 Rétrogradation de <@${userId}>`,

      embeds: [
        {
          color: 0xe74c3c,
          title: "🔻 RÉTROGRADATION OFFICIELLE",

          description:
            `👤 **Agent :** <@${userId}>\n\n` +
            `⬇️ **Ancien grade :** ${oldGrade.name}\n\n` +
            `🎖️ **Nouveau grade :** ${newGrade.name}\n\n` +
            `⭐ **Total des points :** ${newPoints}`,

          timestamp: new Date().toISOString(),
        },
      ],

      allowed_mentions: {
        users: [userId],
        parse: [],
      },
    }
  );
}

/*
|--------------------------------------------------------------------------
| Modification des points
|--------------------------------------------------------------------------
*/

async function modifyOfficerPoints({
  userId,
  action,
  amount,
  reason,
  moderatorId,
}) {
  const safeUserId = normalizeUserId(userId);
  const safeAction = normalizeAction(action);
  const safeAmount = normalizeAmount(amount);
  const safeReason = normalizeReason(reason);
  const safeModeratorId = normalizeModeratorId(moderatorId);

  const discordMember = await getDiscordMember(safeUserId, true);
  if (!discordMember.found) throw new Error("Ce policier n'est plus présent dans le serveur.");
  if (discordMember.bot) throw new Error("Les points d'un bot ne peuvent pas être modifiés.");
  if (POLICE_ROLE_IDS.length > 0 && !hasPoliceRole(discordMember)) {
    throw new Error("Ce membre ne possède plus le rôle Police.");
  }

  // IMPORTANT : les points sont désormais uniquement un indicateur d'activité.
  // Aucune modification de points ne change le rôle ou le grade Discord.
  const before = await getOfficerProfile(safeUserId);
  const currentGradeName = normalizeGradeName(before.grade || "Academy");
  const currentGrade = GRADES.find((g) => g.name === currentGradeName) || { name: currentGradeName };

  const result = await changeOfficerPoints({
    userId: safeUserId,
    action: safeAction,
    amount: safeAmount,
    grade: currentGradeName,
    reason: safeReason,
    moderatorId: safeModeratorId,
  });

  await logPointsChange({
    member: discordMember,
    action: safeAction,
    result,
    reason: safeReason,
    oldGrade: currentGrade,
    newGrade: currentGrade,
    moderatorId: safeModeratorId,
  }).catch((error) => console.error("❌ Impossible d'envoyer le journal Discord :", error?.message || error));

  invalidateOfficerCache();
  return {
    result,
    officer: await getOfficerProfile(safeUserId),
    oldGrade: currentGrade,
    newGrade: currentGrade,
    promoted: false,
    demoted: false,
    roleSyncWarning: null,
    promotionManagedByHighCommand: true,
  };
}

module.exports = {
  enrichOfficers,
  listOfficers,
  getOfficerProfile,
  getEnrichedLeaderboard,
  getHistory,
  modifyOfficerPoints,
  invalidateOfficerCache,
};