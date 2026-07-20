const express = require("express");
const {
  listNotes,
  addNote,
  listSanctions,
  addSanction,
  listActivity,
} = require("../dashboardDatabase");
const { getModeratorId } = require("../auth/auth");

const router = express.Router();

function cleanText(value, min, max, label) {
  const text = String(value || "").trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${label} doit contenir entre ${min} et ${max} caractères.`);
  }
  return text;
}

router.get("/activity", (request, response, next) => {
  try {
    const requested = Number(request.query.limit);
    const limit = Number.isInteger(requested)
      ? Math.min(Math.max(requested, 1), 100)
      : 50;

    response.json({
      success: true,
      activity: listActivity(limit),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/officers/:userId/notes", (request, response, next) => {
  try {
    response.json({
      success: true,
      notes: listNotes(request.params.userId),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/officers/:userId/notes", (request, response, next) => {
  try {
    const content = cleanText(request.body.content, 3, 1000, "La note");
    const result = addNote({
      userId: request.params.userId,
      content,
      authorId: getModeratorId(request),
    });

    response.status(201).json({
      success: true,
      message: "Note ajoutée.",
      result,
    });
  } catch (error) {
    error.status = 400;
    error.publicMessage = error.message;
    next(error);
  }
});

router.get("/officers/:userId/sanctions", (request, response, next) => {
  try {
    response.json({
      success: true,
      sanctions: listSanctions(request.params.userId),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/officers/:userId/sanctions", (request, response, next) => {
  try {
    const type = cleanText(request.body.type, 2, 100, "Le type");
    const reason = cleanText(request.body.reason, 3, 1000, "La raison");
    const expiresAt = request.body.expiresAt
      ? String(request.body.expiresAt)
      : null;

    const result = addSanction({
      userId: request.params.userId,
      type,
      reason,
      expiresAt,
      authorId: getModeratorId(request),
    });

    response.status(201).json({
      success: true,
      message: "Sanction enregistrée.",
      result,
    });
  } catch (error) {
    error.status = 400;
    error.publicMessage = error.message;
    next(error);
  }
});

module.exports = router;
