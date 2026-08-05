const express = require("express");
const { addClient, clientCount } = require("../services/realtimeService");

const router = express.Router();

router.get("/events", (request, response) => {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();
  response.write(`event: ready\ndata: ${JSON.stringify({ success: true, clients: clientCount() + 1 })}\n\n`);

  const remove = addClient(response);
  const heartbeat = setInterval(() => {
    try { response.write(`: heartbeat ${Date.now()}\n\n`); } catch { clearInterval(heartbeat); remove(); }
  }, 25000);

  request.on("close", () => {
    clearInterval(heartbeat);
    remove();
  });
});

module.exports = router;
