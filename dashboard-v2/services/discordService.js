const { REST, Routes } = require("discord.js");
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
function normalizeDiscordId(
  value,
  fieldName = "identifiant Discord"
) {
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
 * Transforme la réponse brute Discord dans le format utilisé
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
 * Réponse utilisée lorsque Discord confirme
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
 * Vérifie si une erreur Discord signifie
 * que le membre est réellement absent.
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
 */
async function getDiscordMember(
  userId,
  force = false
) {
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
      Routes.guildMember(
        GUILD_ID,
        safeUserId
      )
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
    .map((roleId) =>
      String(roleId || "").trim()
    )
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
 * Prépare le contenu d'un message Discord.
 *
 * Accepte :
 * - une chaîne de texte ;
 * - un objet avec content, embeds, components, files, etc.
 */
function normalizeChannelMessage(message) {
  if (typeof message === "string") {
    const content = message.trim();

    if (!content) {
      throw new Error(
        "Le message Discord ne peut pas être vide."
      );
    }

    if (content.length > 2000) {
      throw new Error(
        "Le message Discord ne peut pas dépasser 2000 caractères."
      );
    }

    return {
      content,
      allowed_mentions: {
        parse: [],
      },
    };
  }

  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    throw new Error(
      "Le message Discord doit être un texte ou un objet valide."
    );
  }

  const body = {
    ...message,
  };

  if (
    typeof body.content === "string"
  ) {
    body.content = body.content.trim();

    if (body.content.length > 2000) {
      throw new Error(
        "Le contenu Discord ne peut pas dépasser 2000 caractères."
      );
    }

    if (!body.content) {
      delete body.content;
    }
  }

  if (body.embeds !== undefined) {
    if (!Array.isArray(body.embeds)) {
      body.embeds = [body.embeds];
    }

    body.embeds = body.embeds
      .filter(
        (embed) =>
          embed &&
          typeof embed === "object"
      )
      .map((embed) => {
        if (typeof embed.toJSON === "function") {
          return embed.toJSON();
        }

        return embed;
      });

    if (body.embeds.length > 10) {
      throw new Error(
        "Un message Discord ne peut pas contenir plus de 10 embeds."
      );
    }

    if (body.embeds.length === 0) {
      delete body.embeds;
    }
  }

  if (
    body.components !== undefined &&
    !Array.isArray(body.components)
  ) {
    body.components = [body.components];
  }

  const hasContent =
    typeof body.content === "string" &&
    body.content.length > 0;

  const hasEmbeds =
    Array.isArray(body.embeds) &&
    body.embeds.length > 0;

  const hasComponents =
    Array.isArray(body.components) &&
    body.components.length > 0;

  const hasFiles =
    Array.isArray(body.files) &&
    body.files.length > 0;

  if (
    !hasContent &&
    !hasEmbeds &&
    !hasComponents &&
    !hasFiles
  ) {
    throw new Error(
      "Le message Discord ne contient aucun contenu, embed ou composant."
    );
  }

  body.allowed_mentions =
    body.allowed_mentions || {
      parse: [],
    };

  return body;
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

  if (!safeChannelId) {
    return {
      sent: false,
      reason: "channel_missing",
    };
  }

  normalizeDiscordId(
    safeChannelId,
    "Identifiant du salon Discord"
  );

  const body = normalizeChannelMessage(
    message
  );

  try {
    const result = await rest.post(
      Routes.channelMessages(
        safeChannelId
      ),
      {
        body,
      }
    );

    return {
      sent: true,
      messageId: result?.id || null,
    };
  } catch (error) {
    console.error(
      `❌ Impossible d'envoyer le message dans le salon ${safeChannelId} :`,
      error?.rawError ||
      error?.message ||
      error
    );

    throw new Error(
      "Impossible d'envoyer le message Discord. Vérifie l'identifiant du salon et les permissions du bot."
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
 * Récupère tous les membres du serveur Discord.
 */
async function listGuildMembers() {
  const members = [];
  let after = "0";

  while (true) {
    const page = await rest.get(
      Routes.guildMembers(GUILD_ID),
      {
        query: new URLSearchParams({
          limit: "1000",
          after,
        }),
      }
    );

    const list = Array.isArray(page)
      ? page
      : [];

    for (const member of list) {
      const userId = String(
        member?.user?.id || ""
      ).trim();

      if (!userId) {
        continue;
      }

      const formatted = formatMember(
        member,
        userId
      );

      members.push(formatted);

      memberCache.set(userId, {
        time: Date.now(),
        data: formatted,
      });
    }

    if (list.length < 1000) {
      break;
    }

    const lastId = String(
      list[list.length - 1]?.user?.id || ""
    );

    if (!lastId || lastId === after) {
      break;
    }

    after = lastId;
  }

  return members;
}

/**
 * Vide entièrement le cache des membres.
 */
function clearMemberCache() {
  memberCache.clear();
}

/**
 * Retourne quelques informations sur le cache.
 */
function getMemberCacheInfo() {
  return {
    size: memberCache.size,
    ttl: CACHE_TTL,
  };
}

module.exports = {
  getDiscordMember,
  listGuildMembers,
  setMemberGradeRole,
  sendChannelMessage,
  clearMemberCache,
  clearMemberFromCache,
  getMemberCacheInfo,
};