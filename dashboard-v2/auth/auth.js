const crypto = require("crypto");
const { REST, Routes } = require("discord.js");

/* =========================================================
   CONFIGURATION
========================================================= */

const CLIENT_ID = String(
  process.env.CLIENT_ID || ""
).trim();

const CLIENT_SECRET = String(
  process.env.CLIENT_SECRET || ""
).trim();

const GUILD_ID = String(
  process.env.GUILD_ID || ""
).trim();

const TOKEN = String(
  process.env.TOKEN || ""
).trim();

const CALLBACK_URL =
  String(
    process.env.DISCORD_CALLBACK_URL || ""
  ).trim() ||
  "http://localhost:3001/auth/discord/callback";

const SESSION_COOKIE_NAME = String(
  process.env.SESSION_COOKIE_NAME ||
    "hmpd.sid"
).trim();

/*
 * L'identifiant fourni ici sert uniquement de secours.
 * La variable Render ROLE_POLICE reste prioritaire.
 */
const DEFAULT_POLICE_ROLE_ID =
  "1528151508393398413";

const DEFAULT_HIGH_COMMAND_ROLE_ID =
  "1528151508426686594";

const POLICE_ROLE_IDS = String(
  process.env.ROLE_POLICE ||
    DEFAULT_POLICE_ROLE_ID
)
  .split(",")
  .map((roleId) => roleId.trim())
  .filter(Boolean);

const ROLE_HIGH_COMMAND = String(
  process.env.ROLE_HIGH_COMMAND ||
    DEFAULT_HIGH_COMMAND_ROLE_ID
).trim();

const isProduction =
  process.env.NODE_ENV === "production";

const oauthEnabled = Boolean(
  CLIENT_ID &&
    CLIENT_SECRET &&
    GUILD_ID &&
    TOKEN &&
    CALLBACK_URL &&
    POLICE_ROLE_IDS.length > 0
);

const rest = TOKEN
  ? new REST({
      version: "10",
    }).setToken(TOKEN)
  : null;

/* =========================================================
   OUTILS
========================================================= */

function normalizeDiscordId(value) {
  const id = String(value || "").trim();

  if (!/^\d{17,20}$/.test(id)) {
    return null;
  }

  return id;
}

function isApiRequest(request) {
  return Boolean(
    request.originalUrl?.startsWith("/api/")
  );
}

function getDiscordErrorStatus(error) {
  return Number(
    error?.status ||
      error?.rawError?.status ||
      error?.httpStatus ||
      0
  );
}

function getDiscordErrorCode(error) {
  return Number(
    error?.code ||
      error?.rawError?.code ||
      0
  );
}

/* =========================================================
   PERMISSIONS
========================================================= */

/**
 * Règles :
 *
 * Police :
 * - accès au dashboard ;
 * - consultation des policiers ;
 * - consultation du classement.
 *
 * Police + High Command :
 * - accès au dashboard ;
 * - modification des points ;
 * - actions administratives protégées.
 *
 * High Command sans Police :
 * - aucun accès.
 */
function getPermissions(member) {
  const memberRoles = Array.isArray(
    member?.roles
  )
    ? member.roles.map((roleId) =>
        String(roleId).trim()
      )
    : [];

  const hasPoliceRole =
    POLICE_ROLE_IDS.some((policeRoleId) =>
      memberRoles.includes(policeRoleId)
    );

  const isHighCommand = Boolean(
    ROLE_HIGH_COMMAND &&
      memberRoles.includes(
        ROLE_HIGH_COMMAND
      )
  );

  return {
    roles: memberRoles,

    isPolice: hasPoliceRole,
    hasPoliceRole,
    isHighCommand,

    canView: hasPoliceRole,

    canManagePoints:
      hasPoliceRole &&
      isHighCommand,
  };
}

/* =========================================================
   MEMBRE DISCORD
========================================================= */

/**
 * Récupère le membre directement depuis Discord avec
 * le token du bot.
 *
 * Retourne null uniquement lorsque le membre n'existe
 * réellement pas dans le serveur.
 *
 * Les autres erreurs Discord sont lancées afin de ne pas
 * supprimer injustement la session d'un policier.
 */
