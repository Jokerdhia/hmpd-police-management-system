const crypto = require("crypto");
const { REST, Routes } = require("discord.js");
const { getDiscordGradeFromRoles, getGradeIndex } = require("../config/grades");

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

// High Grade est le rôle administrateur principal du MDT.
// On accepte les deux variables pour compatibilité, ET le bot peut découvrir
// automatiquement le rôle nommé "High Grade" depuis Discord.
const CONFIGURED_HIGH_GRADE_ROLE_IDS = new Set(
  [
    process.env.ROLE_HIGH_GRADE,
    process.env.ROLE_HIGH_COMMAND,
    DEFAULT_HIGH_COMMAND_ROLE_ID,
  ]
    .flatMap((value) => String(value || "").split(","))
    .map((roleId) => roleId.trim())
    .filter(Boolean)
);

const detectedHighGradeRoleIds = new Set(CONFIGURED_HIGH_GRADE_ROLE_IDS);
let highGradeRolesRefreshedAt = 0;
const HIGH_GRADE_ROLE_CACHE_TTL_MS = Math.max(60000, Number(process.env.HIGH_GRADE_ROLE_CACHE_TTL_MS) || 300000);

function normalizeRoleName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isHighGradeRoleName(value) {
  const normalized = normalizeRoleName(value);
  return normalized === "highgrade" || normalized === "highcommand";
}

async function refreshHighGradeRoleIds(force = false) {
  if (!rest || !GUILD_ID) return;
  if (!force && Date.now() - highGradeRolesRefreshedAt < HIGH_GRADE_ROLE_CACHE_TTL_MS) return;

  try {
    const roles = await rest.get(Routes.guildRoles(GUILD_ID));
    if (Array.isArray(roles)) {
      for (const role of roles) {
        if (isHighGradeRoleName(role?.name) && role?.id) {
          detectedHighGradeRoleIds.add(String(role.id));
        }
      }
      highGradeRolesRefreshedAt = Date.now();
    }
  } catch (error) {
    // La détection automatique est un bonus : une panne Discord ne bloque pas
    // les IDs explicitement configurés.
    console.warn("⚠️ Détection automatique du rôle High Grade impossible :", error?.message || error);
  }
}

// Alias historique : certains modules parlent encore de High Command.
const ROLE_HIGH_COMMAND = String(process.env.ROLE_HIGH_COMMAND || "").trim();

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

// Cache court pour éviter un appel Discord à chaque requête HTTP.
const authMemberCache = new Map();
const AUTH_MEMBER_CACHE_TTL_MS = Math.max(
  10000,
  Number(process.env.AUTH_MEMBER_CACHE_TTL_MS) || 30000
);

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
 * Police + permissions par grade :
 * - accès au dashboard ;
 * - modification des points ;
 * - actions administratives protégées.
 *
 * High Grade sans Police :
 * - accès au MDT, mais aucune modification hiérarchique sans grade Police reconnu.
 */
