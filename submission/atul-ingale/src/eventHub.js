const { WebSocketServer, OPEN } = require('ws');

let broadcaster;

exports.init = (server) => {
  if (broadcaster) return broadcaster;

  broadcaster = new WebSocketServer({ server });

  broadcaster.on('connection', (socket) => {
    socket.on('error', () => {});
  });

  return broadcaster;
};

exports.emitUserCreated = (user) => {
  if (!broadcaster) return;

  const message = JSON.stringify({ event: 'UserCreatedEvent', data: user });

  broadcaster.clients.forEach((client) => {
    if (client.readyState === OPEN) {
      client.send(message);
    }
  });
};
