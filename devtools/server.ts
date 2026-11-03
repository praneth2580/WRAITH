// A local UI for running wraith actions one at a time and seeing what each one did.
// Development only: it isn't part of the published package. Run: npm run devtools
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { WraithOptions } from '../src/index.js';
import { catalog } from './actions.js';
import { Session } from './session.js';

const port = Number(process.env.PORT ?? 4477);
// Pages open in the driven browser can reach localhost too; only this UI gets the token.
const token = randomBytes(16).toString('hex');
// Requests must name this machine, which stops other sites reaching the server by DNS rebinding.
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const publicDir = new URL('./public/', import.meta.url);
const files: Record<string, [file: string, type: string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

let session: Session | undefined;
let busy = false;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 2_000_000) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Request body is not JSON');
  }
}

/** Runs one browser operation at a time; the browser can't usefully do two. */
async function exclusive(res: ServerResponse, task: () => Promise<unknown>): Promise<void> {
  if (busy) return send(res, 409, { error: 'Something is still running. Wait for it, or close the browser.' });
  busy = true;
  try {
    send(res, 200, await task());
  } finally {
    busy = false;
  }
}

function requireSession(): Session {
  if (!session) throw new HttpError(409, 'No browser running. Launch one first.');
  return session;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 403, { error: 'Open the devtools at 127.0.0.1 or localhost' });
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  const file = files[url.pathname];
  if (req.method === 'GET' && file) {
    let content = await readFile(new URL(file[0], publicDir), 'utf8');
    if (file[0] === 'index.html') content = content.replace('%TOKEN%', token);
    res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' });
    res.end(content);
    return;
  }
  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (req.headers['x-devtools-token'] !== token) return send(res, 403, { error: 'Missing or stale token. Reload the page.' });

  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/catalog':
      return send(res, 200, catalog());
    case 'GET /api/state':
      return send(res, 200, { session: session?.options ?? null, busy, ...(session && !busy ? await session.view() : {}) });
    case 'POST /api/session':
      return exclusive(res, async () => {
        const { options } = await readJson(req);
        await session?.close().catch(() => {});
        session = undefined;
        session = await Session.start((options ?? {}) as WraithOptions);
        return { session: session.options, ...(await session.view()) };
      });
    case 'DELETE /api/session':
      return exclusive(res, async () => {
        await session?.close().catch(() => {});
        session = undefined;
        return { session: null };
      });
    case 'POST /api/run':
      return exclusive(res, async () => {
        let current = requireSession();
        const { action, args } = await readJson(req);
        // Closing the window of a visible browser closes the page; start again with the same settings.
        const relaunched = current.closed;
        if (relaunched) {
          await current.close().catch(() => {});
          session = undefined;
          session = current = await Session.start(current.options);
        }
        const report = await current.run(String(action), (args ?? {}) as Record<string, unknown>);
        return relaunched ? { ...report, relaunched } : report;
      });
    case 'GET /api/body':
      return send(res, 200, await requireSession().body(Number(url.searchParams.get('id'))));
    default:
      return send(res, 404, { error: 'Not found' });
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (res.headersSent) return res.end();
    send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Try PORT=4478 npm run devtools` : error);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`wraith devtools: http://127.0.0.1:${port}  (Ctrl+C to stop)`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void (session?.close() ?? Promise.resolve()).finally(() => process.exit(0));
  });
}
