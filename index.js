require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const {
  ensureAttendancePanel,
  refreshAttendancePanel,
  handleAttendanceButton,
} = require("./services/attendanceService");

const {
  getOfficer,
  updateOfficer,
  changeOfficerPoints,
  getOfficerHistory,
  getLeaderboard,
  countOfficers,
  closeDatabase,
} = require("./database");

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const TOKEN = process.env.TOKEN;

const PROMOTION_CHANNEL_ID = process.env.PROMOTION_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const ROLE_HIGH_COMMAND = process.env.ROLE_HIGH_COMMAND;

/*
|--------------------------------------------------------------------------
| Grades et points nécessaires
|--------------------------------------------------------------------------
*/

const GRADES = [
  {
    name: "Academy",
    points: 0,
    roleId: process.env.ROLE_ACADEMY,
  },
  {
    name: "Officer",
    points: 10,
    roleId: process.env.ROLE_OFFICER,
  },
  {
    name: "Senior Officer",
    points: 25,
    roleId: process.env.ROLE_SENIOR_OFFICER,
  },
  {
    name: "Sergent",
    points: 45,
    roleId: process.env.ROLE_SERGENT,
  },
  {
    name: "First Sergent",
    points: 70,
    roleId: process.env.ROLE_FIRST_SERGENT,
  },
  {
    name: "Lieutenant",
    points: 100,
    roleId: process.env.ROLE_LIEUTENANT,
  },
  {
    name: "Captain",
    points: 140,
    roleId: process.env.ROLE_CAPTAIN,
  },
  {
    name: "Commander",
    points: 190,
    roleId: process.env.ROLE_COMMANDER,
  },
];

/*
|--------------------------------------------------------------------------
| Vérification du fichier .env
|--------------------------------------------------------------------------
*/

const requiredEnvironmentVariables = [
  "TOKEN",
  "PROMOTION_CHANNEL_ID",
  "LOG_CHANNEL_ID",
  "ROLE_HIGH_COMMAND",
  "ROLE_ACADEMY",
  "ROLE_OFFICER",
  "ROLE_SENIOR_OFFICER",
  "ROLE_SERGENT",
  "ROLE_FIRST_SERGENT",
  "ROLE_LIEUTENANT",
  "ROLE_CAPTAIN",
  "ROLE_COMMANDER",
];

const missingVariables = requiredEnvironmentVariables.filter(
  (variableName) => !process.env[variableName]
);

if (missingVariables.length > 0) {
  console.error("❌ Informations manquantes dans le fichier .env :");

  for (const variableName of missingVariables) {
    console.error(`- ${variableName}`);
  }

  process.exit(1);
}

/*
|--------------------------------------------------------------------------
| Fonctions des grades
|--------------------------------------------------------------------------
*/

function getGradeFromPoints(points) {
  let currentGrade = GRADES[0];

  for (const grade of GRADES) {
    if (points >= grade.points) {
      currentGrade = grade;
    }
  }

  return currentGrade;
}

function getNextGrade(points) {
  return GRADES.find((grade) => grade.points > points) || null;
}

function getPreviousGrade(points) {
  const currentGrade = getGradeFromPoints(points);
  const currentIndex = GRADES.findIndex(
    (grade) => grade.roleId === currentGrade.roleId
  );

  if (currentIndex <= 0) {
    return null;
  }

  return GRADES[currentIndex - 1];
}

function getAllGradeRoleIds() {
  return GRADES.map((grade) => grade.roleId);
}

/*
|--------------------------------------------------------------------------
| Réponses privées
|--------------------------------------------------------------------------
*/

function privateReply(content) {
  return {
    content,
    flags: MessageFlags.Ephemeral,
  };
}

/*
|--------------------------------------------------------------------------
| Vérification High Command
|--------------------------------------------------------------------------
*/

function isHighCommand(interaction) {
  if (!interaction.member) {
    return false;
  }

  const hasHighCommandRole =
    interaction.member.roles.cache.has(ROLE_HIGH_COMMAND);

  const isServerAdministrator =
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    );

  return hasHighCommandRole || isServerAdministrator;
}

/*
|--------------------------------------------------------------------------
| Vérification du membre et des rôles
|--------------------------------------------------------------------------
*/

