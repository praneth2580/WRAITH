import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Route = (req: IncomingMessage, res: ServerResponse, body: string) => void;

export interface TestServer {
  url: string;
  /** Requests per path. */
  hits: Map<string, number>;
  close(): Promise<void>;
}

/** A local HTTP server. A string route is served as HTML; a function route handles the request itself. */
export async function startServer(routes: Record<string, Route | string>): Promise<TestServer> {
  const hits = new Map<string, number>();
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      hits.set(path, (hits.get(path) ?? 0) + 1);
      const route = routes[path];
      if (route === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      } else if (typeof route === 'string') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(route);
      } else {
        route(req, res, body);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
