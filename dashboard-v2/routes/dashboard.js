const express = require("express");

const {
  getEnrichedLeaderboard,
} = require("../services/officerService");

const {
  clearMemberCache,
} = require("../services/discordService");

const {
  requireHighCommand,
} = require("../auth/auth");

const router = express.Router();

function normalizeLimit(value, fallback = 25, maximum = 50) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

router.get("/leaderboard", async (request, response, next) => {
  try {
    const limit = normalizeLimit(request.query.limit);
    const leaderboard = await getEnrichedLeaderboard(limit);

    return response.status(200).json({
      success: true,
      total: leaderboard.length,
      leaderboard,
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * Le nettoyage du cache Discord est une action administrative.
 * Il est donc réservé au High Command.
 */
router.post(
  "/cache/clear",
  requireHighCommand,
  (request, response, next) => {
    try {
      clearMemberCache();

      return response.status(200).json({
        success: true,
        message: "Cache Discord supprimé.",
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