async function fetchMember(userId) {
  const normalizedUserId =
    normalizeDiscordId(userId);

  if (
    !rest ||
    !normalizedUserId ||
    !GUILD_ID
  ) {
    console.error(
      "❌ Impossible de récupérer le membre Discord : configuration invalide.",
      {
        restConfigured: Boolean(rest),
        userId: normalizedUserId,
        guildIdConfigured:
          Boolean(GUILD_ID),
      }
    );

    return null;
  }

  try {
    const member = await rest.get(
      Routes.guildMember(
        GUILD_ID,
        normalizedUserId
      )
    );

    const permissions =
      getPermissions(member);

    console.log(
      "━━━━━━━━ DEBUG PERMISSIONS DISCORD ━━━━━━━━"
    );

    console.log(
      "Utilisateur :",
      normalizedUserId
    );

    console.log(
      "Serveur :",
      GUILD_ID
    );

    console.log(
      "Rôles reçus :",
      permissions.roles
    );

    console.log(
      "Rôle Police attendu :",
      POLICE_ROLE_IDS
    );

    console.log(
      "Rôle High Command attendu :",
      ROLE_HIGH_COMMAND
    );

    console.log(
      "Possède Police :",
      permissions.hasPoliceRole
    );

    console.log(
      "Possède High Command :",
      permissions.isHighCommand
    );

    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    return member;
  } catch (error) {
    const status =
      getDiscordErrorStatus(error);

    const code =
      getDiscordErrorCode(error);

    /*
     * 10007 = Unknown Member
     * 404 = membre introuvable
     */
    if (
      status === 404 ||
      code === 10007
    ) {
      console.warn(
        `⚠️ Le membre Discord ${normalizedUserId} n'existe pas dans le serveur ${GUILD_ID}.`
      );

      return null;
    }

    console.error(
      `❌ Erreur Discord pendant la récupération du membre ${normalizedUserId} :`,
      {
        status,
        code,
        message:
          error?.message ||
          String(error),
      }
    );

    /*
     * Une panne Discord ou un problème temporaire ne doit
     * pas être interprété comme une absence de rôle.
     */
    throw error;
  }
}

/* =========================================================
   SESSION
========================================================= */

function destroySession(request) {
  return new Promise((resolve) => {
    if (!request.session) {
      resolve();
      return;
    }

    request.session.destroy(
      (error) => {
        if (error) {
          console.error(
            "❌ Impossible de détruire la session :",
            error
          );
        }

        resolve();
      }
    );
  });
}

function clearSessionCookie(response) {
  response.clearCookie(
    SESSION_COOKIE_NAME,
    {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
    }
  );
}

