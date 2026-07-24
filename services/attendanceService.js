const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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
const DEPARTMENT_NAME = String(process.env.DEPARTMENT_NAME || "HARMONY POLICE DEPARTMENT").trim();
const DEPARTMENT_SHORT_NAME = String(process.env.DEPARTMENT_SHORT_NAME || "HMPD").trim();
const forceSelectionByModerator = new Map();

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

async function buildPanelPayload(client, activeOverride = null) {
  const active = Array.isArray(activeOverride)
    ? activeOverride
    : await getActiveAttendances();
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
            `└ ⏱️ Depuis <t:${unix(session.started_at)}:R>`
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
        .filter(
          (entry) =>
            Number(entry.total_seconds || 0) > 0
        )
        .map(
          (entry, index) =>
            `${medals[index] || "•"} <@${entry.user_id}>\n` +
            `└ ⏱️ **${formatDuration(entry.total_seconds)}**`
        )
        .join("\n\n") ||
      "Aucune présence enregistrée cette semaine."
    : "Aucune présence enregistrée cette semaine.";

  const totalWeeklySeconds = weekly.reduce(
    (total, entry) =>
      total + Number(entry.total_seconds || 0),
    0
  );

  const weekStart = Math.floor(new Date(
    new Date().setDate(new Date().getDate() - ((new Date().getDay() + 6) % 7))
  ).setHours(0, 0, 0, 0) / 1000);

  const weeklyChampion = weekly.find(
    (entry) => Number(entry.total_seconds || 0) > 0
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
      name: DEPARTMENT_NAME,
    })
    .setTitle("🚔 CENTRE DE GESTION DES SERVICES")
    .setDescription(
      [
        `**${departmentStatus}**`,
        "",
        `📅 Semaine en cours depuis <t:${weekStart}:D>`,
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
          `> 🏆 **Leader de la semaine :** ${weeklyChampion ? `<@${weeklyChampion.user_id}>` : "Aucun classement"}`,
          `> ⏱️ **Temps cumulé du Top 3 :** ${formatDuration(
            totalWeeklySeconds
          )}`,
          `> 🔄 **Mise à jour :** automatique chaque minute`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({
      text: `${DEPARTMENT_NAME} • Actualisation automatique • Reset du classement chaque lundi`,
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
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("attendance:admin")
      .setLabel("Administration")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Secondary)
  );

  const utilityRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("attendance:refresh")
      .setLabel("Actualiser le panneau")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row, utilityRow],
    allowedMentions: {
      parse: [],
    },
  };
}

