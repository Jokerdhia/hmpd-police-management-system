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
const realtimeRoutes = require("./routes/realtime");
const managementRoutes = require("./routes/management");
const promotionRoutes = require("./routes/promotions");
const { actionDedupe } = require("./middlewares/idempotency");
const { clientCount, closeAll: closeRealtimeClients } = require("./services/realtimeService");
const { pool, ready: databaseReady, closeDatabase } = require("../database");
const { startWeeklyReport, stopWeeklyReport } = require("./services/weeklyReportService");

// Render ne doit recevoir un statut 200 qu'une fois l'initialisation PostgreSQL
// terminée au moins une fois. Une panne DB ultérieure reste diagnostiquée via
// /api/health sans transformer le liveness check en source de 502.
const bootReadiness = { databaseReady: false, databaseError: null };
databaseReady
  .then(() => { bootReadiness.databaseReady = true; })
  .catch((error) => {
    bootReadiness.databaseError = error;
    console.error("❌ Initialisation PostgreSQL impossible :", error?.message || error);
  });

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

// V7 : le rate-limit concerne l'API, pas les fichiers CSS/JS/images.
app.use("/api", limiter);

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success:false, message:"Trop de tentatives de connexion. Réessaie dans quelques minutes." },
  validate: { xForwardedForHeader:false },
});
app.use("/auth", authLimiter);
app.use("/login", authLimiter);

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
 * Health checks Render.
 *
 * /healthz = liveness très légère : Render doit uniquement vérifier que le
 * processus HTTP répond. Une panne/latence Neon temporaire ne doit surtout
 * pas faire retirer une instance saine du load-balancer et provoquer un 502.
 *
 * /api/health = diagnostic complet (inclut PostgreSQL) pour l'administration.
 */
app.get("/healthz", (request, response) => {
  const readyForTraffic = bootReadiness.databaseReady;
  return response.status(readyForTraffic ? 200 : 503).json({
    success: readyForTraffic,
    status: readyForTraffic ? "online" : "starting",
    service: "hmpd-dashboard",
    version: "7.2.2",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get(
  "/api/health",
  async (request, response) => {
    const startedAt = Date.now();
    let database = "online";
    let databaseLatencyMs = null;

    try {
      await databaseReady;
      const dbStarted = Date.now();
      await pool.query("SELECT 1");
      databaseLatencyMs = Date.now() - dbStarted;
    } catch (error) {
      database = "offline";
      console.error("❌ Health-check PostgreSQL :", error?.message || error);
    }

    const healthy = database === "online";
    return response.status(healthy ? 200 : 503).json({
      success: healthy,
      status: healthy ? "online" : "degraded",
      version: "7.2.2",
      dashboard: "HMPD V7 Command Center",
      oauthEnabled,
      database,
      databaseLatencyMs,
      realtimeClients: clientCount(),
      environment: isProduction ? "production" : "development",
      uptime: Math.floor(process.uptime()),
      responseMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
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

/* Bloque les doubles soumissions accidentelles sur les actions POST. */
app.use("/api", actionDedupe);

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

app.use(
  "/api/realtime",
  realtimeRoutes
);

app.use("/api/management", managementRoutes);
app.use("/api/promotions", promotionRoutes);

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

      databaseReady
        .then(() => {
          startRoleSync();
          startWeeklyReport();
          console.log("✅ Synchronisation des rôles démarrée.");
        })
        .catch((error) => {
          console.error(
            "❌ Services automatiques non démarrés : PostgreSQL indisponible :",
            error?.message || error
          );
        });
    }
  );

  // Réglages recommandés derrière le proxy Render. Ils évitent les sockets
  // trop anciennes et laissent une marge correcte au proxy pendant un deploy.
  server.keepAliveTimeout = 65 * 1000;
  server.headersTimeout = 70 * 1000;
  server.requestTimeout = 60 * 1000;
  server.timeout = 0;

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
    if (typeof stopRoleSync === "function") {
      stopRoleSync();
    }
    if (typeof stopWeeklyReport === "function") {
      stopWeeklyReport();
    }
    console.log("✅ Services automatiques arrêtés.");
  } catch (error) {
    console.error(
      "❌ Erreur pendant l'arrêt de la synchronisation :",
      error?.message || error
    );
  }

  try {
    closeRealtimeClients();
  } catch (error) {
    console.error("❌ Fermeture SSE :", error?.message || error);
  }

  if (!server) {
    closeDatabase().catch(() => {}).finally(() => process.exit(0));
    return;
  }

  server.close(async (error) => {
    if (error) {
      console.error(
        "❌ Erreur pendant l'arrêt du serveur :",
        error
      );

      process.exit(1);
      return;
    }

    try {
      await closeDatabase();
    } catch (databaseError) {
      console.error("❌ Fermeture PostgreSQL :", databaseError?.message || databaseError);
    }

    console.log(
      "✅ Serveur arrêté proprement."
    );

    process.exit(0);
  });

  // Node 20+ : ferme immédiatement les sockets HTTP déjà inactifs.
  server.closeIdleConnections?.();

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
