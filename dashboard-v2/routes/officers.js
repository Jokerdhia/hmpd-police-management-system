const express = require("express");

const {
  listOfficers,
  getOfficerProfile,
  getHistory,
  modifyOfficerPoints,
} = require("../services/officerService");

const {
  requireHighCommand,
  getModeratorId,
} = require("../auth/auth");

const { broadcast } = require("../services/realtimeService");
const { audit } = require("../services/managementService");

const router = express.Router();

function normalizeDiscordId(value) {
  const id = String(value || "").trim();

  if (!/^\d{16,22}$/.test(id)) {
    const error = new Error(
      "L'identifiant Discord du policier est invalide."
    );

    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return id;
}

function normalizeLimit(value, fallback = 25, maximum = 50) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

router.get("/", async (request, response, next) => {
  try {
    const officers = await listOfficers();

    return response.status(200).json({
      success: true,
      total: officers.length,
      officers,
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * Cette route doit rester avant /:userId afin que "history"
 * ne soit jamais interprété comme un identifiant utilisateur.
 */
router.get("/:userId/history", async (request, response, next) => {
  try {
    const userId = normalizeDiscordId(request.params.userId);
    const limit = normalizeLimit(request.query.limit);
    const history = await getHistory(userId, limit);

    return response.status(200).json({
      success: true,
      total: history.length,
      history,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:userId", async (request, response, next) => {
  try {
    const userId = normalizeDiscordId(request.params.userId);
    const officer = await getOfficerProfile(userId);

    return response.status(200).json({
      success: true,
      officer,
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/:userId/points",
  requireHighCommand,
  async (request, response, next) => {
    try {
      const userId = normalizeDiscordId(request.params.userId);
      const action = String(request.body?.action || "")
        .trim()
        .toLowerCase();
      const amount = Number(request.body?.amount);
      const reason = String(request.body?.reason || "").trim();

      const result = await modifyOfficerPoints({
        userId,
        action,
        amount,
        reason,
        moderatorId: getModeratorId(request),
      });

      broadcast("points-changed", { userId, action, amount });
      await audit({actorId:getModeratorId(request),action:`points.${action}`,targetId:userId,details:{amount,reason,newPoints:result?.result?.newPoints}}).catch(()=>{});

      return response.status(200).json({
        success: true,
        message:
          action === "add"
            ? "Points ajoutés avec succès."
            : "Points retirés avec succès.",
        ...result,
      });
    } catch (error) {
      error.status = error.status || 400;
      error.publicMessage = error.publicMessage || error.message;
      return next(error);
    }
  }
);

module.exports = router;
