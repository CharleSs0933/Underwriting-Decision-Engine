import { createServer, get, type Server } from 'node:http';
import { shutdownServer } from '../../infrastructure/http/shutdown';

async function listen(server: Server) {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return `http://127.0.0.1:${address.port}`;
}

describe('HTTP shutdown', () => {
  it('drains an in-flight request before closing dependencies', async () => {
    let finishRequest: (() => void) | undefined;
    let arrived: (() => void) | undefined;
    let dependenciesClosed = false;
    const requestArrived = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const server = createServer((_req, res) => {
      finishRequest = () => {
        res.end('done');
      };
      arrived?.();
    });
    const url = await listen(server);
    const response = new Promise<string>((resolve, reject) => {
      get(url, { agent: false }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve(body);
        });
      }).on('error', reject);
    });
    await requestArrived;
    const closing = shutdownServer(
      server,
      async () => {
        dependenciesClosed = true;
      },
      1000,
    );
    expect(dependenciesClosed).toBe(false);
    finishRequest?.();
    expect(await response).toBe('done');
    await closing;
    expect(dependenciesClosed).toBe(true);
    expect(server.listening).toBe(false);
  });

  it('bounds shutdown when an HTTP request never finishes', async () => {
    let arrived: (() => void) | undefined;
    const requestArrived = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const server = createServer(() => {
      arrived?.();
    });
    const url = await listen(server);
    const disconnected = new Promise<void>((resolve) => {
      get(url, { agent: false }).on('error', () => {
        resolve();
      });
    });
    await requestArrived;
    await expect(shutdownServer(server, async () => {}, 20)).rejects.toThrow(
      'Shutdown deadline exceeded',
    );
    await disconnected;
    expect(server.listening).toBe(false);
  });

  it('bounds shutdown when dependency cleanup never finishes', async () => {
    const server = createServer();
    await listen(server);
    await expect(shutdownServer(server, () => new Promise(() => {}), 20)).rejects.toThrow(
      'Shutdown deadline exceeded',
    );
    expect(server.listening).toBe(false);
  });
});