function saveSession(request) {
  return new Promise(
    (resolve, reject) => {
      request.session.save((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }
  );
}

/* =========================================================
   REFUS D'ACCÈS
========================================================= */

function deny(
  request,
  response,
  status,
  message
) {
  if (isApiRequest(request)) {
    return response
      .status(status)
      .json({
        success: false,
        authenticated: false,
        message,
        loginUrl: "/login",
      });
  }

  /*
   * Une personne non connectée est redirigée.
   * Une personne connectée mais sans rôle reçoit un message.
   */
  if (status === 401) {
    return response.redirect(
      "/login"
    );
  }

  return response
    .status(status)
    .send(`
      <!DOCTYPE html>

      <html lang="fr">
        <head>
          <meta charset="UTF-8">

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          >

          <title>Accès refusé</title>

          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #111827;
              color: #ffffff;
              font-family: Arial, sans-serif;
            }

            .card {
              width: min(90%, 520px);
              padding: 32px;
              border-radius: 16px;
              background: #1f2937;
              text-align: center;
              box-shadow:
                0 20px 50px
                rgba(0, 0, 0, 0.35);
            }

            a {
              display: inline-block;
              margin-top: 20px;
              padding: 12px 20px;
              border-radius: 8px;
              background: #5865f2;
              color: #ffffff;
              text-decoration: none;
              font-weight: bold;
            }
          </style>
        </head>

        <body>
          <main class="card">
            <h1>Accès refusé</h1>

            <p>
              ${message}
            </p>

            <a href="/login">
              Se reconnecter avec Discord
            </a>
          </main>
        </body>
      </html>
    `);
}

/* =========================================================
   ROUTES D'AUTHENTIFICATION
========================================================= */

function registerAuthRoutes(app) {
  /* -------------------------------------------------------
     CONNEXION
  ------------------------------------------------------- */

  app.get(
    "/login",
    async (request, response, next) => {
      try {
        if (!oauthEnabled) {
          if (isProduction) {
            return response
              .status(503)
              .send(
                "La connexion Discord est mal configurée."
              );
          }

          return response.redirect(
            "/"
          );
        }

        const state = crypto
          .randomBytes(32)
          .toString("hex");

        request.session.oauthState =
          state;

        await saveSession(request);

        const params =
          new URLSearchParams({
            client_id: CLIENT_ID,
            response_type: "code",
            redirect_uri:
              CALLBACK_URL,
            scope: "identify",
            state,

            /*
             * Permet de sélectionner clairement le compte
             * Discord, au lieu d'utiliser automatiquement
             * un ancien compte connecté.
             */
            prompt: "consent",
          });

        return response.redirect(
          `https://discord.com/oauth2/authorize?${params.toString()}`
        );
      } catch (error) {
        return next(error);
      }
    }
  );

  /* -------------------------------------------------------
     RETOUR DISCORD
  ------------------------------------------------------- */

  app.get(
    "/auth/discord/callback",
    async (request, response, next) => {
      try {
        if (!oauthEnabled) {
          return response
            .status(503)
            .send(
              "La connexion Discord est mal configurée."
            );
        }

        const code = String(
          request.query.code || ""
        ).trim();

        const receivedState =
          String(
            request.query.state || ""
          ).trim();

        const savedState = String(
          request.session
            ?.oauthState || ""
        ).trim();

        if (
          !code ||
          !receivedState ||
          !savedState ||
          receivedState !==
            savedState
        ) {
          return response
            .status(400)
            .send(
              "Connexion Discord invalide ou expirée."
            );
        }

        delete request.session
          .oauthState;

        const tokenResponse =
          await fetch(
            "https://discord.com/api/oauth2/token",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/x-www-form-urlencoded",
              },

              body:
                new URLSearchParams({
                  client_id:
                    CLIENT_ID,

                  client_secret:
                    CLIENT_SECRET,

                  grant_type:
                    "authorization_code",

                  code,

                  redirect_uri:
                    CALLBACK_URL,
                }),
            }
          );

        const tokenData =
          await tokenResponse
            .json()
            .catch(() => ({}));

        if (
          !tokenResponse.ok ||
          !tokenData.access_token
        ) {
          console.error(
            "❌ Erreur OAuth Discord :",
            tokenData
          );

          throw new Error(
            tokenData.error_description ||
              tokenData.error ||
              "Échange OAuth Discord impossible."
          );
        }

        const userResponse =
          await fetch(
            "https://discord.com/api/users/@me",
            {
              headers: {
                Authorization:
                  `Bearer ${tokenData.access_token}`,
              },
            }
          );

        const user =
          await userResponse
            .json()
            .catch(() => ({}));

        if (
          !userResponse.ok ||
          !user?.id
        ) {
          throw new Error(
            "Profil Discord introuvable."
          );
        }

        const member =
          await fetchMember(user.id);

        if (!member) {
          await destroySession(
            request
          );

          clearSessionCookie(
            response
          );

          return response
            .status(403)
            .send(
              "Tu dois être membre du serveur HMPD."
            );
        }

        const permissions =
          getPermissions(member);

        if (
          !permissions.hasPoliceRole
        ) {
          console.warn(
            "⛔ Connexion refusée : rôle Police absent.",
            {
              userId: user.id,
              receivedRoles:
                permissions.roles,
              expectedPoliceRoles:
                POLICE_ROLE_IDS,
            }
          );

          await destroySession(
            request
          );

          clearSessionCookie(
            response
          );

          return response
            .status(403)
            .send(
              "Accès refusé : tu dois posséder le rôle Police."
            );
        }

        request.session.user = {
          id: String(user.id),

          username:
            user.global_name ||
            user.username ||
            "Utilisateur Discord",

          avatar: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : "https://cdn.discordapp.com/embed/avatars/0.png",

          isPolice: true,

          isHighCommand:
            permissions.isHighCommand,
        };

        await saveSession(request);

        console.log(
          `✅ Connexion autorisée : ${request.session.user.username} (${user.id})`
        );

        return response.redirect(
          "/"
        );
      } catch (error) {
        return next(error);
      }
    }
  );

  /* -------------------------------------------------------
     DÉCONNEXION
  ------------------------------------------------------- */

  app.post(
    "/logout",
    async (request, response) => {
      await destroySession(
        request
      );

      clearSessionCookie(
        response
      );

      return response.json({
        success: true,
        message:
          "Déconnexion réussie.",
      });
    }
  );

  /*
   * Permet aussi une déconnexion par lien direct.
   */
  app.get(
    "/logout",
    async (request, response) => {
      await destroySession(
        request
      );

      clearSessionCookie(
        response
      );

      return response.redirect(
        "/login"
      );
    }
  );

  /* -------------------------------------------------------
     UTILISATEUR ACTUEL
  ------------------------------------------------------- */

  app.get(
    "/api/me",
    async (request, response, next) => {
      try {
        if (!oauthEnabled) {
          if (isProduction) {
            return response
              .status(503)
              .json({
                success: false,
                authenticated: false,
                oauthEnabled: false,
                message:
                  "La connexion Discord est mal configurée.",
              });
          }

          return response.json({
            success: true,
            oauthEnabled: false,
            authenticated: true,

            user: {
              id:
                process.env
                  .DASHBOARD_MODERATOR_ID ||
                "LOCAL",

              username:
                "Administration locale",

              avatar:
                "https://cdn.discordapp.com/embed/avatars/0.png",

              isPolice: true,
              isHighCommand: true,
            },

            permissions: {
              canView: true,
              canManagePoints: true,
            },
          });
        }

        const sessionUser =
          request.session?.user;

        if (!sessionUser?.id) {
          return response
            .status(401)
            .json({
              success: false,
              authenticated: false,
              message:
                "Connexion Discord requise.",
              loginUrl: "/login",
            });
        }

        const member =
          await fetchMember(
            sessionUser.id
          );

        if (!member) {
          await destroySession(
            request
          );

          clearSessionCookie(
            response
          );

          return response
            .status(403)
            .json({
              success: false,
              authenticated: false,
              message:
                "Tu n'es plus membre du serveur HMPD.",
              loginUrl: "/login",
            });
        }

        const permissions =
          getPermissions(member);

        if (
          !permissions.hasPoliceRole
        ) {
          await destroySession(
            request
          );

          clearSessionCookie(
            response
          );

          return response
            .status(403)
            .json({
              success: false,
              authenticated: false,
              message:
                "Tu ne possèdes plus le rôle Police.",
              loginUrl: "/login",
            });
        }

        sessionUser.isPolice =
          true;

        sessionUser.isHighCommand =
          permissions.isHighCommand;

        request.session.user =
          sessionUser;

        await saveSession(request);

        return response.json({
          success: true,
          oauthEnabled: true,
          authenticated: true,

          user: sessionUser,

          permissions: {
            canView: true,

            canManagePoints:
              permissions.canManagePoints,
          },
        });
      } catch (error) {
        return next(error);
      }
    }
  );
}