function getPermissions(member) {
  const memberRoles = Array.isArray(member?.roles)
    ? member.roles.map((roleId) => String(roleId).trim())
    : [];

  const hasPoliceRole = POLICE_ROLE_IDS.some((policeRoleId) =>
    memberRoles.includes(policeRoleId)
  );

  // High Grade donne un bypass TOTAL du MDT, même sans rôle Police.
  const isHighGrade = memberRoles.some((roleId) =>
    detectedHighGradeRoleIds.has(roleId)
  );

  // Alias conservé pour le reste du projet (présence / anciennes routes).
  const isHighCommand = isHighGrade;
  const grade = getDiscordGradeFromRoles(memberRoles) || null;
  const gradeIndex = getGradeIndex(grade);
  const atLeast = (name) => gradeIndex >= 0 && gradeIndex >= getGradeIndex(name);
  const canEnterMdt = hasPoliceRole || isHighGrade;

  return {
    roles: memberRoles,
    grade,
    gradeIndex,
    isPolice: hasPoliceRole,
    hasPoliceRole,
    isHighGrade,
    isHighCommand,
    canView: canEnterMdt,
    canViewAllOfficers: isHighGrade || (hasPoliceRole && atLeast('Sergeant')),
    canEvaluate: isHighGrade || (hasPoliceRole && atLeast('Sergeant')),
    canSanction: isHighGrade || (hasPoliceRole && atLeast('Lieutenant')),
    canManagePoints: isHighGrade,
    canManagePromotions: isHighGrade || (hasPoliceRole && atLeast('Captain')),
    canApprovePromotions: isHighGrade || (hasPoliceRole && atLeast('Deputy Chief')),
    canViewCommandCenter: isHighGrade || (hasPoliceRole && atLeast('Lieutenant')),
    canFullAdmin: isHighGrade || (hasPoliceRole && grade === 'Chief Police'),
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
async function fetchMember(userId, force = false) {
  const normalizedUserId = normalizeDiscordId(userId);

  if (!rest || !normalizedUserId || !GUILD_ID) {
    console.error("❌ Impossible de récupérer le membre Discord : configuration invalide.");
    return null;
  }

  // Maintient la détection automatique de High Grade à jour.
  await refreshHighGradeRoleIds(false);

  const cached = authMemberCache.get(normalizedUserId);
  if (!force && cached && Date.now() - cached.time < AUTH_MEMBER_CACHE_TTL_MS) {
    return cached.member;
  }

  try {
    const member = await rest.get(
      Routes.guildMember(GUILD_ID, normalizedUserId)
    );

    authMemberCache.set(normalizedUserId, { time: Date.now(), member });
    return member;
  } catch (error) {
    const status = getDiscordErrorStatus(error);
    const code = getDiscordErrorCode(error);

    if (status === 404 || code === 10007) {
      authMemberCache.delete(normalizedUserId);
      return null;
    }

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

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
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
          !permissions.canView
        ) {
          console.warn(
            "⛔ Connexion refusée : aucun rôle Police / High Grade autorisé.",
            {
              userId: user.id,
              receivedRoles:
                permissions.roles,
              expectedPoliceRoles:
                POLICE_ROLE_IDS,
              expectedHighGradeRoles:
                Array.from(detectedHighGradeRoleIds),
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
              "Accès refusé : rôle Police ou High Grade requis."
            );
        }

        // Nouvelle session après authentification : réduit le risque de fixation de session.
        await regenerateSession(request);

        request.session.user = {
          id: String(user.id),

          username:
            user.global_name ||
            user.username ||
            "Utilisateur Discord",

          avatar: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : "https://cdn.discordapp.com/embed/avatars/0.png",

          isPolice: permissions.hasPoliceRole,

          isHighGrade: permissions.isHighGrade,
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
              grade: 'Chief Police',
              canViewAllOfficers: true,
              canEvaluate: true,
              canSanction: true,
              canManagePoints: true,
              canManagePromotions: true,
              canApprovePromotions: true,
              canViewCommandCenter: true,
              canFullAdmin: true,
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
          !permissions.canView
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
                "Tu ne possèdes plus le rôle Police ou High Grade.",
              loginUrl: "/login",
            });
        }

        sessionUser.isPolice =
          permissions.hasPoliceRole;

        sessionUser.isHighGrade =
          permissions.isHighGrade;

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
            canView: permissions.canView,
            isHighGrade: permissions.isHighGrade,
            isHighCommand: permissions.isHighCommand,
            grade: permissions.grade,
            canViewAllOfficers: permissions.canViewAllOfficers,
            canEvaluate: permissions.canEvaluate,
            canSanction: permissions.canSanction,
            canManagePoints: permissions.canManagePoints,
            canManagePromotions: permissions.canManagePromotions,
            canApprovePromotions: permissions.canApprovePromotions,
            canViewCommandCenter: permissions.canViewCommandCenter,
            canFullAdmin: permissions.canFullAdmin,
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
        sessionUser.id,
        ["POST","PUT","PATCH","DELETE"].includes(request.method)
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
      !permissions.canView
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
        "Tu ne possèdes pas le rôle Police ou High Grade."
      );
    }

    sessionUser.isPolice =
      permissions.hasPoliceRole;

    sessionUser.isHighGrade =
      permissions.isHighGrade;

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
        sessionUser.id,
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
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
      !permissions.isHighGrade
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
            "Le rôle High Grade est nécessaire pour cette action.",
        });
    }

    sessionUser.isPolice =
      permissions.hasPoliceRole;

    sessionUser.isHighGrade =
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

