require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const officersRoutes = require("./routes/officers");
const statisticsRoutes = require("./routes/statistics");
const dashboardRoutes = require("./routes/dashboard");
const extrasRoutes = require("./routes/extras");
const {
  oauthEnabled,
  registerAuthRoutes,
  requireAuth,
} = require("./auth/auth");
const {
  notFoundHandler,
  errorHandler,
} = require("./middlewares/errorHandler");

const app = express();
const PORT = Number(
  process.env.PORT ||
  process.env.DASHBOARD_PORT_V2 ||
  3001
);

const HOST = "0.0.0.0";
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 250,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "CHANGE-ME-HMPD-LOCAL-SESSION-SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

registerAuthRoutes(app);

app.use(express.static(path.join(__dirname, "public")));
app.use(requireAuth);

app.get("/", (request, response) => {
  response.sendFile(path.join(__dirname, "views", "index.html"));
});

app.use("/api/officers", officersRoutes);
app.use("/api/statistics", statisticsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api", extrasRoutes);

app.get("/api/health", (request, response) => {
  response.json({
    success: true,
    status: "online",
    dashboard: "HMPD Dashboard Pro",
    oauthEnabled,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", notFoundHandler);
app.use(errorHandler);

app.listen(PORT, HOST, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ HPMS démarré");
  console.log(`🌐 Port : ${PORT}`);
  console.log(`🌐 Host : ${HOST}`);
  console.log("✅ Bot Discord et Dashboard actifs");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});