/* =========================================================
   MIDDLEWARE : POLICE
========================================================= */

async function requireAuth(
  request,
  response,
  next
) {
  if (!oauthEnabled) {
    if (isProduction) {
      return deny(
        request,
        response,
        503,
        "La connexion Discord est mal configurée."
      );
    }

    return next();
  }

  const sessionUser =
    request.session?.user;

  if (!sessionUser?.id) {
    return deny(
      request,
      response,
      401,
      "Connexion Discord requise."
    );
  }

  try {
    const member =
      await fetchMember(
        sessionUser.id
      );

    if (!member) {
      await destroySession(
        request
      );

      clearSessionCookie(
        response
      );

      return deny(
        request,
        response,
        403,
        "Tu dois être membre du serveur HMPD."
      );
    }

    const permissions =
      getPermissions(member);

    /*
     * Le rôle Police suffit pour entrer.
     * High Command n'est pas vérifié ici.
     */
    if (
      !permissions.hasPoliceRole
    ) {
      await destroySession(
        request
      );

      clearSessionCookie(
        response
      );

      return deny(
        request,
        response,
        403,
        "Tu ne possèdes pas le rôle Police."
      );
    }

    sessionUser.isPolice =
      true;

    sessionUser.isHighCommand =
      permissions.isHighCommand;

    request.session.user =
      sessionUser;

    request.authPermissions =
      permissions;

    return next();
  } catch (error) {
    console.error(
      "❌ Erreur requireAuth :",
      error
    );

    /*
     * Une erreur temporaire Discord ne doit pas supprimer
     * la session comme si le rôle Police avait disparu.
     */
    return response
      .status(503)
      .send(
        "Discord est temporairement inaccessible. Réessaie dans quelques instants."
      );
  }
}

