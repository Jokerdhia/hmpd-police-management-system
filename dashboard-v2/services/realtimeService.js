const clients = new Set();

function addClient(response) {
  clients.add(response);
  return () => clients.delete(response);
}

function broadcast(type, payload = {}) {
  const event = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  for (const response of [...clients]) {
    if (response.destroyed || response.writableEnded) {
      clients.delete(response);
      continue;
    }
    try {
      response.write(`event: ${type}\n`);
      response.write(`data: ${event}\n\n`);
    } catch {
      clients.delete(response);
    }
  }
}

function clientCount() {
  return clients.size;
}

function closeAll() {
  for (const response of [...clients]) {
    try {
      response.write(`event: shutdown\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      response.end();
    } catch {}
    clients.delete(response);
  }
}

module.exports = { addClient, broadcast, clientCount, closeAll };
