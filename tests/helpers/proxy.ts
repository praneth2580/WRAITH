import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect, createServer as createTcpServer, type Server, type Socket } from 'node:net';

/** A local proxy that sends every request, whatever host it names, to `originPort`. */
export interface TestProxy {
  url: string;
  /** Hosts requested through this proxy, in order. */
  seen: string[];
  /** The Proxy-Authorization header (HTTP) or "user:pass" (SOCKS) of each request. */
  credentials: (string | undefined)[];
  close(): Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

function closer(server: Server, sockets: Set<Socket>) {
  return () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
}

function tunnel(client: Socket, originPort: number, head: Buffer, reply: Buffer | string): void {
  const upstream = connect(originPort, '127.0.0.1', () => {
    client.write(reply);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
}

/**
 * An HTTP proxy. Handles absolute-form requests (how browsers send http:// URLs) and CONNECT
 * tunnels (how undici sends everything). With `auth` ("Basic …"), anything else gets a 407.
 */
export async function startHttpProxy(originPort: number, auth?: string): Promise<TestProxy> {
  const seen: string[] = [];
  const credentials: (string | undefined)[] = [];
  const sockets = new Set<Socket>();
  const allowed = (header: string | undefined) => !auth || header === auth;

  const server = createHttpServer((req, res) => {
    const target = new URL(req.url ?? '/');
    seen.push(target.host);
    credentials.push(req.headers['proxy-authorization']);
    if (!allowed(req.headers['proxy-authorization'])) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="test"' }).end();
      return;
    }
    const upstream = httpRequest(
      { host: '127.0.0.1', port: originPort, method: req.method, path: target.pathname + target.search, headers: { ...req.headers, host: target.host } },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  server.on('connect', (req, socket: Socket, head: Buffer) => {
    seen.push(req.url ?? '');
    credentials.push(req.headers['proxy-authorization']);
    if (!allowed(req.headers['proxy-authorization'])) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\n\r\n');
      return;
    }
    tunnel(socket, originPort, head, 'HTTP/1.1 200 Connection Established\r\n\r\n');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, seen, credentials, close: closer(server, sockets) };
}

/** A SOCKS5 proxy (RFC 1928), with username/password login (RFC 1929) when `user` is given. */
export async function startSocksProxy(originPort: number, user?: { username: string; password: string }): Promise<TestProxy> {
  const seen: string[] = [];
  const credentials: (string | undefined)[] = [];
  const sockets = new Set<Socket>();

  const server = createTcpServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    let buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'login' | 'request' = 'greeting';
    let login: string | undefined;

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting') {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]!) return;
        const methods = [...buffer.subarray(2, 2 + buffer[1]!)];
        buffer = buffer.subarray(2 + buffer[1]!);
        const method = user ? 0x02 : 0x00;
        if (!methods.includes(method)) return void client.end(Buffer.from([0x05, 0xff]));
        client.write(Buffer.from([0x05, method]));
        stage = user ? 'login' : 'request';
      }
      if (stage === 'login') {
        if (buffer.length < 2) return;
        const ulen = buffer[1]!;
        if (buffer.length < 3 + ulen) return;
        const plen = buffer[2 + ulen]!;
        if (buffer.length < 3 + ulen + plen) return;
        const username = buffer.subarray(2, 2 + ulen).toString();
        const password = buffer.subarray(3 + ulen, 3 + ulen + plen).toString();
        buffer = buffer.subarray(3 + ulen + plen);
        login = `${username}:${password}`;
        const ok = username === user!.username && password === user!.password;
        client.write(Buffer.from([0x01, ok ? 0x00 : 0x01]));
        if (!ok) return void client.end();
        stage = 'request';
      }
      if (stage === 'request') {
        if (buffer.length < 5) return;
        const type = buffer[3];
        const addressLength = type === 0x01 ? 4 : type === 0x04 ? 16 : 1 + buffer[4]!;
        const end = 4 + addressLength + 2;
        if (buffer.length < end) return;
        const host =
          type === 0x03 ? buffer.subarray(5, 5 + buffer[4]!).toString() : type === 0x01 ? [...buffer.subarray(4, 8)].join('.') : 'ipv6';
        const port = buffer.readUInt16BE(end - 2);
        const head = buffer.subarray(end);
        client.off('data', onData);
        client.pause(); // until the tunnel's pipe takes over
        seen.push(`${host}:${port}`);
        credentials.push(login);
        tunnel(client, originPort, head, Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      }
    };
    client.on('data', onData);
  });

  const port = await listen(server);
  return { url: `socks5://127.0.0.1:${port}`, seen, credentials, close: closer(server, sockets) };
}