function verifyMemberCanBeManaged(member) {
  if (!member) {
    throw new Error("MEMBER_NOT_FOUND");
  }

  if (member.user.bot) {
    throw new Error("MEMBER_IS_BOT");
  }

  if (member.id === member.guild.ownerId) {
    throw new Error("MEMBER_IS_OWNER");
  }

  if (!member.manageable) {
    throw new Error("MEMBER_NOT_MANAGEABLE");
  }
}

async function verifyConfiguredRoles(guild) {
  const missingRoles = [];

  for (const grade of GRADES) {
    const role = await guild.roles
      .fetch(grade.roleId)
      .catch(() => null);

    if (!role) {
      missingRoles.push(grade.name);
    }
  }

  const highCommandRole = await guild.roles
    .fetch(ROLE_HIGH_COMMAND)
    .catch(() => null);

  if (!highCommandRole) {
    missingRoles.push("High Command");
  }

  if (missingRoles.length > 0) {
    throw new Error(
      `Rôles introuvables : ${missingRoles.join(", ")}`
    );
  }
}

/*
|--------------------------------------------------------------------------
| Récupération sécurisée d'un salon
|--------------------------------------------------------------------------
*/

async function fetchTextChannel(guild, channelId) {
  const channel = await guild.channels
    .fetch(channelId)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel;
}

/*
|--------------------------------------------------------------------------
| Logs automatiques
|--------------------------------------------------------------------------
*/

async function sendPointsLog({
  guild,
  member,
  moderator,
  action,
  amount,
  oldPoints,
  newPoints,
  reason,
  oldGrade,
  newGrade,
}) {
  const logChannel = await fetchTextChannel(
    guild,
    LOG_CHANNEL_ID
  );

  if (!logChannel) {
    console.error("❌ Salon des logs introuvable.");
    return;
  }

  const isAddition = action === "add";

  const embed = new EmbedBuilder()
    .setColor(isAddition ? 0x2ecc71 : 0xe74c3c)
    .setTitle(
      isAddition
        ? "📈 Ajout de points"
        : "📉 Retrait de points"
    )
    .setThumbnail(
      member.user.displayAvatarURL({
        size: 256,
      })
    )
    .addFields(
      {
        name: "👤 Policier",
        value: `${member}`,
        inline: true,
      },
      {
        name: "👮 Responsable",
        value: `${moderator}`,
        inline: true,
      },
      {
        name: isAddition
          ? "➕ Points ajoutés"
          : "➖ Points retirés",
        value: `${amount}`,
        inline: true,
      },
      {
        name: "⭐ Ancien total",
        value: `${oldPoints}`,
        inline: true,
      },
      {
        name: "⭐ Nouveau total",
        value: `${newPoints}`,
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
      }
    )
    .setFooter({
      text: `HMPD • ID du policier : ${member.id}`,
    })
    .setTimestamp();

  await logChannel.send({
    embeds: [embed],
    allowedMentions: {
      parse: [],
    },
  });
}

/*
|--------------------------------------------------------------------------
| Annonce de promotion
|--------------------------------------------------------------------------
*/

async function sendPromotionAnnouncement({
  guild,
  member,
  oldGrade,
  newGrade,
  points,
}) {
  const promotionChannel = await fetchTextChannel(
    guild,
    PROMOTION_CHANNEL_ID
  );

  if (!promotionChannel) {
    console.error("❌ Salon des promotions introuvable.");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🎖️ PROMOTION OFFICIELLE")
    .setThumbnail(
      member.user.displayAvatarURL({
        size: 256,
      })
    )
    .setDescription(
      [
        `👤 **Agent :** ${member}`,
        "",
        `⬆️ **Ancien grade :** ${oldGrade.name}`,
        "",
        `🏅 **Nouveau grade :** ${newGrade.name}`,
        "",
        `⭐ **Total des points :** ${points}`,
        "",
        `📅 **Date :** <t:${Math.floor(Date.now() / 1000)}:F>`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "🎉 Félicitations pour cette promotion !",
        "",
        "Votre activité, votre discipline et votre travail",
        "ont été récompensés.",
        "",
        "**— Administration HMPD 🚔**",
      ].join("\n")
    )
    .setFooter({
      text: "HMPD • Official Promotion",
    })
    .setTimestamp();

  await promotionChannel.send({
    content: `🎉 Félicitations ${member} !`,
    embeds: [embed],

    // Mentionne uniquement le policier promu
    allowedMentions: {
      users: [member.id],
      roles: [],
      parse: [],
    },
  });
}

/*
|--------------------------------------------------------------------------
| Annonce de rétrogradation
|--------------------------------------------------------------------------
*/

async function sendDemotionLog({
  guild,
  member,
  oldGrade,
  newGrade,
  points,
}) {
  const logChannel = await fetchTextChannel(
    guild,
    LOG_CHANNEL_ID
  );

  if (!logChannel) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xc0392b)
    .setTitle("🔻 RÉTROGRADATION AUTOMATIQUE")
    .setDescription(
      [
        `👤 **Policier :** ${member}`,
        "",
        `⬇️ **Ancien grade :** ${oldGrade.name}`,
        "",
        `🎖️ **Nouveau grade :** ${newGrade.name}`,
        "",
        `⭐ **Points restants :** ${points}`,
      ].join("\n")
    )
    .setFooter({
      text: "HMPD • Automatic Demotion",
    })
    .setTimestamp();

  await logChannel.send({
    embeds: [embed],
    allowedMentions: {
      parse: [],
    },
  });
}

