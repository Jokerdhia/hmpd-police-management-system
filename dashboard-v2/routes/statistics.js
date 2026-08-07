const express = require("express");

const { getManagementSnapshot } = require("../services/managementService");

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
    const snapshot = await getManagementSnapshot();
    const officers = snapshot.officers || [];
    const weeklyWinner = [...officers]
      .filter((officer) => Number(officer.week_seconds || 0) >= 2 * 3600)
      .sort((a, b) => Number(b.score?.total || 0) - Number(a.score?.total || 0) || Number(b.week_seconds || 0) - Number(a.week_seconds || 0))[0] || null;

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

    const weeklyBestOfficer = weeklyWinner
      ? {
          ...weeklyWinner,
          weekly_points: Number(weeklyWinner.points || 0),
          performance_score: Number(weeklyWinner.score?.total || 0),
          weekly_seconds: Number(weeklyWinner.week_seconds || 0),
        }
      : null;

    const now = new Date();
    const day = now.getUTCDay() || 7;
    const monday = new Date(now); monday.setUTCDate(now.getUTCDate() - day + 1); monday.setUTCHours(0,0,0,0);
    const nextMonday = new Date(monday); nextMonday.setUTCDate(monday.getUTCDate()+7);
    return response.status(200).json({
      success: true,
      statistics: {
        officers: officers.length,
        totalPoints,
        averagePoints,
        weeklyBestOfficer,
        weeklyPeriod: {
          startsAt: monday.toISOString(),
          endsAt: nextMonday.toISOString(),
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