/* =========================================================
   MIDDLEWARE : HIGH COMMAND
========================================================= */

async function requireHighCommand(
  request,
  response,
  next
) {
  if (!oauthEnabled) {
    if (isProduction) {
      return response
        .status(503)
        .json({
          success: false,
          message:
            "La connexion Discord est mal configurée.",
        });
    }

    return next();
  }

  const sessionUser =
    request.session?.user;

  if (!sessionUser?.id) {
    return response
      .status(401)
      .json({
        success: false,
        authenticated: false,
        message:
          "Connexion Discord requise.",
        loginUrl: "/login",
      });
  }

  try {
    const member =
      await fetchMember(
        sessionUser.id
      );

    if (!member) {
      await destroySession(
        request
      );

      clearSessionCookie(
        response
      );

      return response
        .status(403)
        .json({
          success: false,
          authenticated: false,
          message:
            "Tu n'es plus membre du serveur HMPD.",
          loginUrl: "/login",
        });
    }

    const permissions =
      getPermissions(member);

    if (
      !permissions.hasPoliceRole
    ) {
      await destroySession(
        request
      );

      clearSessionCookie(
        response
      );

      return response
        .status(403)
        .json({
          success: false,
          authenticated: false,
          message:
            "Tu dois posséder le rôle Police.",
          loginUrl: "/login",
        });
    }

    if (
      !permissions.isHighCommand
    ) {
      sessionUser.isPolice =
        true;

      sessionUser.isHighCommand =
        false;

      request.session.user =
        sessionUser;

      return response
        .status(403)
        .json({
          success: false,
          authenticated: true,
          message:
            "Le rôle High Command est nécessaire pour cette action.",
        });
    }

    sessionUser.isPolice =
      true;

    sessionUser.isHighCommand =
      true;

    request.session.user =
      sessionUser;

    request.authPermissions =
      permissions;

    return next();
  } catch (error) {
    console.error(
      "❌ Erreur requireHighCommand :",
      error
    );

    return response
      .status(503)
      .json({
        success: false,
        message:
          "Discord est temporairement inaccessible.",
      });
  }
}

/* =========================================================
   MODÉRATEUR
========================================================= */

function getModeratorId(request) {
  return (
    request.session?.user?.id ||
    process.env
      .DASHBOARD_MODERATOR_ID ||
    "DASHBOARD"
  );
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  oauthEnabled,
  registerAuthRoutes,
  requireAuth,
  requireHighCommand,
  getModeratorId,
  getPermissions,
  fetchMember,
};