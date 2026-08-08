const express = require("express");
const {
  listNotes,
  countUnreadNotes,
  markNotesRead,
  addNote,
  listSanctions,
  addSanction,
  updateSanctionStatusForUser,
  deleteSanctionForUser,
  listActivity,
} = require("../dashboardDatabase");

const {
  requireHighCommand,
  requireCapability,
  requireTargetNotHigher,
  getModeratorId,
} = require("../auth/auth");

const { broadcast } = require("../services/realtimeService");
const { audit } = require("../services/managementService");
const { getDiscordMember } = require("../services/discordService");

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


function enforceProfileVisibility(request,userId){
  const permissions=request.authPermissions;
  if(permissions && !permissions.canViewAllOfficers && String(userId)!==String(getModeratorId(request))){
    const e=new Error('Tu peux consulter uniquement ton propre dossier.');e.status=403;e.publicMessage=e.message;throw e;
  }
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

router.get("/activity", requireHighCommand, async (request, response, next) => {
  try {
    const limit = normalizeLimit(request.query.limit);
    const activity = await listActivity(limit);

    // Résout les identifiants Discord en noms lisibles pour le journal.
    // Un échec Discord ne doit jamais bloquer complètement le journal.
    const ids = [...new Set(
      activity.flatMap((entry) => [entry.user_id, entry.moderator_id])
        .map((value) => String(value || "").trim())
        .filter((value) => /^\d{16,22}$/.test(value))
    )];

    const resolved = new Map();
    await Promise.all(ids.map(async (id) => {
      try {
        const member = await getDiscordMember(id);
        if (member?.found) {
          resolved.set(id, member.displayName || member.username || null);
        }
      } catch (_) {
        // Fallback côté client / base si Discord est momentanément indisponible.
      }
    }));

    const enrichedActivity = activity.map((entry) => ({
      ...entry,
      officer_name: resolved.get(String(entry.user_id || "")) || null,
      moderator_name: resolved.get(String(entry.moderator_id || "")) || null,
    }));

    return response.status(200).json({
      success: true,
      total: enrichedActivity.length,
      activity: enrichedActivity,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me/notes", async (request, response, next) => {
  try {
    const userId = normalizeDiscordId(
      getModeratorId(request),
      "Identifiant du policier connecté"
    );

    const [notes, unread] = await Promise.all([
      listNotes(userId),
      countUnreadNotes(userId),
    ]);

    return response.status(200).json({
      success: true,
      total: notes.length,
      unread,
      notes,
    });
  } catch (error) {
    return next(error);
  }
});


router.post("/me/notes/read", async (request, response, next) => {
  try {
    const userId = normalizeDiscordId(
      getModeratorId(request),
      "Identifiant du policier connecté"
    );

    const result = await markNotesRead(userId);

    return response.status(200).json({
      success: true,
      message: "Messages marqués comme lus.",
      unread: 0,
      result,
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
    enforceProfileVisibility(request,userId);

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
  requireTargetNotHigher('userId'),
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

      const moderatorId = getModeratorId(request);

      const result = await addNote({
        userId,
        content,
        authorId: moderatorId,
      });

      broadcast("note-changed", { userId });
      await audit({actorId:moderatorId,action:"note.add",targetId:userId,details:{content}}).catch(()=>{});

      return response.status(201).json({
        success: true,
        message: "Note ajoutée dans le MDT du policier.",
        deliveredInMdt: true,
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
    enforceProfileVisibility(request,userId);

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
  requireCapability('canSanction','Grade Lieutenant ou High Grade requis pour gérer les sanctions.'),
  requireTargetNotHigher('userId'),
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

      broadcast("sanction-changed", { userId });
      await audit({actorId:getModeratorId(request),action:"sanction.add",targetId:userId,details:{type,reason,expiresAt}}).catch(()=>{});

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

router.patch(
  "/officers/:userId/sanctions/:id",
  requireCapability('canSanction','Grade Lieutenant ou supérieur requis pour gérer les sanctions.'),
  requireTargetNotHigher('userId'),
  async (request, response, next) => {
    try {
      const userId = normalizeDiscordId(request.params.userId, "Identifiant du policier");
      const status = String(request.body?.status || "").trim().toLowerCase();
      const result = await updateSanctionStatusForUser(userId, request.params.id, status);
      if (!result.updated) {
        const error = new Error("Sanction introuvable."); error.status = 404; error.publicMessage = error.message; throw error;
      }
      broadcast("sanction-changed", { userId });
      await audit({actorId:getModeratorId(request),action:"sanction.status",targetId:userId,details:{sanctionId:request.params.id,status}}).catch(()=>{});
      return response.json({success:true,message:"Statut de la sanction mis à jour.",result});
    } catch (error) { error.publicMessage=error.publicMessage||error.message; return next(error); }
  }
);

router.delete(
  "/officers/:userId/sanctions/:id",
  requireCapability('canSanction','Grade Lieutenant ou supérieur requis pour gérer les sanctions.'),
  requireTargetNotHigher('userId'),
  async (request, response, next) => {
    try {
      const userId = normalizeDiscordId(request.params.userId, "Identifiant du policier");
      const result = await deleteSanctionForUser(userId, request.params.id);
      if (!result.deleted) {
        const error = new Error("Sanction introuvable."); error.status = 404; error.publicMessage = error.message; throw error;
      }
      broadcast("sanction-changed", { userId });
      await audit({actorId:getModeratorId(request),action:"sanction.delete",targetId:userId,details:{sanctionId:request.params.id}}).catch(()=>{});
      return response.json({success:true,message:"Sanction supprimée.",result});
    } catch (error) { error.publicMessage=error.publicMessage||error.message; return next(error); }
  }
);

module.exports = router;
