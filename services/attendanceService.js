const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const {
  startAttendance,
  pauseAttendance,
  resumeAttendance,
  stopAttendance,
  getActiveAttendance,
  getActiveAttendances,
  getAttendanceTotals,
  setBotSetting,
  getBotSetting,
} = require("../database");

const ATTENDANCE_CHANNEL_ID = String(process.env.ATTENDANCE_CHANNEL_ID || "").trim();
const ATTENDANCE_LOG_CHANNEL_ID = String(process.env.ATTENDANCE_LOG_CHANNEL_ID || "").trim();
const ROLE_POLICE = String(process.env.ROLE_POLICE || "").trim();
const ROLE_HIGH_COMMAND = String(
  process.env.ROLE_HIGH_COMMAND || ""
).trim();

const PANEL_SETTING_KEY = "attendance_panel_message_id";

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  return `${minutes} min`;
}

function unix(dateValue) {
  const ms = new Date(dateValue).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function memberIsPolice(member) {
  return Boolean(ROLE_POLICE && member?.roles?.cache?.has(ROLE_POLICE));
}

function memberIsHighCommand(member, interaction) {
  const hasRole = Boolean(
    ROLE_HIGH_COMMAND &&
    member?.roles?.cache?.has(ROLE_HIGH_COMMAND)
  );

  const isAdministrator = Boolean(
    interaction?.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );

  return hasRole || isAdministrator;
}

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function buildPanelPayload(client) {
  const active = await getActiveAttendances();
  const weekly = await getAttendanceTotals("week", 3);

  const working = active.filter(
    (session) => !session.paused_at
  );

  const paused = active.filter(
    (session) => Boolean(session.paused_at)
  );

  const workingLines = working.length
    ? working
        .slice(0, 15)
        .map(
          (session) =>
            `🟢 <@${session.user_id}>\n` +
            `└ ⏱️ En service depuis <t:${unix(session.started_at)}:R>`
        )
        .join("\n\n")
    : "Aucun agent actuellement en service.";

  const pausedLines = paused.length
    ? paused
        .slice(0, 10)
        .map(
          (session) =>
            `🟡 <@${session.user_id}>\n` +
            `└ ☕ En pause depuis <t:${unix(session.paused_at)}:R>`
        )
        .join("\n\n")
    : "Aucun agent actuellement en pause.";

  const medals = ["🥇", "🥈", "🥉"];

  const weeklyLines = weekly.length
    ? weekly
        .map(
          (entry, index) =>
            `${medals[index] || "•"} <@${entry.user_id}>\n` +
            `└ ⏱️ **${formatDuration(entry.total_seconds)}**`
        )
        .join("\n\n")
    : "Aucune présence enregistrée cette semaine.";

  const totalWeeklySeconds = weekly.reduce(
    (total, entry) =>
      total + Number(entry.total_seconds || 0),
    0
  );

  const departmentStatus =
    working.length > 0
      ? "🟢 Département opérationnel"
      : paused.length > 0
        ? "🟡 Service temporairement en pause"
        : "⚫ Aucun agent en service";

  const embed = new EmbedBuilder()
    .setColor(
      working.length > 0
        ? 0x2ecc71
        : paused.length > 0
          ? 0xf1c40f
          : 0x5865f2
    )
    .setAuthor({
      name: "HARMONY POLICE DEPARTMENT",
    })
    .setTitle("🚔 Duty Management System")
    .setDescription(
      [
        `**${departmentStatus}**`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n")
    )
    .addFields(
      {
        name: `👮 AGENTS EN SERVICE  •  ${working.length}`,
        value: workingLines,
        inline: false,
      },
      {
        name: `☕ AGENTS EN PAUSE  •  ${paused.length}`,
        value: pausedLines,
        inline: false,
      },
      {
        name: "🏆 TOP 3 HEBDOMADAIRE",
        value: weeklyLines,
        inline: false,
      },
      {
        name: "📊 SYNTHÈSE DU SERVICE",
        value: [
          `> 👮 **Agents en service :** ${working.length}`,
          `> ☕ **Agents en pause :** ${paused.length}`,
          `> 📋 **Sessions ouvertes :** ${active.length}`,
          `> 🏆 **Temps cumulé du Top 3 :** ${formatDuration(
            totalWeeklySeconds
          )}`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({
      text: "Harmony Police Department • Mise à jour automatique",
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("attendance:start")
      .setLabel("Début de service")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("attendance:pause")
      .setLabel("Pause / Reprendre")
      .setEmoji("☕")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("attendance:stop")
      .setLabel("Fin de service")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("attendance:status")
      .setLabel("Mes statistiques")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary)
  );

  const forceButtons = [];

  for (const session of active.slice(0, 20)) {
    const user = await client.users
      .fetch(session.user_id)
      .catch(() => null);

    const label = String(
      user?.globalName ||
      user?.username ||
      session.user_id
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 55);

    forceButtons.push(
      new ButtonBuilder()
        .setCustomId(`attendance:force:${session.user_id}`)
        .setLabel(`Forcer fin • ${label}`)
        .setEmoji("🛑")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  const forceRows = [];

  for (
    let index = 0;
    index < forceButtons.length;
    index += 5
  ) {
    forceRows.push(
      new ActionRowBuilder().addComponents(
        forceButtons.slice(index, index + 5)
      )
    );
  }

  return {
    embeds: [embed],
    components: [row, ...forceRows],
    allowedMentions: {
      parse: [],
    },
  };
}

async function ensureAttendancePanel(client, forceNew = false) {
  if (!ATTENDANCE_CHANNEL_ID) {
    console.warn("⚠️ ATTENDANCE_CHANNEL_ID absent : panneau de présence désactivé.");
    return null;
  }
  const channel = await fetchTextChannel(client, ATTENDANCE_CHANNEL_ID);
  if (!channel) throw new Error("Salon de présence introuvable ou non textuel.");

  const payload = await buildPanelPayload(client);
  let message = null;
  if (!forceNew) {
    const messageId = await getBotSetting(PANEL_SETTING_KEY);
    if (messageId) message = await channel.messages.fetch(messageId).catch(() => null);
  }
  if (message) {
    await message.edit(payload);
    return message;
  }
  message = await channel.send(payload);
  await setBotSetting(PANEL_SETTING_KEY, message.id);
  return message;
}

async function refreshAttendancePanel(client) {
  return ensureAttendancePanel(client, false).catch((error) => {
    console.error("❌ Actualisation du panneau de présence impossible :", error?.message || error);
    return null;
  });
}

async function sendAttendanceLog(
  client,
  {
    userId,
    type,
    startedAt,
    endedAt,
    pausedAt,
    durationSeconds,
  }
) {
  if (!ATTENDANCE_LOG_CHANNEL_ID) {
    return;
  }

  const channel = await fetchTextChannel(
    client,
    ATTENDANCE_LOG_CHANNEL_ID
  );

  if (!channel) {
    console.warn(
      "⚠️ Salon des logs de présence inaccessible."
    );
    return;
  }

  const eventConfig = {
    start: {
      color: 0x2ecc71,
      title: "🟢 DÉBUT DE SERVICE",
      status: "Service démarré",
    },
    pause: {
      color: 0xf1c40f,
      title: "☕ MISE EN PAUSE",
      status: "Service mis en pause",
    },
    resume: {
      color: 0x3498db,
      title: "▶️ REPRISE DE SERVICE",
      status: "Service repris",
    },
    stop: {
      color: 0xe74c3c,
      title: "🔴 FIN DE SERVICE",
      status: "Service terminé",
    },
    force: {
      color: 0x992d22,
      title: "🛑 FIN DE SERVICE FORCÉE",
      status: "Service terminé par le High Command",
    },
  };

  const current =
    eventConfig[type] || eventConfig.start;

  const user = await client.users
    .fetch(userId)
    .catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(current.color)
    .setAuthor({
      name: "HARMONY POLICE DEPARTMENT",
    })
    .setTitle(current.title)
    .setDescription(
      [
        `👮 <@${userId}>`,
        "",
        `**Statut :** ${current.status}`,
      ].join("\n")
    )
    .addFields({
      name: "🕒 Début du service",
      value: startedAt
        ? `<t:${unix(startedAt)}:F>`
        : "Non disponible",
      inline: true,
    });

  if (type === "pause") {
    embed.addFields({
      name: "☕ Début de la pause",
      value: pausedAt
        ? `<t:${unix(pausedAt)}:F>`
        : `<t:${Math.floor(Date.now() / 1000)}:F>`,
      inline: true,
    });
  }

  if (type === "resume") {
    embed.addFields({
      name: "▶️ Reprise du service",
      value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
      inline: true,
    });
  }

  if (type === "stop" || type === "force") {
    embed.addFields(
      {
        name: "🕒 Fin du service",
        value: endedAt
          ? `<t:${unix(endedAt)}:F>`
          : "Non disponible",
        inline: true,
      },
      {
        name: "⏱️ Temps comptabilisé",
        value: formatDuration(durationSeconds),
        inline: true,
      }
    );
  }

  if (
    type === "force" &&
    moderatorId
  ) {
    embed.addFields({
      name: "🛡️ Action effectuée par",
      value: `<@${moderatorId}>`,
      inline: true,
    });
  }

  if (user) {
    embed.setThumbnail(
      user.displayAvatarURL({
        size: 256,
      })
    );
  }

  embed
    .setFooter({
      text: "Harmony Police Department • Duty Log",
    })
    .setTimestamp();

  try {
    await channel.send({
      embeds: [embed],
      allowedMentions: {
        parse: [],
      },
    });
  } catch (error) {
    console.error(
      "❌ Envoi du log de présence impossible :",
      error?.message || error
    );
  }
}

async function handleAttendanceButton(interaction, client) {
  if (!interaction.customId?.startsWith("attendance:")) return false;

  // Discord exige une réponse en moins de 3 secondes.
  // On accuse donc réception immédiatement, avant toute vérification ou requête SQL.
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  if (!interaction.guild || !interaction.member) {
    await interaction.editReply(
      "❌ Cette action doit être utilisée dans le serveur."
    );
    return true;
  }

  if (!memberIsPolice(interaction.member)) {
    await interaction.editReply(
      "❌ Tu dois avoir le rôle Police pour utiliser la présence."
    );
    return true;
  }

  const customIdParts = interaction.customId.split(":");
  const action = customIdParts[1];

  if (action === "force") {
    if (
      !memberIsHighCommand(
        interaction.member,
        interaction
      )
    ) {
      await interaction.editReply(
        "❌ Cette action est réservée au High Command."
      );
      return true;
    }

    const targetUserId = String(
      customIdParts[2] || ""
    ).trim();

    if (!/^\d{16,22}$/.test(targetUserId)) {
      await interaction.editReply(
        "❌ Identifiant du policier invalide."
      );
      return true;
    }

    const result = await stopAttendance(
      targetUserId,
      interaction.user.id,
      "forced_by_high_command"
    );

    if (!result.stopped) {
      await interaction.editReply(
        "⚠️ Ce policier n'a plus de service actif."
      );

      await refreshAttendancePanel(client);
      return true;
    }

    await interaction.editReply(
      `✅ Le service de <@${targetUserId}> a été terminé de force.\n` +
      `⏱️ Temps comptabilisé : **${formatDuration(
        result.session.duration_seconds
      )}**.`
    );

    await Promise.allSettled([
      sendAttendanceLog(client, {
        userId: targetUserId,
        type: "force",
        startedAt: result.session.started_at,
        endedAt: result.session.ended_at,
        durationSeconds:
          result.session.duration_seconds,
        moderatorId: interaction.user.id,
      }),
      refreshAttendancePanel(client),
    ]);

    return true;
  }

  if (action === "start") {
    const result = await startAttendance(
      interaction.user.id,
      interaction.user.id
    );

    if (!result.started) {
      await interaction.editReply(
        `⚠️ Tu es déjà en service depuis <t:${unix(result.session.started_at)}:R>.`
      );
      return true;
    }

    await sendAttendanceLog(client, {
      userId: interaction.user.id,
      type: "start",
      startedAt: result.session.started_at,
      moderatorId: interaction.user.id,
    });

    await refreshAttendancePanel(client);

    await interaction.editReply(
      `✅ Service commencé à <t:${unix(result.session.started_at)}:t>.`
    );
    return true;
  }


  if (action === "pause") {
    const current = await getActiveAttendance(interaction.user.id);

    if (!current) {
      await interaction.editReply(
        "⚠️ Commence d'abord ton service avant de prendre une pause."
      );
      return true;
    }

    if (current.paused_at) {
      const result = await resumeAttendance(interaction.user.id);

      await interaction.editReply(
        result.resumed
          ? "▶️ Service repris. Le compteur est de nouveau actif."
          : "⚠️ Ton service n'est pas en pause."
      );

      if (result.resumed) {
        await Promise.allSettled([
          sendAttendanceLog(client, {
            userId: interaction.user.id,
            type: "resume",
            startedAt: result.session.started_at,
            moderatorId: interaction.user.id,
          }),
          refreshAttendancePanel(client),
        ]);
      }

      return true;
    }

    const result = await pauseAttendance(interaction.user.id);

    await interaction.editReply(
      result.paused
        ? "☕ Pause commencée. Le compteur est temporairement arrêté."
        : "⚠️ Impossible de mettre ton service en pause."
    );

    if (result.paused) {
      await Promise.allSettled([
        sendAttendanceLog(client, {
          userId: interaction.user.id,
          type: "pause",
          startedAt: result.session.started_at,
          pausedAt: result.session.paused_at,
          moderatorId: interaction.user.id,
        }),
        refreshAttendancePanel(client),
      ]);
    }

    return true;
  }

  if (action === "stop") {
    const result = await stopAttendance(
      interaction.user.id,
      interaction.user.id,
      "manual"
    );

    if (!result.stopped) {
      await interaction.editReply(
        "⚠️ Tu n'as aucune présence active."
      );
      return true;
    }

    await sendAttendanceLog(client, {
      userId: interaction.user.id,
      type: "stop",
      startedAt: result.session.started_at,
      endedAt: result.session.ended_at,
      durationSeconds: result.session.duration_seconds,
      moderatorId: interaction.user.id,
    });

    await refreshAttendancePanel(client);

    await interaction.editReply(
      `✅ Service terminé. Durée : **${formatDuration(result.session.duration_seconds)}**.`
    );
    return true;
  }

  if (action === "status") {
    const active = await getActiveAttendance(interaction.user.id);
    const totals = await getAttendanceTotals("week", 100);
    const weekly =
      totals.find((item) => item.user_id === interaction.user.id)
        ?.total_seconds || 0;

    const status = active
      ? `🟢 En service depuis <t:${unix(active.started_at)}:R>.`
      : "🔴 Tu es actuellement hors service.";

    await interaction.editReply(
      `${status}
⏱️ Temps total cette semaine : **${formatDuration(weekly)}**.`
    );
    return true;
  }

  await interaction.editReply(
    "❌ Action de présence inconnue."
  );
  return true;
}

module.exports = {
  ensureAttendancePanel,
  refreshAttendancePanel,
  handleAttendanceButton,
  formatDuration,
};