/*
|--------------------------------------------------------------------------
| Synchronisation du rôle Discord
|--------------------------------------------------------------------------
*/

async function synchronizeMemberGrade(
  member,
  points,
  announceChange = true
) {
  verifyMemberCanBeManaged(member);

  const expectedGrade = getGradeFromPoints(points);
  const gradeRoleIds = getAllGradeRoleIds();

  const currentGradeRole = member.roles.cache.find((role) =>
    gradeRoleIds.includes(role.id)
  );

  const oldGrade =
    GRADES.find(
      (grade) => grade.roleId === currentGradeRole?.id
    ) || getGradeFromPoints(points);

  const rolesToRemove = member.roles.cache.filter(
    (role) =>
      gradeRoleIds.includes(role.id) &&
      role.id !== expectedGrade.roleId
  );

  if (rolesToRemove.size > 0) {
    await member.roles.remove(
      rolesToRemove,
      "Synchronisation automatique du grade HMPD"
    );
  }

  if (!member.roles.cache.has(expectedGrade.roleId)) {
    await member.roles.add(
      expectedGrade.roleId,
      `Grade HMPD correspondant à ${points} points`
    );
  }

  await updateOfficer(
    member.id,
    points,
    expectedGrade.name
  );

  const oldGradeIndex = GRADES.findIndex(
    (grade) => grade.roleId === oldGrade.roleId
  );

  const newGradeIndex = GRADES.findIndex(
    (grade) => grade.roleId === expectedGrade.roleId
  );

  const promoted = newGradeIndex > oldGradeIndex;
  const demoted = newGradeIndex < oldGradeIndex;

  if (announceChange && promoted) {
    await sendPromotionAnnouncement({
      guild: member.guild,
      member,
      oldGrade,
      newGrade: expectedGrade,
      points,
    });
  }

  if (announceChange && demoted) {
    await sendDemotionLog({
      guild: member.guild,
      member,
      oldGrade,
      newGrade: expectedGrade,
      points,
    });
  }

  return {
    changed:
      !currentGradeRole ||
      currentGradeRole.id !== expectedGrade.roleId,
    promoted,
    demoted,
    oldGrade,
    newGrade: expectedGrade,
  };
}

/*
|--------------------------------------------------------------------------
| Modification professionnelle des points
|--------------------------------------------------------------------------
*/

