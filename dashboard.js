require("dotenv").config();

const path = require("path");
const express = require("express");

const {
  REST,
  Routes,
} = require("discord.js");

const {
  getAllOfficers,
  getOfficer,
  getOfficerHistory,
  getLeaderboard,
  countOfficers,
  changeOfficerPoints,
} = require("./database");

/*
|--------------------------------------------------------------------------
| Variables d’environnement
|--------------------------------------------------------------------------
*/

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const PORT =
  Number(process.env.DASHBOARD_PORT) || 3000;

const HOST = "127.0.0.1";

if (!TOKEN) {
  console.error(
    "❌ TOKEN absent du fichier .env."
  );

  process.exit(1);
}

if (!GUILD_ID) {
  console.error(
    "❌ GUILD_ID absent du fichier .env."
  );

  process.exit(1);
}

/*
|--------------------------------------------------------------------------
| Express
|--------------------------------------------------------------------------
*/

const app = express();

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/*
|--------------------------------------------------------------------------
| Client REST Discord
|--------------------------------------------------------------------------
*/

const discordRest = new REST({
  version: "10",
}).setToken(TOKEN);

/*
|--------------------------------------------------------------------------
| Cache des membres Discord
|--------------------------------------------------------------------------
|
| Le cache évite de demander les mêmes informations à Discord à chaque
| actualisation du Dashboard.
|
*/

const memberCache = new Map();

const MEMBER_CACHE_DURATION =
  5 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| Création de l’URL de l’avatar
|--------------------------------------------------------------------------
*/

