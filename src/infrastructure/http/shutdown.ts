import type { Server } from 'node:http';

export async function shutdownServer(
  server: Server,
  closeDependencies: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        }
        await closeDependencies();
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          server.closeAllConnections();
          reject(new Error('Shutdown deadline exceeded'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
