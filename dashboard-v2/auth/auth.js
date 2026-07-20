const crypto = require("crypto");
const { REST, Routes } = require("discord.js");

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN;
const ROLE_HIGH_COMMAND = process.env.ROLE_HIGH_COMMAND;
const CALLBACK_URL =
  process.env.DISCORD_CALLBACK_URL || "http://localhost:3001/auth/discord/callback";

const oauthEnabled = Boolean(
  CLIENT_ID && CLIENT_SECRET && GUILD_ID && TOKEN && ROLE_HIGH_COMMAND
);

const rest = TOKEN ? new REST({ version: "10" }).setToken(TOKEN) : null;

function registerAuthRoutes(app) {
  app.get("/login", (request, response) => {
    if (!oauthEnabled) {
      response.redirect("/");
      return;
    }

    const state = crypto.randomBytes(24).toString("hex");
    request.session.oauthState = state;

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: CALLBACK_URL,
      scope: "identify",
      state,
      prompt: "none",
    });

    response.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get("/auth/discord/callback", async (request, response, next) => {
    try {
      if (!oauthEnabled) {
        response.redirect("/");
        return;
      }

      if (!request.query.code || request.query.state !== request.session.oauthState) {
        response.status(400).send("Connexion Discord invalide.");
        return;
      }

      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "authorization_code",
          code: request.query.code,
          redirect_uri: CALLBACK_URL,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(tokenData.error_description || "Échange OAuth impossible.");
      }

      const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const user = await userResponse.json();

      if (!userResponse.ok) {
        throw new Error("Profil Discord introuvable.");
      }

      const member = await rest
        .get(Routes.guildMember(GUILD_ID, user.id))
        .catch(() => null);

      if (!member) {
        response.status(403).send("Tu dois être membre du serveur HMPD.");
        return;
      }

      const allowed =
        Array.isArray(member.roles) && member.roles.includes(ROLE_HIGH_COMMAND);

      if (!allowed) {
        response.status(403).send("Accès réservé au High Command.");
        return;
      }

      request.session.user = {
        id: user.id,
        username: user.global_name || user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
          : "https://cdn.discordapp.com/embed/avatars/0.png",
      };

      delete request.session.oauthState;
      response.redirect("/");
    } catch (error) {
      next(error);
    }
  });

  app.post("/logout", (request, response) => {
    request.session.destroy(() => response.json({ success: true }));
  });

  app.get("/api/me", (request, response) => {
    response.json({
      success: true,
      oauthEnabled,
      authenticated: Boolean(request.session.user) || !oauthEnabled,
      user: request.session.user || {
        id: process.env.DASHBOARD_MODERATOR_ID || "LOCAL",
        username: "Administration locale",
        avatar: "https://cdn.discordapp.com/embed/avatars/0.png",
      },
    });
  });
}

function requireAuth(request, response, next) {
  if (!oauthEnabled || request.session.user) {
    next();
    return;
  }

  if (request.path.startsWith("/api/")) {
    response.status(401).json({
      success: false,
      message: "Connexion Discord requise.",
      loginUrl: "/login",
    });
    return;
  }

  response.redirect("/login");
}

function getModeratorId(request) {
  return request.session?.user?.id || process.env.DASHBOARD_MODERATOR_ID || "DASHBOARD";
}

module.exports = {
  oauthEnabled,
  registerAuthRoutes,
  requireAuth,
  getModeratorId,
};
