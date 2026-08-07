require("dotenv").config();

console.log("🚀 Démarrage de HMPD V6 sur Render...");
require("./dashboard-v2/config/validateConfig").logRuntimeConfig();

// Le dashboard ouvre déjà process.env.PORT.
process.env.DISABLE_HEALTH_SERVER = "true";

// Démarrage du bot Discord
require("./index.js");

// Démarrage du Dashboard
require("./dashboard-v2/server.js");
