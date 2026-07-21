const express = require("express");

const {
  listOfficers,
} = require("../services/officerService");

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

    const gradeStatistics = officers.reduce(
      (statistics, officer) => {
        const grade = String(officer.grade || "Inconnu");
        statistics[grade] = (statistics[grade] || 0) + 1;
        return statistics;
      },
      {}
    );

    const highestOfficerRecord = officers.reduce(
      (highest, officer) => {
        if (!highest) {
          return officer;
        }

        return Number(officer.points) > Number(highest.points)
          ? officer
          : highest;
      },
      null
    );

    const highestOfficer = highestOfficerRecord;

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
