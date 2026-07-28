require("dotenv").config();

console.log("🚀 Démarrage de HPMS sur Render...");

// Le dashboard ouvre déjà process.env.PORT.
process.env.DISABLE_HEALTH_SERVER = "true";

// Démarrage du bot Discord
require("./index.js");

// Démarrage du Dashboard
require("./dashboard-v2/server.js");

process.on("uncaughtException", (error) => {
  console.error("❌ Erreur non gérée :", error);
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Promesse rejetée :", error);
});