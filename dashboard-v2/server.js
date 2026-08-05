require("dotenv").config({
  path: require("path").resolve(__dirname, "..", ".env"),
});

const path = require("path");
const express = require("express");
const session = require("express-session");
const sessionStore = require("./sessionStore");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const officersRoutes = require("./routes/officers");
const statisticsRoutes = require("./routes/statistics");
const dashboardRoutes = require("./routes/dashboard");
const extrasRoutes = require("./routes/extras");
const attendanceRoutes = require("./routes/attendance");

const {
  oauthEnabled,
  registerAuthRoutes,
  requireAuth,
} = require("./auth/auth");

const {
  startRoleSync,
  stopRoleSync,
} = require("./services/roleSyncService");

const {
  notFoundHandler,
  errorHandler,
} = require("./middlewares/errorHandler");

/* =========================================================
   APPLICATION
========================================================= */

const app = express();

const PORT =
  Number.parseInt(process.env.PORT, 10) ||
  Number.parseInt(process.env.DASHBOARD_PORT_V2, 10) ||
  3001;

const HOST = "0.0.0.0";

const isProduction =
  process.env.NODE_ENV === "production";

const SESSION_SECRET = String(
  process.env.SESSION_SECRET || ""
).trim();

/*
 * Ce nom doit être exactement identique dans auth/auth.js.
 */
const SESSION_COOKIE_NAME = String(
  process.env.SESSION_COOKIE_NAME || "hmpd.sid"
).trim();

/* =========================================================
   VALIDATION DE LA CONFIGURATION
========================================================= */

if (isProduction && !SESSION_SECRET) {
  console.error(
    "❌ SESSION_SECRET est obligatoire en production."
  );

  process.exit(1);
}

if (
  isProduction &&
  SESSION_SECRET.length < 32
) {
  console.error(
    "❌ SESSION_SECRET doit contenir au minimum 32 caractères."
  );

  process.exit(1);
}

/* =========================================================
   CONFIGURATION EXPRESS
========================================================= */

app.disable("x-powered-by");

/*
 * Render utilise un proxy HTTPS devant l'application.
 */
app.set("trust proxy", 1);

/* =========================================================
   SÉCURITÉ HTTP
========================================================= */

app.use(
  helmet({
    /*
     * Désactivé pour éviter de bloquer certains scripts,
     * images ou ressources du dashboard.
     */
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

/* =========================================================
   RATE LIMIT
========================================================= */

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 250,

  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    message:
      "Trop de requêtes. Réessaie dans quelques instants.",
  },

  /*
   * Évite certains avertissements derrière le proxy Render.
   */
  validate: {
    xForwardedForHeader: false,
  },
});

app.use(limiter);

/* =========================================================
   LECTURE DES REQUÊTES
========================================================= */

app.use(
  express.json({
    limit: "100kb",
    strict: true,
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "100kb",
  })
);

/* =========================================================
   SESSIONS
========================================================= */