async function modifyPoints({
  interaction,
  action,
}) {
  if (!isHighCommand(interaction)) {
    await interaction.reply(
      privateReply(
        "❌ Cette commande est réservée au High Command."
      )
    );

    return;
  }

  const user = interaction.options.getUser(
    "membre",
    true
  );

  const requestedAmount =
    interaction.options.getInteger("points", true);

  const reason =
    interaction.options.getString("raison", true);

  if (user.bot) {
    await interaction.reply(
      privateReply(
        "❌ Tu ne peux pas modifier les points d'un bot."
      )
    );

    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const member = await interaction.guild.members.fetch(
    user.id
  );

  verifyMemberCanBeManaged(member);

  const officerBefore = await getOfficer(user.id);
  const oldPoints = Number(officerBefore.points);

  let newPoints;
  let actualAmount;

  if (action === "add") {
    actualAmount = requestedAmount;
    newPoints = oldPoints + actualAmount;
  } else {
    actualAmount = Math.min(
      requestedAmount,
      oldPoints
    );

    newPoints = oldPoints - actualAmount;
  }

  const oldGrade = getGradeFromPoints(oldPoints);
  const newGrade = getGradeFromPoints(newPoints);

  const databaseResult = await changeOfficerPoints({
    userId: user.id,
    action,
    amount: requestedAmount,
    grade: newGrade.name,
    reason,
    moderatorId: interaction.user.id,
  });

  try {
    await synchronizeMemberGrade(
      member,
      databaseResult.newPoints,
      true
    );
  } catch (roleError) {
    /*
    | Remise de la base dans son état précédent si le rôle
    | n'a pas pu être modifié.
    */

    await updateOfficer(
      user.id,
      oldPoints,
      oldGrade.name
    );

    throw roleError;
  }

  await sendPointsLog({
    guild: interaction.guild,
    member,
    moderator: interaction.user,
    action,
    amount: databaseResult.amount,
    oldPoints: databaseResult.oldPoints,
    newPoints: databaseResult.newPoints,
    reason,
    oldGrade,
    newGrade,
  });

  const nextGrade = getNextGrade(
    databaseResult.newPoints
  );

  const embed = new EmbedBuilder()
    .setColor(
      action === "add" ? 0x2ecc71 : 0xe74c3c
    )
    .setTitle(
      action === "add"
        ? "✅ Points ajoutés"
        : "➖ Points retirés"
    )
    .setThumbnail(
      member.user.displayAvatarURL({
        size: 256,
      })
    )
    .addFields(
      {
        name: "👤 Policier",
        value: `${member}`,
        inline: true,
      },
      {
        name:
          action === "add"
            ? "➕ Ajout"
            : "➖ Retrait",
        value: `${databaseResult.amount} point(s)`,
        inline: true,
      },
      {
        name: "⭐ Nouveau total",
        value: `${databaseResult.newPoints}`,
        inline: true,
      },
      {
        name: "🎖️ Grade actuel",
        value: newGrade.name,
        inline: true,
      },
      {
        name: "👮 Responsable",
        value: `${interaction.user}`,
        inline: true,
      },
      {
        name: "📝 Raison",
        value: reason,
        inline: false,
      }
    )
    .setFooter({
      text: nextGrade
        ? `${nextGrade.points - databaseResult.newPoints} point(s) avant ${nextGrade.name}`
        : "Grade maximum atteint",
    })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    allowedMentions: {
      parse: [],
    },
  });
}

/*
|--------------------------------------------------------------------------
| Création du bot
|--------------------------------------------------------------------------
*/

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

/*
|--------------------------------------------------------------------------
| Connexion du bot
|--------------------------------------------------------------------------
*/

