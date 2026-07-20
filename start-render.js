require("dotenv").config();

console.log("🚀 Démarrage de HPMS sur Render...");

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