async function ensureAttendancePanel(client, forceNew = false, activeOverride = null) {
  if (!ATTENDANCE_CHANNEL_ID) {
    console.warn("⚠️ ATTENDANCE_CHANNEL_ID absent : panneau de présence désactivé.");
    return null;
  }
  const channel = await fetchTextChannel(client, ATTENDANCE_CHANNEL_ID);
  if (!channel) throw new Error("Salon de présence introuvable ou non textuel.");

  const payload = await buildPanelPayload(client, activeOverride);
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

async function refreshAttendancePanel(client, activeOverride = null) {
  return ensureAttendancePanel(client, false, activeOverride).catch((error) => {
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
    durationSeconds,
    pausedSeconds = 0,
    pauseCount = 0,
    moderatorId,
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

  const forced = type === "force";
  const user = await client.users
    .fetch(userId)
    .catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(forced ? 0x992d22 : 0xe74c3c)
    .setAuthor({
      name: DEPARTMENT_NAME,
    })
    .setTitle(
      forced
        ? "🛑 RAPPORT DE SERVICE — FIN FORCÉE"
        : "📋 RAPPORT DE SERVICE"
    )
    .setDescription(`👮 <@${userId}>`)
    .addFields(
      {
        name: "🟢 Début du service",
        value: startedAt
          ? `<t:${unix(startedAt)}:F>`
          : "Non disponible",
        inline: true,
      },
      {
        name: "🔴 Fin du service",
        value: endedAt
          ? `<t:${unix(endedAt)}:F>`
          : "Non disponible",
        inline: true,
      },
      {
        name: "⏱️ Temps travaillé",
        value: formatDuration(durationSeconds),
        inline: true,
      },
      {
        name: "☕ Nombre de pauses",
        value: String(Number(pauseCount) || 0),
        inline: true,
      },
      {
        name: "☕ Temps total en pause",
        value: formatDuration(pausedSeconds),
        inline: true,
      },
      {
        name: forced
          ? "🛡️ Fin forcée par"
          : "👤 Fin de service par",
        value: moderatorId
          ? `<@${moderatorId}>`
          : `<@${userId}>`,
        inline: true,
      }
    )
    .setFooter({
      text: `${DEPARTMENT_NAME} • Rapport de service`,
    })
    .setTimestamp();

  if (user) {
    embed.setThumbnail(
      user.displayAvatarURL({
        size: 256,
      })
    );
  }

  try {
    await channel.send({
      embeds: [embed],
      allowedMentions: {
        parse: [],
      },
    });
  } catch (error) {
    console.error(
      "❌ Envoi du rapport de service impossible :",
      error?.message || error
    );
  }
}

async function buildHighCommandPanel(client, activeOverride = null) {
  const active = Array.isArray(activeOverride)
    ? activeOverride
    : await getActiveAttendances();

  const activeAgentLines = [];

  for (const session of active.slice(0, 25)) {
    const user = await client.users.fetch(session.user_id).catch(() => null);
    const displayName = String(
      user?.globalName || user?.username || session.user_id
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    const statusText = session.paused_at
      ? `☕ En pause depuis <t:${unix(session.paused_at)}:R>`
      : `🟢 En service depuis <t:${unix(session.started_at)}:R>`;

    activeAgentLines.push(
      `**${activeAgentLines.length + 1}. ${displayName}** — <@${session.user_id}>\n` +
      `└ ${statusText}`
    );
  }

  const embed = new EmbedBuilder()
    .setColor(active.length ? 0x992d22 : 0x5865f2)
    .setAuthor({ name: DEPARTMENT_NAME })
    .setTitle("🛡️ CENTRE D’ADMINISTRATION DES PRÉSENCES")
    .setDescription(
      active.length
        ? [
            `**${active.length} session(s) actuellement ouverte(s).**`,
            "",
            "### 👮 Agents actuellement connectés",
            activeAgentLines.join("\n\n"),
            "",
            "### ⚙️ Action administrative",
            "Choisis l’agent dans le menu ci-dessous, puis confirme la fin forcée de son service.",
            "⚠️ Toute fin forcée est enregistrée dans les logs administratifs.",
          ].join("\n")
        : "Aucune session active à administrer."
    )
    .setFooter({
      text: `${DEPARTMENT_NAME} • Accès réservé au High Command • Liste actualisée`,
    })
    .setTimestamp();

  if (!active.length) {
    return {
      embeds: [embed],
      components: [],
      allowedMentions: { parse: [] },
    };
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("attendance:force-select")
    .setPlaceholder(`Sélectionner un agent (${active.length} disponible${active.length > 1 ? "s" : ""})`)
    .setMinValues(1)
    .setMaxValues(1);

  for (const session of active.slice(0, 25)) {
    const user = await client.users.fetch(session.user_id).catch(() => null);

    const label = String(
      user?.globalName || user?.username || session.user_id
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90);

    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setDescription(
          (session.paused_at ? "En pause" : "En service") +
          ` • début ${new Date(session.started_at).toLocaleString("fr-FR", {
            timeZone: "Europe/Brussels",
            hour: "2-digit",
            minute: "2-digit",
          })}`
        )
        .setValue(String(session.user_id))
        .setEmoji(session.paused_at ? "☕" : "🟢")
    );
  }

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("attendance:force-confirm")
      .setLabel("Forcer la fin du service")
      .setEmoji("🛑")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("attendance:admin-refresh")
      .setLabel("Actualiser la liste")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [selectRow, confirmRow],
    allowedMentions: { parse: [] },
  };
}

async function handleAttendanceSelect(
  interaction
) {
  if (
    !interaction.isStringSelectMenu() ||
    interaction.customId !==
      "attendance:force-select"
  ) {
    return false;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

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
    interaction.values?.[0] || ""
  ).trim();

  if (!/^\d{16,22}$/.test(targetUserId)) {
    await interaction.editReply(
      "❌ Identifiant du policier invalide."
    );
    return true;
  }

  forceSelectionByModerator.set(
    interaction.user.id,
    {
      targetUserId,
      expiresAt: Date.now() + 5 * 60 * 1000,
    }
  );

  await interaction.editReply(
    `✅ <@${targetUserId}> sélectionné.\n` +
    "Clique maintenant sur **Forcer la fin du service**."
  );

  return true;
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

  if (
    !memberIsPolice(interaction.member) &&
    !memberIsHighCommand(interaction.member, interaction)
  ) {
    await interaction.editReply(
      "❌ Tu dois avoir le rôle Police pour utiliser la présence."
    );
    return true;
  }

  const customIdParts = interaction.customId.split(":");
  const action = customIdParts[1];

  if (action === "admin-refresh") {
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

    const activeSnapshot = await getActiveAttendances();
    await refreshAttendancePanel(client, activeSnapshot);
    const adminPayload = await buildHighCommandPanel(client, activeSnapshot);
    await interaction.editReply(adminPayload);
    return true;
  }

  if (action === "refresh") {
    await refreshAttendancePanel(client);
    await interaction.editReply(
      "✅ Le panneau de présence vient d’être actualisé."
    );
    return true;
  }

  if (action === "force-confirm") {
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

    const selection =
      forceSelectionByModerator.get(
        interaction.user.id
      );

    if (
      !selection ||
      selection.expiresAt < Date.now()
    ) {
      forceSelectionByModerator.delete(
        interaction.user.id
      );

      await interaction.editReply(
        "⚠️ Sélectionne d'abord un agent dans le menu."
      );
      return true;
    }

    const targetUserId =
      selection.targetUserId;

    forceSelectionByModerator.delete(
      interaction.user.id
    );

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

    const forceResults =
      await Promise.allSettled([
        sendAttendanceLog(client, {
          userId: targetUserId,
          type: "force",
          startedAt:
            result.session.started_at,
          endedAt:
            result.session.ended_at,
          durationSeconds:
            result.session.duration_seconds,
          pausedSeconds:
            result.session.paused_seconds,
          pauseCount:
            result.session.pause_count,
          moderatorId:
            interaction.user.id,
        }),
        refreshAttendancePanel(client),
      ]);

    for (const resultItem of forceResults) {
      if (
        resultItem.status === "rejected"
      ) {
        console.error(
          "❌ Erreur après fin de service forcée :",
          resultItem.reason?.message ||
            resultItem.reason
        );
      }
    }

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
        await refreshAttendancePanel(client);
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
      await refreshAttendancePanel(client);
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
      pausedSeconds: result.session.paused_seconds,
      pauseCount: result.session.pause_count,
      moderatorId: interaction.user.id,
    });

    await refreshAttendancePanel(client);

    await interaction.editReply(
      `✅ Service terminé. Durée : **${formatDuration(result.session.duration_seconds)}**.`
    );
    return true;
  }

  if (action === "admin") {
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

    // Une seule lecture de la base est utilisée pour les deux panneaux.
    // Ainsi, la liste administrative et le panneau principal affichent
    // toujours exactement les mêmes agents au même instant.
    const activeSnapshot = await getActiveAttendances();
    await refreshAttendancePanel(client, activeSnapshot);

    const payload =
      await buildHighCommandPanel(client, activeSnapshot);

    await interaction.editReply(payload);
    return true;
  }

  if (action === "status") {
    const [
      active,
      todayTotals,
      weeklyTotals,
      monthlyTotals,
    ] = await Promise.all([
      getActiveAttendance(
        interaction.user.id
      ),
      getAttendanceTotals("day", 100),
      getAttendanceTotals("week", 100),
      getAttendanceTotals("month", 100),
    ]);

    const findTotal = (list) =>
      Number(
        list.find(
          (item) =>
            item.user_id ===
            interaction.user.id
        )?.total_seconds || 0
      );

    const weeklySorted = [
      ...weeklyTotals,
    ].sort(
      (a, b) =>
        Number(b.total_seconds) -
        Number(a.total_seconds)
    );

    const rankIndex =
      weeklySorted.findIndex(
        (item) =>
          item.user_id ===
          interaction.user.id
      );

    const currentStatus = !active
      ? "🔴 Hors service"
      : active.paused_at
        ? "🟡 En pause"
        : "🟢 En service";

    const sessionText = active
      ? active.paused_at
        ? `Pause depuis <t:${unix(
            active.paused_at
          )}:R>`
        : `Depuis <t:${unix(
            active.started_at
          )}:R>`
      : "Aucune session active";

    const user = await client.users
      .fetch(interaction.user.id)
      .catch(() => interaction.user);

    const statsEmbed = new EmbedBuilder()
      .setColor(
        active
          ? active.paused_at
            ? 0xf1c40f
            : 0x2ecc71
          : 0x5865f2
      )
      .setAuthor({
        name: DEPARTMENT_NAME,
      })
      .setTitle("📊 Mes statistiques de service")
      .setThumbnail(
        user.displayAvatarURL({
          size: 256,
        })
      )
      .addFields(
        {
          name: "👮 Policier",
          value: `<@${interaction.user.id}>`,
          inline: true,
        },
        {
          name: "📡 Statut",
          value: currentStatus,
          inline: true,
        },
        {
          name: "⏱️ Session actuelle",
          value: sessionText,
          inline: false,
        },
        {
          name: "📅 Aujourd'hui",
          value: formatDuration(
            findTotal(todayTotals)
          ),
          inline: true,
        },
        {
          name: "📆 Cette semaine",
          value: formatDuration(
            findTotal(weeklyTotals)
          ),
          inline: true,
        },
        {
          name: "🗓️ Ce mois",
          value: formatDuration(
            findTotal(monthlyTotals)
          ),
          inline: true,
        },
        {
          name: "🏆 Classement hebdomadaire",
          value:
            rankIndex >= 0
              ? `#${rankIndex + 1} sur ${weeklySorted.length}`
              : "Non classé",
          inline: false,
        }
      )
      .setFooter({
        text: `${DEPARTMENT_NAME} • Statistiques personnelles`,
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [statsEmbed],
      components: [],
      allowedMentions: {
        parse: [],
      },
    });

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
  handleAttendanceSelect,
  formatDuration,
};
