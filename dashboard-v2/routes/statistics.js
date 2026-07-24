const express = require("express");

const {
  listOfficers,
} = require("../services/officerService");

const {
  getDisplayGradeOrder,
  normalizeGradeName,
} = require("../config/grades");

const router = express.Router();

router.get("/", async (request, response, next) => {
  try {
    const officers = await listOfficers();

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

    const highestOfficer = officers.reduce(
      (highest, officer) => {
        if (!highest) return officer;
        return Number(officer.points) > Number(highest.points)
          ? officer
          : highest;
      },
      null
    );

    return response.status(200).json({
      success: true,
      statistics: {
        officers: officers.length,
        totalPoints,
        averagePoints,
        highestOfficer,
        gradeStatistics,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
