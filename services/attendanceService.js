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
  removeAttendanceTime,
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

function getForcedEndPenaltySeconds() {
  const raw = Number(process.env.FORCED_END_PENALTY_HOURS ?? 5);
  const hours = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 24) : 5;
  return Math.round(hours * 3600);
}

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

  // Les boutons personnalisés (début/pause/fin/admin) sont affichés dans
  // un panneau privé. Un message Discord public ne peut pas avoir des boutons
  // activés/désactivés différemment pour chaque policier.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("attendance:controls")
      .setLabel("Mon espace de service")
      .setEmoji("👮")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("attendance:status")
      .setLabel("Mes statistiques")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
    allowedMentions: {
      parse: [],
    },
  };
}


async function buildPersonalControlsPayload(interaction) {
  const active = await getActiveAttendance(interaction.user.id);
  const isPaused = Boolean(active?.paused_at);
  const isHighCommand = memberIsHighCommand(interaction.member, interaction);

  const statusText = !active
    ? "🔴 Hors service"
    : isPaused
      ? `🟡 En pause depuis <t:${unix(active.paused_at)}:R>`
      : `🟢 En service depuis <t:${unix(active.started_at)}:R>`;

  const embed = new EmbedBuilder()
    .setColor(!active ? 0x5865f2 : isPaused ? 0xf1c40f : 0x2ecc71)
    .setAuthor({ name: "HARMONY POLICE DEPARTMENT" })
    .setTitle("👮 Mon espace de service")
    .setDescription([
      `**${statusText}**`,
      "",
      active
        ? "Gère ta session avec les boutons ci-dessous."
        : "Tu peux commencer ton service avec le bouton vert.",
    ].join("\n"))
    .setFooter({
      text: isHighCommand
        ? "Accès High Command détecté • Administration disponible"
        : "Espace personnel • Seul toi peux voir ce panneau",
    })
    .setTimestamp();

  const serviceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("attendance:start")
      .setLabel(active ? "Déjà en service" : "Début de service")
      .setEmoji("🟢")
      .setStyle(active ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(Boolean(active)),

    new ButtonBuilder()
      .setCustomId("attendance:pause")
      .setLabel(isPaused ? "Reprendre" : "Mettre en pause")
      .setEmoji(isPaused ? "▶️" : "☕")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!active),

    new ButtonBuilder()
      .setCustomId("attendance:stop")
      .setLabel("Fin de service")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!active),

    new ButtonBuilder()
      .setCustomId("attendance:status")
      .setLabel("Mes statistiques")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary)
  );

  const components = [serviceRow];

  // Le bouton Administration n'existe que dans la réponse privée des hauts gradés.
  if (isHighCommand) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("attendance:admin")
          .setLabel("Administration High Command")
          .setEmoji("🛡️")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return {
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
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
      name: "HARMONY POLICE DEPARTMENT",
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
      text: "Harmony Police Department • Duty Report",
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

async function buildHighCommandPanel(client, guild, selectedUserId = null) {
  const active = await getActiveAttendances();

  const embed = new EmbedBuilder()
    .setColor(0x992d22)
    .setAuthor({
      name: "HARMONY POLICE DEPARTMENT",
    })
    .setTitle("🛡️ Centre d’administration des présences")
    .setDescription(
      active.length
        ? [
            `**${active.length} session(s) actuellement ouverte(s).**`,
            "",
            "La liste ci-dessous et le menu déroulant utilisent exactement les mêmes noms Discord.",
          ].join("\n")
        : "Aucune session active à administrer."
    )
    .setFooter({
      text: "Accès réservé au High Command • Liste actualisée",
    })
    .setTimestamp();

  if (!active.length) {
    const refreshRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("attendance:admin-refresh")
        .setLabel("Actualiser la liste")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [embed],
      components: [refreshRow],
      allowedMentions: { parse: [] },
    };
  }

  const visibleSessions = active.slice(0, 25);
  const resolvedSessions = await Promise.all(
    visibleSessions.map(async (session) => {
      const member = guild
        ? await guild.members.fetch(session.user_id).catch(() => null)
        : null;
      const user = member?.user || await client.users.fetch(session.user_id).catch(() => null);
      const displayName = String(
        member?.displayName ||
        user?.globalName ||
        user?.username ||
        session.user_id
      ).replace(/\s+/g, " ").trim();

      return { session, member, user, displayName };
    })
  );

  const selectedSession = selectedUserId
    ? resolvedSessions.find(({ session }) => session.user_id === selectedUserId)
    : null;

  if (selectedSession) {
    const { session, displayName } = selectedSession;
    const status = session.paused_at ? "☕ En pause" : "🟢 En service";
    const since = session.paused_at ? session.paused_at : session.started_at;

    embed.setDescription([
      "**Agent sélectionné pour l’action administrative**",
      "",
      `👮 **${displayName}**`,
      `└ <@${session.user_id}>`,
      `└ ${status} depuis <t:${unix(since)}:R>`,
    ].join("\n"));
  } else {
    embed.setDescription([
      `**${active.length} session(s) actuellement ouverte(s).**`,
      "",
      "Sélectionne un policier dans le menu déroulant.",
      "Après la sélection, seul le policier choisi sera affiché ici.",
    ].join("\n"));
  }

  embed.addFields({
    name: "⚙️ Action administrative",
    value: selectedSession
      ? [
          `✅ **${selectedSession.displayName}** est sélectionné.`,
          "Clique sur **Forcer la fin du service** pour confirmer.",
          "⚠️ Cette action sera enregistrée dans les logs administratifs.",
        ].join("\n")
      : [
          "Choisis d’abord un agent dans le menu ci-dessous.",
          "Le bouton de confirmation restera désactivé tant qu’aucun agent n’est sélectionné.",
        ].join("\n"),
    inline: false,
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("attendance:force-select")
    .setPlaceholder(`Sélectionner un agent (${visibleSessions.length} disponible${visibleSessions.length > 1 ? "s" : ""})`)
    .setMinValues(1)
    .setMaxValues(1);

  for (const { session, displayName } of resolvedSessions) {
    const description = session.paused_at
      ? `En pause depuis ${new Date(session.paused_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
      : `En service depuis ${new Date(session.started_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(displayName.slice(0, 100))
        .setDescription(description.slice(0, 100))
        .setValue(session.user_id)
        .setEmoji(session.paused_at ? "☕" : "🟢")
        .setDefault(session.user_id === selectedUserId)
    );
  }

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(selectedSession ? `attendance:force-confirm:${selectedSession.session.user_id}` : "attendance:force-confirm:none")
      .setLabel("Forcer la fin du service")
      .setEmoji("🛑")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!selectedSession),
    new ButtonBuilder()
      .setCustomId("attendance:admin-refresh")
      .setLabel("Actualiser la liste")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [selectRow, actionRow],
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

  // Le menu appartient déjà au panneau privé d'administration.
  // deferUpdate accuse réception sans créer un nouveau message éphémère.
  await interaction.deferUpdate();

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

  const activeSession = await getActiveAttendance(targetUserId);

  if (!activeSession) {
    const payload = await buildHighCommandPanel(
      interaction.client,
      interaction.guild
    );
    await interaction.editReply({
      content: "⚠️ Ce policier n’a plus de service actif. La liste a été actualisée.",
      ...payload,
    });
    return true;
  }

  const payload = await buildHighCommandPanel(
    interaction.client,
    interaction.guild,
    targetUserId
  );

  await interaction.editReply({
    content: null,
    ...payload,
  });

  return true;
}

async function handleAttendanceButton(interaction, client) {
  if (!interaction.customId?.startsWith("attendance:")) return false;

  const customIdParts = interaction.customId.split(":");
  const action = customIdParts[1];

  // Un clic depuis le panneau public doit ouvrir un espace privé.
  // Un clic depuis cet espace privé doit modifier le même message, jamais en créer un autre.
  const sourceIsEphemeral = Boolean(
    interaction.message?.flags?.has?.(MessageFlags.Ephemeral)
  );

  if (sourceIsEphemeral) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.guild || !interaction.member) {
    await interaction.editReply(
      "❌ Cette action doit être utilisée dans le serveur."
    );
    return true;
  }

  const isAdminAction = action === "admin" || action === "admin-refresh" || action === "force-confirm";

  if (!memberIsPolice(interaction.member) && !isAdminAction) {
    await interaction.editReply(
      "❌ Tu dois avoir le rôle Police pour utiliser la présence."
    );
    return true;
  }

  if (action === "controls") {
    const payload = await buildPersonalControlsPayload(interaction);
    await interaction.editReply({ content: null, ...payload });
    return true;
  }

  if (action === "admin-refresh") {
    if (!memberIsHighCommand(interaction.member, interaction)) {
      await interaction.editReply(
        "❌ Cette action est réservée au High Command."
      );
      return true;
    }

    const payload = await buildHighCommandPanel(client, interaction.guild);
    await interaction.editReply(payload);
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

    const targetUserId = String(customIdParts[2] || "").trim();

    if (!/^\d{16,22}$/.test(targetUserId)) {
      const payload = await buildHighCommandPanel(client, interaction.guild);
      await interaction.editReply({
        content: "⚠️ Sélectionne d’abord un agent dans le menu.",
        ...payload,
      });
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

    const penaltyRequestedSeconds = getForcedEndPenaltySeconds();
    let penaltyRemovedSeconds = 0;
    let penaltyError = null;

    if (penaltyRequestedSeconds > 0) {
      try {
        const penalty = await removeAttendanceTime({
          userId: targetUserId,
          seconds: penaltyRequestedSeconds,
          reason: "Pénalité automatique — oubli de fin de service (panneau Discord)",
          moderatorId: interaction.user.id,
        });
        penaltyRemovedSeconds = Number(penalty.removedSeconds || 0);
      } catch (error) {
        // Le service est quand même terminé, même si aucune heure n'est disponible.
        if (Number(error?.status) !== 409) {
          penaltyError = error?.message || String(error);
          console.error("❌ Erreur pénalité de fin forcée :", penaltyError);
        }
      }
    }

    const refreshedAdminPayload = await buildHighCommandPanel(
      client,
      interaction.guild
    );

    const penaltyText = penaltyRemovedSeconds > 0
      ? `➖ Pénalité retirée : **${formatDuration(penaltyRemovedSeconds)}**.`
      : "⚠️ Aucune heure disponible à retirer.";

    await interaction.editReply({
      content:
        `✅ Le service de <@${targetUserId}> a été terminé de force.\n` +
        `⏱️ Temps de la session : **${formatDuration(result.session.duration_seconds)}**.\n` +
        `${penaltyText}` +
        (penaltyError ? `\n⚠️ Erreur de pénalité : ${penaltyError}` : ""),
      ...refreshedAdminPayload,
    });

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

    const payload = await buildPersonalControlsPayload(interaction);
    await interaction.editReply({
      content: `✅ Service commencé à <t:${unix(result.session.started_at)}:t>.`,
      ...payload,
    });
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

      if (result.resumed) {
        await refreshAttendancePanel(client);
        const payload = await buildPersonalControlsPayload(interaction);
        await interaction.editReply({
          content: "▶️ Service repris. Le compteur est de nouveau actif.",
          ...payload,
        });
      } else {
        await interaction.editReply("⚠️ Ton service n'est pas en pause.");
      }

      return true;
    }

    const result = await pauseAttendance(interaction.user.id);

    if (result.paused) {
      await refreshAttendancePanel(client);
      const payload = await buildPersonalControlsPayload(interaction);
      await interaction.editReply({
        content: "☕ Pause commencée. Le compteur est temporairement arrêté.",
        ...payload,
      });
    } else {
      await interaction.editReply("⚠️ Impossible de mettre ton service en pause.");
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

    const payload = await buildPersonalControlsPayload(interaction);
    await interaction.editReply({
      content: `✅ Service terminé. Durée : **${formatDuration(result.session.duration_seconds)}**.`,
      ...payload,
    });
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

    const payload =
      await buildHighCommandPanel(client, interaction.guild);

    await interaction.editReply({ content: null, ...payload });
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
        name: "HARMONY POLICE DEPARTMENT",
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
        text: "Harmony Police Department • Statistiques personnelles",
      })
      .setTimestamp();

    const navigationComponents = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("attendance:controls")
          .setLabel("Retour à mon espace")
          .setEmoji("↩️")
          .setStyle(ButtonStyle.Primary)
      ),
    ];

    if (memberIsHighCommand(interaction.member, interaction)) {
      navigationComponents.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("attendance:admin")
            .setLabel("Administration High Command")
            .setEmoji("🛡️")
            .setStyle(ButtonStyle.Secondary)
        )
      );
    }

    await interaction.editReply({
      content: null,
      embeds: [statsEmbed],
      components: navigationComponents,
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
