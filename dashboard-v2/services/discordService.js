const { REST, Routes, DiscordAPIError } = require("discord.js");
const { getAllGradeRoleIds } = require("../config/grades");

const TOKEN = String(process.env.TOKEN || "").trim();
const GUILD_ID = String(process.env.GUILD_ID || "").trim();

if (!TOKEN) {
  throw new Error("TOKEN absent du fichier .env.");
}

if (!GUILD_ID) {
  throw new Error("GUILD_ID absent du fichier .env.");
}

const rest = new REST({
  version: "10",
}).setToken(TOKEN);

const memberCache = new Map();

const configuredTTL = Number(
  process.env.DISCORD_MEMBER_CACHE_TTL_MS
);

const CACHE_TTL = Number.isFinite(configuredTTL)
  ? Math.max(configuredTTL, 5000)
  : 300000;

/**
 * Valide un identifiant Discord.
 */
function normalizeDiscordId(value, fieldName = "identifiant Discord") {
  const id = String(value || "").trim();

  if (!/^\d{16,22}$/.test(id)) {
    throw new Error(`${fieldName} invalide.`);
  }

  return id;
}

/**
 * Retourne l'avatar Discord par défaut.
 */
function defaultAvatar(userId) {
  try {
    const index = Number(
      (BigInt(String(userId)) >> 22n) % 6n
    );

    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  } catch {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

/**
 * Retourne l'URL de l'avatar d'un membre.
 */
function getAvatarUrl(member) {
  const user = member?.user;

  if (!user?.id) {
    return defaultAvatar("0");
  }

  if (member.avatar) {
    const extension = member.avatar.startsWith("a_")
      ? "gif"
      : "png";

    return (
      `https://cdn.discordapp.com/guilds/${GUILD_ID}` +
      `/users/${user.id}/avatars/${member.avatar}.${extension}?size=256`
    );
  }

  if (user.avatar) {
    const extension = user.avatar.startsWith("a_")
      ? "gif"
      : "png";

    return (
      `https://cdn.discordapp.com/avatars/${user.id}` +
      `/${user.avatar}.${extension}?size=256`
    );
  }

  return defaultAvatar(user.id);
}

/**
 * Transforme la réponse brute Discord en format utilisé
 * par le dashboard.
 */
function formatMember(member, userId) {
  const user = member?.user || {};

  return {
    found: true,
    userId: String(user.id || userId),
    displayName:
      member?.nick ||
      user.global_name ||
      user.username ||
      String(userId),
    username:
      user.username ||
      String(userId),
    avatarUrl: getAvatarUrl(member),
    bot: Boolean(user.bot),
    roles: Array.isArray(member?.roles)
      ? member.roles.map(String)
      : [],
    joinedAt: member?.joined_at || null,
  };
}

/**
 * Réponse utilisée uniquement lorsque Discord confirme
 * que le membre n'existe plus dans le serveur.
 */
function createMissingMember(userId) {
  return {
    found: false,
    userId: String(userId),
    displayName: "Membre inconnu",
    username: String(userId),
    avatarUrl: defaultAvatar(userId),
    bot: false,
    roles: [],
    joinedAt: null,
  };
}

/**
 * Vérifie si une erreur Discord signifie réellement
 * que le membre est absent.
 *
 * Code Discord 10007 : Unknown Member.
 * Statut HTTP 404 : membre introuvable.
 */
function isUnknownMemberError(error) {
  return (
    error?.code === 10007 ||
    error?.status === 404 ||
    error?.rawError?.code === 10007
  );
}

/**
 * Récupère un membre directement depuis Discord.
 *
 * Important :
 * - un membre réellement absent retourne found: false ;
 * - une panne Discord, un token invalide ou une erreur réseau
 *   déclenche une erreur ;
 * - une erreur temporaire ne sera donc pas interprétée comme
 *   un retrait du rôle Police.
 */
async function getDiscordMember(userId, force = false) {
  const safeUserId = normalizeDiscordId(
    userId,
    "Identifiant du membre"
  );

  const cached = memberCache.get(safeUserId);

  if (
    !force &&
    cached &&
    Date.now() - cached.time < CACHE_TTL
  ) {
    return cached.data;
  }

  try {
    const member = await rest.get(
      Routes.guildMember(GUILD_ID, safeUserId)
    );

    const data = formatMember(
      member,
      safeUserId
    );

    memberCache.set(safeUserId, {
      time: Date.now(),
      data,
    });

    return data;
  } catch (error) {
    if (isUnknownMemberError(error)) {
      const data = createMissingMember(
        safeUserId
      );

      memberCache.set(safeUserId, {
        time: Date.now(),
        data,
      });

      return data;
    }

    console.error(
      `❌ Impossible de récupérer le membre Discord ${safeUserId} :`,
      error?.message || error
    );

    throw new Error(
      "Discord est temporairement inaccessible ou la configuration du bot est invalide."
    );
  }
}

/**
 * Récupère la liste des rôles de grade configurés.
 */
function getGradeRoleIds() {
  const roleIds = getAllGradeRoleIds();

  if (!Array.isArray(roleIds)) {
    return [];
  }

  return roleIds
    .map((roleId) => String(roleId || "").trim())
    .filter(Boolean);
}

/**
 * Supprime les anciens rôles de grade puis ajoute
 * le rôle correspondant au nouveau grade.
 */
async function setMemberGradeRole(
  userId,
  expectedRoleId
) {
  const safeUserId = normalizeDiscordId(
    userId,
    "Identifiant du policier"
  );

  const safeExpectedRoleId = normalizeDiscordId(
    expectedRoleId,
    "Identifiant du rôle de grade"
  );

  const member = await getDiscordMember(
    safeUserId,
    true
  );

  if (!member.found) {
    throw new Error(
      "Le policier n'est plus présent dans le serveur."
    );
  }

  if (member.bot) {
    throw new Error(
      "Les points d'un bot ne peuvent pas être modifiés."
    );
  }

  const allGradeRoleIds = getGradeRoleIds();

  if (!allGradeRoleIds.includes(safeExpectedRoleId)) {
    throw new Error(
      "Le rôle demandé ne correspond à aucun grade configuré."
    );
  }

  const currentRoles = Array.isArray(member.roles)
    ? member.roles
    : [];

  const rolesToRemove = currentRoles.filter(
    (roleId) =>
      allGradeRoleIds.includes(roleId) &&
      roleId !== safeExpectedRoleId
  );

  for (const roleId of rolesToRemove) {
    try {
      await rest.delete(
        Routes.guildMemberRole(
          GUILD_ID,
          safeUserId,
          roleId
        )
      );
    } catch (error) {
      console.error(
        `❌ Impossible de retirer le rôle ${roleId} à ${safeUserId} :`,
        error?.message || error
      );

      throw new Error(
        "Impossible de retirer l'ancien rôle de grade. Vérifie la hiérarchie des rôles du bot."
      );
    }
  }

  if (!currentRoles.includes(safeExpectedRoleId)) {
    try {
      await rest.put(
        Routes.guildMemberRole(
          GUILD_ID,
          safeUserId,
          safeExpectedRoleId
        )
      );
    } catch (error) {
      console.error(
        `❌ Impossible d'ajouter le rôle ${safeExpectedRoleId} à ${safeUserId} :`,
        error?.message || error
      );

      throw new Error(
        "Impossible d'ajouter le nouveau rôle de grade. Vérifie la hiérarchie des rôles du bot."
      );
    }
  }

  memberCache.delete(safeUserId);

  return getDiscordMember(
    safeUserId,
    true
  );
}

/**
 * Envoie un message dans un salon Discord.
 */
async function sendChannelMessage(
  channelId,
  message
) {
  const safeChannelId = String(
    channelId || ""
  ).trim();

  const safeMessage = String(
    message || ""
  ).trim();

  if (!safeChannelId) {
    return {
      sent: false,
      reason: "channel_missing",
    };
  }

  if (!/^\d{16,22}$/.test(safeChannelId)) {
    throw new Error(
      "L'identifiant du salon Discord est invalide."
    );
  }

  if (!safeMessage) {
    throw new Error(
      "Le message Discord ne peut pas être vide."
    );
  }

  if (safeMessage.length > 2000) {
    throw new Error(
      "Le message Discord ne peut pas dépasser 2000 caractères."
    );
  }

  try {
    const result = await rest.post(
      Routes.channelMessages(safeChannelId),
      {
        body: {
          content: safeMessage,
          allowed_mentions: {
            parse: [],
          },
        },
      }
    );

    return {
      sent: true,
      messageId: result?.id || null,
    };
  } catch (error) {
    console.error(
      `❌ Impossible d'envoyer le message dans le salon ${safeChannelId} :`,
      error?.message || error
    );

    throw new Error(
      "Impossible d'envoyer le message Discord."
    );
  }
}

/**
 * Supprime un membre précis du cache.
 */
function clearMemberFromCache(userId) {
  const safeUserId = String(
    userId || ""
  ).trim();

  if (safeUserId) {
    memberCache.delete(safeUserId);
  }
}

/**
 * Vide entièrement le cache des membres.
 */
function clearMemberCache() {
  memberCache.clear();
}

/**
 * Retourne quelques informations utiles sur le cache.
 */
function getMemberCacheInfo() {
  return {
    size: memberCache.size,
    ttl: CACHE_TTL,
  };
}

module.exports = {
  getDiscordMember,
  setMemberGradeRole,
  sendChannelMessage,
  clearMemberCache,
  clearMemberFromCache,
  getMemberCacheInfo,
};