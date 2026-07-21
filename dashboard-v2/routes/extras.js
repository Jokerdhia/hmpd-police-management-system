const express = require("express");

const {
  listNotes,
  addNote,
  listSanctions,
  addSanction,
  listActivity,
} = require("../dashboardDatabase");

const {
  requireHighCommand,
  getModeratorId,
} = require("../auth/auth");

const router = express.Router();

function normalizeDiscordId(value, label = "Identifiant Discord") {
  const id = String(value || "").trim();

  if (!/^\d{16,22}$/.test(id)) {
    const error = new Error(`${label} invalide.`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return id;
}

function cleanText(value, min, max, label) {
  const text = String(value || "").trim();

  if (text.length < min || text.length > max) {
    const error = new Error(
      `${label} doit contenir entre ${min} et ${max} caractères.`
    );

    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return text;
}

function normalizeLimit(value, fallback = 50, maximum = 100) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function normalizeExpiration(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    const error = new Error("La date d'expiration est invalide.");
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return date.toISOString();
}

router.get("/activity", async (request, response, next) => {
  try {
    const limit = normalizeLimit(request.query.limit);
    const activity = await listActivity(limit);

    return response.status(200).json({
      success: true,
      total: activity.length,
      activity,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/officers/:userId/notes", async (request, response, next) => {
  try {
    const userId = normalizeDiscordId(
      request.params.userId,
      "Identifiant du policier"
    );

    const notes = await listNotes(userId);

    return response.status(200).json({
      success: true,
      total: notes.length,
      notes,
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/officers/:userId/notes",
  requireHighCommand,
  async (request, response, next) => {
    try {
      const userId = normalizeDiscordId(
        request.params.userId,
        "Identifiant du policier"
      );

      const content = cleanText(
        request.body?.content,
        3,
        1000,
        "La note"
      );

      const result = await addNote({
        userId,
        content,
        authorId: getModeratorId(request),
      });

      return response.status(201).json({
        success: true,
        message: "Note ajoutée.",
        result,
      });
    } catch (error) {
      error.status = error.status || 400;
      error.publicMessage = error.publicMessage || error.message;
      return next(error);
    }
  }
);

router.get("/officers/:userId/sanctions", async (request, response, next) => {
  try {
    const userId = normalizeDiscordId(
      request.params.userId,
      "Identifiant du policier"
    );

    const sanctions = await listSanctions(userId);

    return response.status(200).json({
      success: true,
      total: sanctions.length,
      sanctions,
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/officers/:userId/sanctions",
  requireHighCommand,
  async (request, response, next) => {
    try {
      const userId = normalizeDiscordId(
        request.params.userId,
        "Identifiant du policier"
      );

      const type = cleanText(
        request.body?.type,
        2,
        100,
        "Le type"
      );

      const reason = cleanText(
        request.body?.reason,
        3,
        1000,
        "La raison"
      );

      const expiresAt = normalizeExpiration(
        request.body?.expiresAt
      );

      const result = await addSanction({
        userId,
        type,
        reason,
        expiresAt,
        authorId: getModeratorId(request),
      });

      return response.status(201).json({
        success: true,
        message: "Sanction enregistrée.",
        result,
      });
    } catch (error) {
      error.status = error.status || 400;
      error.publicMessage = error.publicMessage || error.message;
      return next(error);
    }
  }
);

module.exports = router;