app.use(
  session({
    store: sessionStore,

    name: SESSION_COOKIE_NAME,

    secret:
      SESSION_SECRET ||
      "HMPD-LOCAL-DEVELOPMENT-SESSION-SECRET-ONLY",

    resave: false,
    saveUninitialized: false,

    /*
     * Renouvelle la durée du cookie pendant l'utilisation.
     */
    rolling: true,

    cookie: {
      httpOnly: true,

      /*
       * HTTPS obligatoire en production.
       * Render fonctionne en HTTPS grâce à trust proxy.
       */
      secure: isProduction,

      sameSite: "lax",

      /*
       * Session valable pendant 8 heures.
       */
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

/* =========================================================
   DÉSACTIVATION DU CACHE
========================================================= */

/*
 * Ce middleware doit être placé avant les routes OAuth,
 * les réponses d'authentification et les routes protégées.
 */
app.use((request, response, next) => {
  const pathname = request.path || "/";
  const dynamicResponse =
    pathname === "/" ||
    pathname.startsWith("/api/") ||
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname.startsWith("/auth/");

  if (dynamicResponse) {
    response.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
  }

  next();
});


/* =========================================================
   ROUTES PUBLIQUES
========================================================= */

/*
 * Enregistre :
 * - /login
 * - /auth/discord/callback
 * - /logout
 * - /api/me
 *
 * Ces routes doivent être placées avant requireAuth.
 */
registerAuthRoutes(app);

/*
 * Route utilisée par Render pour vérifier que le service
 * est démarré.
 */
app.get(
  "/api/health",
  (request, response) => {
    return response.status(200).json({
      success: true,
      status: "online",
      dashboard: "HMPD Dashboard Pro",
      oauthEnabled,
      environment:
        isProduction
          ? "production"
          : "development",
      uptime: Math.floor(
        process.uptime()
      ),
      timestamp:
        new Date().toISOString(),
    });
  }
);

/* =========================================================
   ALIAS DU DASHBOARD
========================================================= */

/*
 * Anciennes adresses et liens courants.
 * La page principale reste protégée par requireAuth après
 * la redirection vers /.
 */
[
  "/dashboard",
  "/dashboard/",
  "/dashboard-v2",
  "/dashboard-v2/",
  "/index.html",
].forEach((dashboardPath) => {
  app.get(dashboardPath, (request, response) => {
    return response.redirect(302, "/");
  });
});

/* =========================================================
   AUTHENTIFICATION OBLIGATOIRE
========================================================= */

/*
 * Toutes les routes placées après ce middleware nécessitent
 * le rôle Police.
 *
 * requireAuth vérifie directement les rôles Discord.
 */
app.use(requireAuth);

/* =========================================================
   FICHIERS STATIQUES PROTÉGÉS
========================================================= */

const publicDirectory = path.resolve(
  __dirname,
  "public"
);

app.use(
  express.static(publicDirectory, {
    etag: true,
    lastModified: true,
    maxAge: "1h",

    setHeaders(response) {
      response.setHeader(
        "Cache-Control",
        "private, max-age=3600, must-revalidate"
      );
    },
  })
);

/* =========================================================
   PAGE PRINCIPALE
========================================================= */

app.get(
  "/",
  (request, response, next) => {
    const indexPath = path.resolve(
      __dirname,
      "views",
      "index.html"
    );

    response.sendFile(
      indexPath,
      (error) => {
        if (error) {
          next(error);
        }
      }
    );
  }
);

/* =========================================================
   ROUTES API PROTÉGÉES
========================================================= */

app.use(
  "/api/officers",
  officersRoutes
);

app.use(
  "/api/statistics",
  statisticsRoutes
);

app.use(
  "/api/dashboard",
  dashboardRoutes
);

app.use(
  "/api",
  extrasRoutes
);

app.use(
  "/api/attendance",
  attendanceRoutes
);

/* =========================================================
   ROUTES INTROUVABLES
========================================================= */

/*
 * Réponse JSON pour les routes API inconnues.
 */
app.use(
  "/api",
  notFoundHandler
);

/*
 * Réponse texte pour les autres pages inconnues.
 */
app.use(
  (request, response) => {
    return response
      .status(404)
      .send("Page introuvable.");
  }
);

/* =========================================================
   GESTIONNAIRE D'ERREURS
========================================================= */

app.use(errorHandler);

/* =========================================================
   DÉMARRAGE DU SERVEUR
========================================================= */

let server = null;

function startServer() {
  server = app.listen(
    PORT,
    HOST,
    () => {
      console.log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      );

      console.log(
        "✅ HMPD Dashboard Pro démarré"
      );

      console.log(
        `🌐 Host : ${HOST}`
      );

      console.log(
        `🌐 Port : ${PORT}`
      );

      console.log(
        `🍪 Cookie session : ${SESSION_COOKIE_NAME}`
      );

      console.log(
        `🔐 OAuth Discord : ${
          oauthEnabled
            ? "activé"
            : "désactivé"
        }`
      );

      console.log(
        `🏭 Environnement : ${
          isProduction
            ? "production"
            : "développement"
        }`
      );

      console.log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      );

      try {
        startRoleSync();

        console.log(
          "✅ Synchronisation des rôles démarrée."
        );
      } catch (error) {
        console.error(
          "❌ Impossible de démarrer la synchronisation des rôles :",
          error?.message || error
        );
      }
    }
  );

  server.on(
    "error",
    (error) => {
      if (
        error.code === "EADDRINUSE"
      ) {
        console.error(
          `❌ Le port ${PORT} est déjà utilisé.`
        );
      } else {
        console.error(
          "❌ Erreur du serveur HTTP :",
          error
        );
      }

      process.exit(1);
    }
  );
}

/* =========================================================
   ARRÊT PROPRE
========================================================= */

let shuttingDown = false;

function shutdown(signal) {
  /*
   * Empêche plusieurs arrêts simultanés.
   */
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `🛑 Signal ${signal} reçu, arrêt du dashboard...`
  );

  try {
    if (
      typeof stopRoleSync ===
      "function"
    ) {
      stopRoleSync();

      console.log(
        "✅ Synchronisation des rôles arrêtée."
      );
    }
  } catch (error) {
    console.error(
      "❌ Erreur pendant l'arrêt de la synchronisation :",
      error?.message || error
    );
  }

  if (!server) {
    process.exit(0);
    return;
  }

  server.close((error) => {
    if (error) {
      console.error(
        "❌ Erreur pendant l'arrêt du serveur :",
        error
      );

      process.exit(1);
      return;
    }

    console.log(
      "✅ Serveur arrêté proprement."
    );

    process.exit(0);
  });

  /*
   * Force l'arrêt si des connexions restent ouvertes.
   */
  setTimeout(() => {
    console.error(
      "⚠️ Arrêt forcé après expiration du délai."
    );

    process.exit(1);
  }, 10000).unref();
}

/* =========================================================
   ÉVÉNEMENTS NODE.JS
========================================================= */

process.on(
  "SIGTERM",
  () => {
    shutdown("SIGTERM");
  }
);

process.on(
  "SIGINT",
  () => {
    shutdown("SIGINT");
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "❌ Promesse rejetée non gérée :",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "❌ Exception non gérée :",
      error
    );

    shutdown(
      "uncaughtException"
    );
  }
);

/* =========================================================
   LANCEMENT
========================================================= */

startServer();

module.exports = app;