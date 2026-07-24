const express = require("express");

const { getWeeklyBestOfficer } = require("../dashboardDatabase");

const {
  listOfficers,
} = require("../services/officerService");

const {
  getDisplayGradeOrder,
  normalizeGradeName,
  getPublicGradeRequirements,
} = require("../config/grades");

const router = express.Router();

router.get("/", async (request, response, next) => {
  try {
    const [officers, weeklyWinner] = await Promise.all([
      listOfficers(),
      getWeeklyBestOfficer(),
    ]);

    const totalPoints = officers.reduce(
      (total, officer) => total + (Number(officer.points) || 0),
      0
    );

    const averagePoints = officers.length
      ? Math.round(totalPoints / officers.length)
      : 0;

    const rawGradeStatistics = officers.reduce(
      (statistics, officer) => {
        const grade = normalizeGradeName(officer.grade || "Inconnu");
        statistics[grade] = (statistics[grade] || 0) + 1;
        return statistics;
      },
      {}
    );

    // Garde toujours le même ordre dans le graphique, quel que soit
    // l'ordre dans lequel Discord ou la base renvoient les policiers.
    const gradeStatistics = {};
    for (const grade of getDisplayGradeOrder()) {
      if (rawGradeStatistics[grade] > 0) {
        gradeStatistics[grade] = rawGradeStatistics[grade];
      }
    }

    for (const [grade, count] of Object.entries(rawGradeStatistics)) {
      if (!(grade in gradeStatistics)) {
        gradeStatistics[grade] = count;
      }
    }

    const weeklyOfficer = weeklyWinner.user_id
      ? officers.find(
          (officer) => String(officer.user_id) === String(weeklyWinner.user_id)
        ) || null
      : null;

    const weeklyBestOfficer = weeklyOfficer
      ? {
          ...weeklyOfficer,
          weekly_points: weeklyWinner.weekly_points,
          points_added: weeklyWinner.points_added,
          points_removed: weeklyWinner.points_removed,
        }
      : null;

    return response.status(200).json({
      success: true,
      statistics: {
        officers: officers.length,
        totalPoints,
        averagePoints,
        weeklyBestOfficer,
        weeklyPeriod: {
          startsAt: weeklyWinner.starts_at,
          endsAt: weeklyWinner.ends_at,
        },
        gradeStatistics,
        gradeRequirements: getPublicGradeRequirements(),
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
