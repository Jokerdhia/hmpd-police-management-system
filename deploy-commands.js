require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

/*
|--------------------------------------------------------------------------
| Vérifications
|--------------------------------------------------------------------------
*/

if (!TOKEN) {
  console.error("❌ TOKEN manquant dans le fichier .env.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID manquant dans le fichier .env.");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("❌ GUILD_ID manquant dans le fichier .env.");
  process.exit(1);
}

/*
|--------------------------------------------------------------------------
| Commandes slash
|--------------------------------------------------------------------------
*/

const commands = [
  new SlashCommandBuilder()
    .setName("addpoints")
    .setDescription("Ajouter des points à un policier")
    .addUserOption((option) =>
      option
        .setName("membre")
        .setDescription("Le policier concerné")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("points")
        .setDescription("Nombre de points à ajouter")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000)
    )
    .addStringOption((option) =>
      option
        .setName("raison")
        .setDescription("Raison de l'ajout des points")
        .setRequired(true)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName("removepoints")
    .setDescription("Retirer des points à un policier")
    .addUserOption((option) =>
      option
        .setName("membre")
        .setDescription("Le policier concerné")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("points")
        .setDescription("Nombre de points à retirer")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000)
    )
    .addStringOption((option) =>
      option
        .setName("raison")
        .setDescription("Raison du retrait des points")
        .setRequired(true)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName("points")
    .setDescription("Afficher les points d'un policier")
    .addUserOption((option) =>
      option
        .setName("membre")
        .setDescription(
          "Le policier concerné, sinon affiche tes propres points"
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("classement")
    .setDescription("Afficher le classement des policiers")
    .addIntegerOption((option) =>
      option
        .setName("limite")
        .setDescription("Nombre de policiers à afficher")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)
    ),

  new SlashCommandBuilder()
    .setName("historique")
    .setDescription("Afficher l'historique des points d'un policier")
    .addUserOption((option) =>
      option
        .setName("membre")
        .setDescription("Le policier concerné")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("limite")
        .setDescription("Nombre d'actions à afficher")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)
    ),

  new SlashCommandBuilder()
    .setName("syncgrade")
    .setDescription(
      "Synchroniser le rôle Discord avec les points d'un policier"
    )
    .addUserOption((option) =>
      option
        .setName("membre")
        .setDescription("Le policier concerné")
        .setRequired(true)
    ),
].map((command) => command.toJSON());

/*
|--------------------------------------------------------------------------
| Installation des commandes
|--------------------------------------------------------------------------
*/

const rest = new REST({
  version: "10",
}).setToken(TOKEN);

async function deployCommands() {
  try {
    console.log("⏳ Installation des commandes slash...");
    console.log(`📌 Serveur : ${GUILD_ID}`);
    console.log(`🤖 Application : ${CLIENT_ID}`);

    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands,
      }
    );

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ Commandes installées avec succès :");
    console.log("• /addpoints");
    console.log("• /removepoints");
    console.log("• /points");
    console.log("• /classement");
    console.log("• /historique");
    console.log("• /syncgrade");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } catch (error) {
    console.error("❌ Impossible d'installer les commandes.");

    if (error.code === 50001) {
      console.error(
        "Le bot ou l'application n'a pas accès au serveur."
      );
    } else if (error.code === 50013) {
      console.error(
        "Le bot n'a pas les permissions nécessaires."
      );
    } else if (error.code === 10002) {
      console.error(
        "CLIENT_ID incorrect : application inconnue."
      );
    } else if (error.code === 10004) {
      console.error(
        "GUILD_ID incorrect : serveur inconnu."
      );
    } else {
      console.error(error);
    }

    process.exit(1);
  }
}

deployCommands();