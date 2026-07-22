const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const {
  startAttendance,
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

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function buildPanelPayload() {
  const active = await getActiveAttendances();
  const weekly = await getAttendanceTotals("week", 10);

  const activeLines = active.length
    ? active.slice(0, 25).map((session, index) =>
        `${index + 1}. <@${session.user_id}> — depuis <t:${unix(session.started_at)}:R>`
      ).join("\n")
    : "Aucun policier actuellement en service.";

  const weeklyLines = weekly.length
    ? weekly.map((entry, index) =>
        `${["🥇", "🥈", "🥉"][index] || `${index + 1}.`} <@${entry.user_id}> — **${formatDuration(entry.total_seconds)}**`
      ).join("\n")
    : "Aucune présence enregistrée cette semaine.";

  const embed = new EmbedBuilder()
    .setColor(active.length ? 0x2ecc71 : 0x95a5a6)
    .setTitle("🚓 PRÉSENCE HMPD")
    .setDescription(
      "Utilisez les boutons ci-dessous pour démarrer ou terminer votre service.\n" +
      "Le temps est conservé dans Neon PostgreSQL, même après un redémarrage."
    )
    .addFields(
      { name: `🟢 En service (${active.length})`, value: activeLines },
      { name: "🏆 Classement de la semaine", value: weeklyLines }
    )
    .setFooter({ text: "HMPD • Système de présence automatique" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("attendance:start")
      .setLabel("Prendre son service")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("attendance:stop")
      .setLabel("Finir son service")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("attendance:status")
      .setLabel("Mon temps")
      .setEmoji("⏱️")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function ensureAttendancePanel(client, forceNew = false) {
  if (!ATTENDANCE_CHANNEL_ID) {
    console.warn("⚠️ ATTENDANCE_CHANNEL_ID absent : panneau de présence désactivé.");
    return null;
  }
  const channel = await fetchTextChannel(client, ATTENDANCE_CHANNEL_ID);
  if (!channel) throw new Error("Salon de présence introuvable ou non textuel.");

  const payload = await buildPanelPayload();
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

async function sendAttendanceLog(client, { userId, type, startedAt, endedAt, durationSeconds, moderatorId }) {
  if (!ATTENDANCE_LOG_CHANNEL_ID) return;
  const channel = await fetchTextChannel(client, ATTENDANCE_LOG_CHANNEL_ID);
  if (!channel) return;
  const started = type === "start";
  const embed = new EmbedBuilder()
    .setColor(started ? 0x2ecc71 : 0xe74c3c)
    .setTitle(started ? "🟢 Prise de service" : "🔴 Fin de service")
    .addFields(
      { name: "👮 Policier", value: `<@${userId}>`, inline: true },
      { name: "📅 Début", value: `<t:${unix(startedAt)}:F>`, inline: true },
      ...(started ? [] : [
        { name: "📅 Fin", value: `<t:${unix(endedAt)}:F>`, inline: true },
        { name: "⏱️ Durée", value: formatDuration(durationSeconds), inline: true },
      ]),
      ...(moderatorId && moderatorId !== userId ? [{ name: "🛡️ Action par", value: `<@${moderatorId}>`, inline: true }] : [])
    )
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleAttendanceButton(interaction, client) {
  if (!interaction.customId?.startsWith("attendance:")) return false;
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "❌ Cette action doit être utilisée dans le serveur.", ephemeral: true });
    return true;
  }
  if (!memberIsPolice(interaction.member)) {
    await interaction.reply({ content: "❌ Tu dois avoir le rôle Police pour utiliser la présence.", ephemeral: true });
    return true;
  }

  const action = interaction.customId.split(":")[1];
  await interaction.deferReply({ ephemeral: true });

  if (action === "start") {
    const result = await startAttendance(interaction.user.id, interaction.user.id);
    if (!result.started) {
      await interaction.editReply(`⚠️ Tu es déjà en service depuis <t:${unix(result.session.started_at)}:R>.`);
      return true;
    }
    await sendAttendanceLog(client, {
      userId: interaction.user.id,
      type: "start",
      startedAt: result.session.started_at,
      moderatorId: interaction.user.id,
    });
    await refreshAttendancePanel(client);
    await interaction.editReply(`✅ Service commencé à <t:${unix(result.session.started_at)}:t>.`);
    return true;
  }

  if (action === "stop") {
    const result = await stopAttendance(interaction.user.id, interaction.user.id, "manual");
    if (!result.stopped) {
      await interaction.editReply("⚠️ Tu n'as aucune présence active.");
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
    await interaction.editReply(`✅ Service terminé. Durée : **${formatDuration(result.session.duration_seconds)}**.`);
    return true;
  }

  if (action === "status") {
    const active = await getActiveAttendance(interaction.user.id);
    const totals = await getAttendanceTotals("week", 100);
    const weekly = totals.find((x) => x.user_id === interaction.user.id)?.total_seconds || 0;
    const status = active
      ? `🟢 En service depuis <t:${unix(active.started_at)}:R>.`
      : "🔴 Tu es actuellement hors service.";
    await interaction.editReply(`${status}\n⏱️ Temps total cette semaine : **${formatDuration(weekly)}**.`);
    return true;
  }

  return true;
}

module.exports = {
  ensureAttendancePanel,
  refreshAttendancePanel,
  handleAttendanceButton,
  formatDuration,
};