function getDefaultAvatarUrl(userId) {
  try {
    const index =
      Number((BigInt(userId) >> 22n) % 6n);

    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  } catch {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

function getDiscordAvatarUrl(member) {
  const user = member?.user;

  if (!user) {
    return getDefaultAvatarUrl("0");
  }

  /*
  | Avatar spécifique au serveur
  */

  if (member.avatar) {
    const extension =
      member.avatar.startsWith("a_")
        ? "gif"
        : "png";

    return (
      `https://cdn.discordapp.com/guilds/` +
      `${GUILD_ID}/users/${user.id}/avatars/` +
      `${member.avatar}.${extension}?size=128`
    );
  }

  /*
  | Avatar du compte Discord
  */

  if (user.avatar) {
    const extension =
      user.avatar.startsWith("a_")
        ? "gif"
        : "png";

    return (
      `https://cdn.discordapp.com/avatars/` +
      `${user.id}/${user.avatar}.` +
      `${extension}?size=128`
    );
  }

  return getDefaultAvatarUrl(user.id);
}

/*
|--------------------------------------------------------------------------
| Récupérer un membre Discord
|--------------------------------------------------------------------------
*/

async function getDiscordMember(userId) {
  const cachedMember =
    memberCache.get(userId);

  if (
    cachedMember &&
    Date.now() - cachedMember.cachedAt <
      MEMBER_CACHE_DURATION
  ) {
    return cachedMember.data;
  }

  try {
    const member = await discordRest.get(
      Routes.guildMember(
        GUILD_ID,
        userId
      )
    );

    const username =
      member.user?.global_name ||
      member.nick ||
      member.user?.username ||
      userId;

    const displayName =
      member.nick ||
      member.user?.global_name ||
      member.user?.username ||
      userId;

    const data = {
      found: true,
      userId,
      username,
      displayName,
      discordUsername:
        member.user?.username || null,
      avatarUrl:
        getDiscordAvatarUrl(member),
      bot: Boolean(member.user?.bot),
      joinedAt:
        member.joined_at || null,
      roleIds:
        Array.isArray(member.roles)
          ? member.roles
          : [],
    };

    memberCache.set(userId, {
      cachedAt: Date.now(),
      data,
    });

    return data;
  } catch (error) {
    /*
    | Discord renvoie généralement 10007 si le membre
    | n’est plus présent dans le serveur.
    */

    console.warn(
      `⚠️ Membre Discord introuvable : ${userId}`
    );

    const data = {
      found: false,
      userId,
      username: "Membre inconnu",
      displayName: "Membre inconnu",
      discordUsername: null,
      avatarUrl:
        getDefaultAvatarUrl(userId),
      bot: false,
      joinedAt: null,
      roleIds: [],
    };

    memberCache.set(userId, {
      cachedAt: Date.now(),
      data,
    });

    return data;
  }
}

/*
|--------------------------------------------------------------------------
| Ajouter les informations Discord à un policier
|--------------------------------------------------------------------------
*/

async function enrichOfficer(officer) {
  const discordMember =
    await getDiscordMember(
      officer.user_id
    );

  return {
    ...officer,

    discord: discordMember,

    display_name:
      discordMember.displayName,

    username:
      discordMember.username,

    avatar_url:
      discordMember.avatarUrl,

    is_in_server:
      discordMember.found,

    joined_at:
      discordMember.joinedAt,
  };
}

async function enrichOfficers(officers) {
  /*
  | Traitement par groupes pour limiter le nombre
  | de requêtes envoyées simultanément à Discord.
  */

  const enrichedOfficers = [];
  const batchSize = 5;

  for (
    let index = 0;
    index < officers.length;
    index += batchSize
  ) {
    const batch = officers.slice(
      index,
      index + batchSize
    );

    const enrichedBatch =
      await Promise.all(
        batch.map(enrichOfficer)
      );

    enrichedOfficers.push(
      ...enrichedBatch
    );
  }

  return enrichedOfficers;
}

/*
|--------------------------------------------------------------------------
| Page principale
|--------------------------------------------------------------------------
*/

app.get("/", (request, response) => {
  response.sendFile(
    path.join(
      __dirname,
      "views",
      "index.html"
    )
  );
});

/*
|--------------------------------------------------------------------------
| API : tous les policiers
|--------------------------------------------------------------------------
*/

app.get(
  "/api/officers",
  async (request, response) => {
    try {
      const officers =
        getAllOfficers();

      const enrichedOfficers =
        await enrichOfficers(officers);

      response.json({
        success: true,
        total:
          enrichedOfficers.length,
        officers:
          enrichedOfficers,
      });
    } catch (error) {
      console.error(
        "❌ Erreur /api/officers :",
        error
      );

      response.status(500).json({
        success: false,
        message:
          "Impossible de récupérer les policiers.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| API : un policier
|--------------------------------------------------------------------------
*/

app.get(
  "/api/officers/:userId",
  async (request, response) => {
    try {
      const userId =
        request.params.userId;

      const officer =
        getOfficer(userId);

      const enrichedOfficer =
        await enrichOfficer(officer);

      response.json({
        success: true,
        officer:
          enrichedOfficer,
      });
    } catch (error) {
      console.error(
        "❌ Erreur pendant la récupération du policier :",
        error
      );

      response.status(500).json({
        success: false,
        message:
          "Impossible de récupérer le policier.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| API : historique
|--------------------------------------------------------------------------
*/

app.get(
  "/api/officers/:userId/history",
  (request, response) => {
    try {
      const userId =
        request.params.userId;

      const requestedLimit =
        Number(request.query.limit);

      const limit =
        Number.isInteger(
          requestedLimit
        )
          ? Math.min(
              Math.max(
                requestedLimit,
                1
              ),
              25
            )
          : 10;

      const history =
        getOfficerHistory(
          userId,
          limit
        );

      response.json({
        success: true,
        userId,
        total: history.length,
        history,
      });
    } catch (error) {
      console.error(
        "❌ Erreur historique :",
        error
      );

      response.status(500).json({
        success: false,
        message:
          "Impossible de récupérer l’historique.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| API : classement
|--------------------------------------------------------------------------
*/

app.get(
  "/api/leaderboard",
  async (request, response) => {
    try {
      const requestedLimit =
        Number(request.query.limit);

      const limit =
        Number.isInteger(
          requestedLimit
        )
          ? Math.min(
              Math.max(
                requestedLimit,
                1
              ),
              25
            )
          : 10;

      const leaderboard =
        getLeaderboard(limit);

      const enrichedLeaderboard =
        await enrichOfficers(
          leaderboard
        );

      response.json({
        success: true,
        total:
          enrichedLeaderboard.length,
        leaderboard:
          enrichedLeaderboard,
      });
    } catch (error) {
      console.error(
        "❌ Erreur classement :",
        error
      );

      response.status(500).json({
        success: false,
        message:
          "Impossible de récupérer le classement.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| API : statistiques
|--------------------------------------------------------------------------
*/

app.get(
  "/api/statistics",
  async (request, response) => {
    try {
      const officers =
        getAllOfficers();

      const totalPoints =
        officers.reduce(
          (total, officer) =>
            total +
            Number(officer.points),
          0
        );

      const averagePoints =
        officers.length > 0
          ? Math.round(
              totalPoints /
                officers.length
            )
          : 0;

      const highestOfficer =
        officers.length > 0
          ? await enrichOfficer(
              officers[0]
            )
          : null;

      const gradeStatistics =
        officers.reduce(
          (
            statistics,
            officer
          ) => {
            const grade =
              officer.grade ||
              "Unknown";

            statistics[grade] =
              (statistics[grade] ||
                0) + 1;

            return statistics;
          },
          {}
        );

      response.json({
        success: true,

        statistics: {
          officers:
            countOfficers(),

          totalPoints,
          averagePoints,
          highestOfficer,
          gradeStatistics,
        },
      });
    } catch (error) {
      console.error(
        "❌ Erreur statistiques :",
        error
      );

      response.status(500).json({
        success: false,
        message:
          "Impossible de récupérer les statistiques.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| API : vider le cache Discord
|--------------------------------------------------------------------------
*/

app.post(
  "/api/cache/clear",
  (request, response) => {
    memberCache.clear();

    response.json({
      success: true,
      message:
        "Cache Discord actualisé.",
    });
  }
);

/*
|--------------------------------------------------------------------------
| Vérification
|--------------------------------------------------------------------------
*/

app.get(
  "/api/health",
  (request, response) => {
    response.json({
      success: true,
      status: "online",
      dashboard:
        "HMPD Dashboard",
      discord:
        "REST API connected",
      timestamp:
        new Date().toISOString(),
    });
  }
);

/*
|--------------------------------------------------------------------------
| Route API inconnue
|--------------------------------------------------------------------------
*/

app.use(
  "/api",
  (request, response) => {
    response.status(404).json({
      success: false,
      message:
        "Route API introuvable.",
    });
  }
);

/*
|--------------------------------------------------------------------------
| Gestion des erreurs
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    request,
    response,
    next
  ) => {
    console.error(
      "❌ Erreur interne :",
      error
    );

    response.status(500).json({
      success: false,
      message:
        "Erreur interne du Dashboard.",
    });
  }
);

/*
|--------------------------------------------------------------------------
| Démarrage
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  HOST,
  () => {
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    console.log(
      "✅ Dashboard HMPD démarré."
    );

    console.log(
      `🌐 http://localhost:${PORT}`
    );

    console.log(
      "👤 Noms et avatars Discord activés."
    );

    console.log(
      "🔒 Accès local uniquement."
    );

    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
  }
);