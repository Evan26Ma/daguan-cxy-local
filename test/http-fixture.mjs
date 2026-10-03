import net from 'node:net';

// OS-assigned ports can include services forbidden by Node/Chromium HTTP clients.
export async function listenHttp(server) {
  for (;;) {
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => { server.off('error', onError); resolve(); });
    });
    if (server.address().port >= 12000) return;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

export async function unusedHttpPort() {
  const server = net.createServer();
  await listenHttp(server);
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
