const activeRequests = new Map();
const WINDOW_MS = Math.max(1000, Number.parseInt(process.env.ACTION_DEDUPE_MS, 10) || 3000);

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of activeRequests) {
    if (expiresAt <= now) activeRequests.delete(key);
  }
}, Math.max(5000, WINDOW_MS * 2));
cleanupTimer.unref?.();

function actionDedupe(request, response, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return next();

  const actor = String(request.session?.user?.id || request.ip || "anonymous");
  const explicitKey = String(request.get("Idempotency-Key") || "").trim().slice(0, 160);
  const body = JSON.stringify(request.body || {});
  const key = explicitKey
    ? `${actor}:${request.method}:${request.originalUrl}:key:${explicitKey}`
    : `${actor}:${request.method}:${request.originalUrl}:body:${body}`;
  const now = Date.now();

  const existing = activeRequests.get(key);
  if (existing && existing > now) {
    return response.status(409).json({
      success: false,
      message: "Cette action vient déjà d’être envoyée. Patiente une seconde avant de recommencer.",
    });
  }

  activeRequests.set(key, now + WINDOW_MS);
  next();
}

module.exports = { actionDedupe };