function requireCapability(capability, label = 'Permission insuffisante.') {
  return async function capabilityMiddleware(request, response, next) {
    if (!oauthEnabled && !isProduction) return next();
    const sessionUser = request.session?.user;
    if (!sessionUser?.id) return response.status(401).json({success:false,message:'Connexion Discord requise.',loginUrl:'/login'});
    try {
      const member = await fetchMember(sessionUser.id, ["POST","PUT","PATCH","DELETE"].includes(request.method));
      if (!member) return response.status(403).json({success:false,message:"Tu n'es plus membre du serveur HMPD."});
      const permissions = getPermissions(member);
      if (!permissions.canView) return response.status(403).json({success:false,message:'Le rôle Police ou High Grade est nécessaire.'});
      if (!permissions[capability]) return response.status(403).json({success:false,message:label});
      request.authPermissions = permissions;
      return next();
    } catch (error) {
      console.error(`❌ Erreur permission ${capability}:`, error);
      return response.status(503).json({success:false,message:'Discord est temporairement inaccessible.'});
    }
  };
}


/* =========================================================
   HIÉRARCHIE DES CIBLES
========================================================= */

async function getTargetHierarchyAccess(request, targetUserId) {
  const actorId = String(request?.session?.user?.id || '').trim();
  const normalizedTargetId = String(targetUserId || '').trim();
  const actorPermissions = request?.authPermissions || null;

  if (!actorPermissions) {
    const error = new Error('Permissions du responsable indisponibles.');
    error.status = 403;
    error.publicMessage = error.message;
    throw error;
  }

  const targetMember = await fetchMember(normalizedTargetId, ["POST","PUT","PATCH","DELETE"].includes(String(request?.method||"GET").toUpperCase()));
  if (!targetMember) {
    const error = new Error("Ce policier n'est plus présent sur le serveur Discord.");
    error.status = 404;
    error.publicMessage = error.message;
    throw error;
  }

  const targetPermissions = getPermissions(targetMember);
  const isMutation = ["POST","PUT","PATCH","DELETE"].includes(String(request?.method||"GET").toUpperCase());
  if (isMutation && !targetPermissions.hasPoliceRole) {
    const error = new Error("Ce membre n'a plus le rôle Police : aucune modification de dossier n'est autorisée.");
    error.status = 409;
    error.publicMessage = error.message;
    throw error;
  }
  const actorGrade = actorPermissions.grade || null;
  const targetGrade = targetPermissions.grade || null;
  const actorGradeIndex = Number(actorPermissions.gradeIndex ?? -1);
  const targetGradeIndex = Number(targetPermissions.gradeIndex ?? -1);
  const isSelf = actorId && actorId === normalizedTargetId;

  // Un grade est considéré supérieur uniquement s'il est réellement reconnu
  // dans la hiérarchie HMPD. À grade égal, l'action reste autorisée.
  const targetIsHigher = !isSelf && targetGradeIndex >= 0 && (
    actorGradeIndex < 0 || targetGradeIndex > actorGradeIndex
  );

  return {
    actorId,
    targetId: normalizedTargetId,
    actorGrade,
    targetGrade,
    actorGradeIndex,
    targetGradeIndex,
    isSelf,
    targetIsHigher,
    canModifyTarget: !isSelf && !targetIsHigher,
  };
}

function requireTargetNotHigher(paramName = 'userId') {
  return async function targetHierarchyMiddleware(request, response, next) {
    try {
      const targetUserId = String(request.params?.[paramName] || '').trim();
      const access = await getTargetHierarchyAccess(request, targetUserId);
      request.targetHierarchyAccess = access;

      if (!access.canModifyTarget) {
        const message = access.isSelf
          ? "Auto-modification interdite : tu ne peux pas modifier ton propre dossier. Un autre membre autorisé du High Grade / High Command doit effectuer cette action."
          : `Action interdite : ${access.targetGrade || 'ce grade'} est supérieur à ton grade ${access.actorGrade || 'non défini'}.`;
        return response.status(403).json({
          success: false,
          message,
          hierarchy: access,
        });
      }

      return next();
    } catch (error) {
      const status = Number(error?.status || 503);
      return response.status(status).json({
        success: false,
        message: error?.publicMessage || error?.message || 'Impossible de vérifier la hiérarchie Discord.',
      });
    }
  };
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
  requireCapability,
  getModeratorId,
  getPermissions,
  fetchMember,
  getTargetHierarchyAccess,
  requireTargetNotHigher,
};