client.once(Events.ClientReady, async () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  console.log("✅ Base Neon PostgreSQL connectée.");
  console.log("✅ Promotions automatiques actives.");
  console.log("✅ Rétrogradations automatiques actives.");
  console.log("✅ Logs automatiques actifs.");
  console.log(`📊 Policiers enregistrés : ${await countOfficers()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    await ensureAttendancePanel(client);
    console.log("✅ Panneau de présence actif.");
  } catch (error) {
    console.error("❌ Panneau de présence non initialisé :", error?.message || error);
  }

  setInterval(() => {
    void refreshAttendancePanel(client);
  }, 60000).unref?.();

  for (const guild of client.guilds.cache.values()) {
    try {
      await verifyConfiguredRoles(guild);
      console.log(
        `✅ Configuration des rôles correcte : ${guild.name}`
      );
    } catch (error) {
      console.error(
        `❌ Configuration incorrecte dans ${guild.name} :`,
        error.message
      );
    }
  }
});

/*
|--------------------------------------------------------------------------
| Commandes Discord
|--------------------------------------------------------------------------
*/

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    try {
      const handled = await handleAttendanceButton(interaction, client);
      if (handled) return;
    } catch (error) {
      console.error("❌ Erreur bouton de présence :", error);
      const payload = { content: "❌ Impossible de traiter la présence pour le moment.", ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
      return;
    }
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!interaction.guild) {
    await interaction.reply(
      privateReply(
        "❌ Cette commande doit être utilisée dans un serveur."
      )
    );

    return;
  }

  try {
    /*
    |--------------------------------------------------------------------------
    | /addpoints
    |--------------------------------------------------------------------------
    */

    if (interaction.commandName === "addpoints") {
      await modifyPoints({
        interaction,
        action: "add",
      });

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | /removepoints
    |--------------------------------------------------------------------------
    */

    if (interaction.commandName === "removepoints") {
      await modifyPoints({
        interaction,
        action: "remove",
      });

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | /points
    |--------------------------------------------------------------------------
    */

    if (interaction.commandName === "points") {
      const user =
        interaction.options.getUser("membre") ||
        interaction.user;

      const officer = await getOfficer(user.id);
      const currentGrade = getGradeFromPoints(
        Number(officer.points)
      );

      const nextGrade = getNextGrade(
        Number(officer.points)
      );

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("📊 PROFIL DU POLICIER")
        .setThumbnail(
          user.displayAvatarURL({
            size: 256,
          })
        )
        .addFields(
          {
            name: "👤 Policier",
            value: `${user}`,
            inline: true,
          },
          {
            name: "⭐ Points",
            value: `${officer.points}`,
            inline: true,
          },
          {
            name: "🎖️ Grade",
            value: currentGrade.name,
            inline: true,
          },
          {
            name: "📈 Prochain grade",
            value: nextGrade
              ? nextGrade.name
              : "Grade maximum",
            inline: true,
          },
          {
            name: "🎯 Points nécessaires",
            value: nextGrade
              ? `${nextGrade.points - officer.points}`
              : "0",
            inline: true,
          }
        )
        .setFooter({
          text: "HMPD • Police Points System",
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        allowedMentions: {
          parse: [],
        },
      });

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | /classement
    |--------------------------------------------------------------------------
    */

    if (interaction.commandName === "classement") {
      const limit =
        interaction.options.getInteger("limite") || 10;

      const ranking = await getLeaderboard(limit);

      if (ranking.length === 0) {
        await interaction.reply(
          privateReply(
            "📊 Aucun policier n'est encore enregistré."
          )
        );

        return;
      }

      const medals = ["🥇", "🥈", "🥉"];

      const lines = ranking.map(
        (officer, index) => {
          const position =
            medals[index] || `**${index + 1}.**`;

          return [
            `${position} <@${officer.user_id}>`,
            `⭐ **${officer.points} points**`,
            `🎖️ ${officer.grade}`,
          ].join(" — ");
        }
      );

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("🏆 CLASSEMENT HMPD")
        .setDescription(lines.join("\n\n"))
        .setFooter({
          text: `${await countOfficers()} policier(s) enregistré(s)`,
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        allowedMentions: {
          parse: [],
        },
      });

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | /historique
    |--------------------------------------------------------------------------
    */

    if (interaction.commandName === "historique") {
      if (!isHighCommand(interaction)) {
        await interaction.reply(
          privateReply(
            "❌ Cette commande est réservée au High Command."
          )
        );

        return;
      }

      const user = interaction.options.getUser(
        "membre",
        true
      );

      const limit =
        interaction.options.getInteger("limite") || 10;

      const history = await getOfficerHistory(
        user.id,
        limit
      );

      if (history.length === 0) {
        await interaction.reply(
          privateReply(
            `📜 Aucun historique trouvé pour ${user}.`
          )
        );

        return;
      }

      const lines = history.map((entry, index) => {
        const symbol =
          entry.action === "add" ? "➕" : "➖";

        const actionName =
          entry.action === "add" ? "Ajout" : "Retrait";

        const dateTimestamp = Math.floor(
          new Date(
            `${entry.created_at} UTC`
          ).getTime() / 1000
        );

        return [
          `**${index + 1}. ${symbol} ${actionName} de ${entry.amount} point(s)**`,
          `⭐ ${entry.old_points} ➜ ${entry.new_points}`,
          `📝 ${entry.reason}`,
          `👮 <@${entry.moderator_id}>`,
          Number.isFinite(dateTimestamp)
            ? `📅 <t:${dateTimestamp}:f>`
            : `📅 ${entry.created_at}`,
        ].join("\n");
      });

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("📜 HISTORIQUE DES POINTS")
        .setThumbnail(
          user.displayAvatarURL({
            size: 256,
          })
        )
        .setDescription(
          [`👤 **Policier :** ${user}`, "", ...lines].join(
            "\n\n"
          )
        )
        .setFooter({
          text: `HMPD • ${history.length} action(s) affichée(s)`,
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: {
          parse: [],
        },
      });

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | /presencepanel
    |--------------------------------------------------------------------------
    */

    if (interaction.commandName === "presencepanel") {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  if (!isHighCommand(interaction)) {
    await interaction.editReply(
      "❌ Cette commande est réservée au High Command."
    );
    return;
  }

  try {
    const panel = await ensureAttendancePanel(
      client,
      false
    );

    if (!panel) {
      await interaction.editReply(
        "❌ Le salon de présence n'est pas configuré."
      );
      return;
    }

    await interaction.editReply(
      "✅ Le panneau de présence a été créé ou actualisé."
    );
  } catch (error) {
    console.error(
      "❌ Création du panneau impossible :",
      error?.message || error
    );

    await interaction.editReply(
      "❌ Impossible de créer le panneau. Vérifie l'ID du salon et les permissions du bot."
    );
  }

  return;
}

    /*
    |--------------------------------------------------------------------------
    | /syncgrade
    |--------------------------------------------------------------------------
    */

    if (interaction.commandName === "syncgrade") {
      if (!isHighCommand(interaction)) {
        await interaction.reply(
          privateReply(
            "❌ Cette commande est réservée au High Command."
          )
        );

        return;
      }

      const user = interaction.options.getUser(
        "membre",
        true
      );

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      });

      const member =
        await interaction.guild.members.fetch(user.id);

      verifyMemberCanBeManaged(member);

      const officer = await getOfficer(user.id);

      const result = await synchronizeMemberGrade(
        member,
        Number(officer.points),
        false
      );

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("🔄 Grade synchronisé")
        .setDescription(
          [
            `👤 **Policier :** ${member}`,
            `⭐ **Points :** ${officer.points}`,
            `🎖️ **Rôle attribué :** ${result.newGrade.name}`,
            "",
            result.changed
              ? "✅ Le rôle Discord a été corrigé."
              : "✅ Le rôle Discord était déjà correct.",
          ].join("\n")
        )
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        allowedMentions: {
          parse: [],
        },
      });

      return;
    }
  } catch (error) {
    console.error(
      `❌ Erreur avec /${interaction.commandName} :`,
      error
    );

    let errorMessage =
      "❌ Une erreur est survenue pendant la commande.";

    if (error.message === "MEMBER_IS_OWNER") {
      errorMessage =
        "❌ Le bot ne peut pas modifier le propriétaire du serveur.";
    } else if (error.message === "MEMBER_IS_BOT") {
      errorMessage =
        "❌ Les points d'un bot ne peuvent pas être modifiés.";
    } else if (
      error.message === "MEMBER_NOT_MANAGEABLE"
    ) {
      errorMessage =
        "❌ Le rôle du bot doit être placé au-dessus des rôles du policier.";
    } else if (error.code === 50013) {
      errorMessage =
        "❌ Le bot n'a pas la permission de gérer ce rôle.";
    } else if (error.code === 10011) {
      errorMessage =
        "❌ Un identifiant de rôle dans le fichier .env est incorrect.";
    } else if (error.code === 10003) {
      errorMessage =
        "❌ Un identifiant de salon dans le fichier .env est incorrect.";
    }

    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({
          content: errorMessage,
          embeds: [],
        })
        .catch(() => {});
    } else {
      await interaction
        .reply(privateReply(errorMessage))
        .catch(() => {});
    }
  }
});

/*
|--------------------------------------------------------------------------
| Arrêt propre du bot
|--------------------------------------------------------------------------
*/

async function shutdownBot(signal) {
  console.log(`\n🛑 Arrêt reçu : ${signal}`);

  try {
    await closeDatabase();
    console.log("✅ Base Neon PostgreSQL fermée.");
  } catch (error) {
    console.error(
      "❌ Erreur pendant la fermeture PostgreSQL :",
      error
    );
  }

  client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdownBot("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdownBot("SIGTERM");
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Promesse rejetée :", error);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Erreur non capturée :", error);
});

/*
|--------------------------------------------------------------------------
| Connexion
|--------------------------------------------------------------------------
*/

client.login(TOKEN).catch((error) => {
  console.error("❌ Impossible de connecter le bot.");
  console.error("Vérifie le TOKEN dans le fichier .env.");
  console.error(error);

  closeDatabase().finally(() => process.exit(1));
});