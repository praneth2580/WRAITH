// One browser tab driven from the devtools UI, recording what each action does: the mouse and
// keyboard input wraith sends, network requests, console output and wraith's own log.
import type { Request, Response } from 'playwright';
import { createWraith, type Logger, type Wraith, type WraithOptions, type WraithPage } from '../src/index.js';
import { LONG_REQUEST_MS, TRACKED_TYPES } from '../src/wait.js';
import { ACTIONS, parseArgs, type ActionContext, type InflightRequest } from './actions.js';

export interface MouseRecord {
  type: 'move' | 'down' | 'up' | 'wheel';
  x: number;
  y: number;
  /** ms since the action started. */
  t: number;
  button?: string;
  dx?: number;
  dy?: number;
}

export interface KeyRecord {
  type: 'type' | 'press';
  key: string;
  t: number;
}

export interface RequestRecord {
  id: number;
  method: string;
  url: string;
  type: string;
  t: number;
  status?: number;
  contentType?: string;
  ms?: number;
  failed?: string;
}

export interface ConsoleRecord {
  type: string;
  text: string;
  t: number;
}

export interface LogRecord {
  level: keyof Logger;
  message: string;
  meta?: unknown;
  t: number;
}

interface Trace {
  start: number;
  mouse: MouseRecord[];
  keys: KeyRecord[];
  network: RequestRecord[];
  console: ConsoleRecord[];
  logs: LogRecord[];
  /** The viewport just before the first mouse press, when the mouse path lines up with the page. */
  clickShot?: string | null;
}

export interface View {
  url: string;
  title: string;
  viewport: { width: number; height: number } | null;
  screenshot: string | null;
}

export interface Report extends View {
  id: number;
  /** Set when the old browser had been closed and this action started a new one. */
  relaunched?: boolean;
  action: string;
  args: Record<string, unknown>;
  code: string | null;
  ok: boolean;
  result?: unknown;
  error?: { name: string; message: string; stack?: string };
  startedAt: string;
  durationMs: number;
  clickShot: string | null;
  mouse: MouseRecord[];
  keys: KeyRecord[];
  network: RequestRecord[];
  console: ConsoleRecord[];
  logs: LogRecord[];
}

/** Response bodies kept for viewing. */
const MAX_BODIES = 300;
/** Request records kept for updating the UI. */
const MAX_RECORDS = 3000;
/** Request types whose bodies are read as soon as they arrive, so they outlive navigation. */
const KEEP_BODIES = new Set(['document', 'xhr', 'fetch']);

export class Session {
  readonly wraith: Wraith;
  private page!: WraithPage;
  private trace: Trace | undefined;
  private count = 0;
  private requestIds = 0;
  private cursor = { x: 0, y: 0 };
  private readonly requests = new WeakMap<Request, RequestRecord>();
  private readonly pending = new Map<Request, number>();
  /** Requests made during actions, which the UI can ask about later. */
  private readonly traced = new Map<number, RequestRecord>();
  private readonly responses = new Map<number, { response: Response; body: Promise<Buffer | null> | undefined }>();

  private constructor(readonly options: WraithOptions) {
    this.wraith = createWraith({ ...options, logger: this.logger() });
  }

  static async start(options: WraithOptions): Promise<Session> {
    const session = new Session(options);
    try {
      session.page = await session.wraith.newPage();
    } catch (error) {
      await session.wraith.close().catch(() => {});
      throw error;
    }
    session.record();
    return session;
  }

  async run(name: string, rawArgs: Record<string, unknown>): Promise<Report> {
    const action = ACTIONS.get(name);
    if (!action) throw new Error(`Unknown action "${name}"`);
    const trace: Trace = { start: Date.now(), mouse: [], keys: [], network: [], console: [], logs: [] };
    let code: string | null = null;
    let result: unknown;
    let error: unknown;
    let ok = false;
    this.trace = trace;
    try {
      const args = parseArgs(action, rawArgs);
      code = action.code(args);
      result = await action.run(this.context(), args);
      ok = true;
    } catch (caught) {
      error = caught;
    } finally {
      this.trace = undefined;
    }
    const durationMs = Date.now() - trace.start;
    return {
      id: ++this.count,
      action: name,
      args: rawArgs,
      code,
      ok,
      ...(ok ? { result: serialize(result) } : { error: describeError(error) }),
      startedAt: new Date(trace.start).toISOString(),
      durationMs,
      ...(await this.view()),
      clickShot: trace.clickShot ?? null,
      mouse: trace.mouse,
      keys: trace.keys,
      network: trace.network,
      console: trace.console,
      logs: trace.logs,
    };
  }

  /** The page as it is now. */
  async view(): Promise<View> {
    const raw = this.page.raw;
    if (raw.isClosed()) return { url: '', title: '(the browser window was closed; the next action opens a new one)', viewport: null, screenshot: null };
    return {
      url: raw.url(),
      title: await Promise.race([raw.title(), new Promise<string>((resolve) => setTimeout(resolve, 2000, ''))]).catch(() => ''),
      viewport: raw.viewportSize(),
      screenshot: await this.screenshot(),
    };
  }

  /** A recorded request as it is now, and its response body as text. */
  async body(id: number): Promise<{ request: RequestRecord | undefined; contentType: string; text: string; truncated: boolean }> {
    const request = this.traced.get(id);
    const kept = this.responses.get(id);
    if (!kept) {
      if (request?.failed) throw new Error(`The request failed: ${request.failed}`);
      if (request && request.status === undefined) throw new Error('No response yet: the request is still going.');
      throw new Error(`Response ${id} is no longer kept (only the last ${MAX_BODIES} are).`);
    }
    const contentType = kept.response.headers()['content-type'] ?? '';
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(resolve, 5000, 'timeout'));
    const buffer = await Promise.race([kept.body ?? kept.response.body(), timeout]).catch((error: Error) => {
      if (/navigated away|No resource with given identifier/i.test(error.message)) {
        throw new Error("The browser dropped this body when the page navigated. Documents, XHR and fetch bodies are kept; others only until the next navigation.");
      }
      throw error;
    });
    if (buffer === 'timeout') throw new Error('The body is still arriving (a stream, or a very slow response).');
    if (buffer === null) throw new Error("The browser didn't keep this body (redirects and failed requests have none).");
    if (!/json|text|javascript|xml|html|css|svg|urlencoded/i.test(contentType)) {
      return { request, contentType, text: `(${buffer.length} bytes of ${contentType || 'binary data'})`, truncated: false };
    }
    let text = buffer.toString('utf8');
    if (/json/i.test(contentType)) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not actually JSON; show it as it is.
      }
    }
    const limit = 200_000;
    return { request, contentType, text: text.slice(0, limit), truncated: text.length > limit };
  }

  /** True once the page is gone: its window was closed, or the browser quit or crashed. */
  get closed(): boolean {
    return this.page.raw.isClosed();
  }

  close(): Promise<void> {
    return this.wraith.close();
  }

  private context(): ActionContext {
    return { wraith: this.wraith, page: this.page, headless: this.options.headless ?? true, inflight: () => this.inflight() };
  }

  private elapsed(): number {
    return this.trace ? Date.now() - this.trace.start : 0;
  }

  private async screenshot(): Promise<string | null> {
    try {
      const image = await this.page.raw.screenshot({ type: 'jpeg', quality: 80, scale: 'css', timeout: 5000 });
      return `data:image/jpeg;base64,${image.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private logger(): Logger {
    const log = (level: keyof Logger) => (message: string, ...meta: unknown[]) => {
      this.trace?.logs.push({ level, message, ...(meta.length > 0 ? { meta: serialize(meta) } : {}), t: this.elapsed() });
    };
    return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
  }

  /** Requests that haven't finished, and whether waitForSettled counts them (same rules as NetworkTracker). */
  private inflight(): InflightRequest[] {
    const now = Date.now();
    const main = this.page.raw.mainFrame();
    return [...this.pending].map(([request, started]) => {
      let mainFrame = false;
      try {
        mainFrame = request.frame() === main;
      } catch {
        // Service worker requests have no frame.
      }
      const ms = now - started;
      const type = request.resourceType();
      return { method: request.method(), url: request.url(), type, ms, countsAsBusy: mainFrame && TRACKED_TYPES.has(type) && ms < LONG_REQUEST_MS };
    });
  }

  private record(): void {
    const raw = this.page.raw;

    // Wrap the page's mouse and keyboard, which the Humanizer drives, so its input is recorded as
    // it's sent. Clicks and fills with human: 'off' go through Playwright directly and don't show.
    const { mouse, keyboard } = raw;
    const move = mouse.move.bind(mouse);
    const down = mouse.down.bind(mouse);
    const up = mouse.up.bind(mouse);
    const wheel = mouse.wheel.bind(mouse);
    const type = keyboard.type.bind(keyboard);
    const press = keyboard.press.bind(keyboard);

    mouse.move = async (x, y, options) => {
      this.cursor = { x, y };
      this.trace?.mouse.push({ type: 'move', x, y, t: this.elapsed() });
      return move(x, y, options);
    };
    mouse.down = async (options) => {
      // Takes ~0.1 s, once per action: the press comes that much later than it otherwise would.
      if (this.trace && this.trace.clickShot === undefined) {
        const trace = this.trace;
        trace.clickShot = null;
        trace.clickShot = await this.screenshot();
      }
      this.trace?.mouse.push({ type: 'down', ...this.cursor, button: options?.button ?? 'left', t: this.elapsed() });
      return down(options);
    };
    mouse.up = async (options) => {
      this.trace?.mouse.push({ type: 'up', ...this.cursor, button: options?.button ?? 'left', t: this.elapsed() });
      return up(options);
    };
    mouse.wheel = async (dx, dy) => {
      this.trace?.mouse.push({ type: 'wheel', ...this.cursor, dx, dy, t: this.elapsed() });
      return wheel(dx, dy);
    };
    keyboard.type = async (text, options) => {
      this.trace?.keys.push({ type: 'type', key: text, t: this.elapsed() });
      return type(text, options);
    };
    keyboard.press = async (key, options) => {
      this.trace?.keys.push({ type: 'press', key, t: this.elapsed() });
      return press(key, options);
    };

    raw.on('request', (request) => {
      const record: RequestRecord = { id: ++this.requestIds, method: request.method(), url: request.url(), type: request.resourceType(), t: this.elapsed() };
      this.requests.set(request, record);
      this.pending.set(request, Date.now());
      if (!this.trace) return;
      this.trace.network.push(record);
      this.traced.set(record.id, record);
      trim(this.traced, MAX_RECORDS);
    });
    raw.on('response', (response) => {
      const record = this.requests.get(response.request());
      if (!record) return;
      record.status = response.status();
      record.contentType = response.headers()['content-type']?.split(';')[0];
      // Only requests an action made, even when the response arrives after it finished.
      if (!this.traced.has(record.id)) return;
      // The browser discards bodies when the page navigates, so read the interesting ones now.
      const body = KEEP_BODIES.has(record.type) ? response.body().catch(() => null) : undefined;
      this.responses.set(record.id, { response, body });
      trim(this.responses, MAX_BODIES);
    });
    const finished = (request: Request, failure?: string) => {
      const started = this.pending.get(request);
      this.pending.delete(request);
      const record = this.requests.get(request);
      if (!record) return;
      if (started !== undefined) record.ms = Date.now() - started;
      if (failure) record.failed = failure;
    };
    raw.on('requestfinished', (request) => finished(request));
    raw.on('requestfailed', (request) => finished(request, request.failure()?.errorText ?? 'failed'));
    raw.on('console', (message) => this.trace?.console.push({ type: message.type(), text: message.text(), t: this.elapsed() }));
    raw.on('pageerror', (error) => this.trace?.console.push({ type: 'pageerror', text: error.stack ?? error.message, t: this.elapsed() }));
    raw.on('close', () => this.pending.clear());
  }
}

/** Drops a Map's oldest entries beyond `max`. */
function trim(map: Map<unknown, unknown>, max: number): void {
  for (const key of map.keys()) {
    if (map.size <= max) return;
    map.delete(key);
  }
}

/** Makes a result safe to send as JSON: images become data URLs, and nothing is circular or huge. */
export function serialize(value: unknown, depth = 0, ancestors = new WeakSet<object>()): unknown {
  if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 100_000 ? `${value.slice(0, 100_000)}… (${value.length} characters)` : value;
  if (typeof value === 'bigint' || typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (value instanceof RegExp) return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value instanceof Uint8Array) {
    const type = value[0] === 0x89 && value[1] === 0x50 ? 'png' : value[0] === 0xff && value[1] === 0xd8 ? 'jpeg' : undefined;
    return type ? { __image: `data:image/${type};base64,${Buffer.from(value).toString('base64')}` } : `[${value.length} bytes]`;
  }
  if (depth > 12) return '[…]';
  if (ancestors.has(value)) return '[circular]';
  ancestors.add(value);
  try {
    if (Array.isArray(value) || value instanceof Set) {
      const items = [...value];
      const out = items.slice(0, 1000).map((item) => serialize(item, depth + 1, ancestors) ?? null);
      if (items.length > 1000) out.push(`… ${items.length - 1000} more`);
      return out;
    }
    const entries = value instanceof Map ? [...value] : Object.entries(value);
    return Object.fromEntries(entries.map(([key, item]) => [String(key), serialize(item, depth + 1, ancestors)]));
  } finally {
    ancestors.delete(value);
  }
}

function describeError(error: unknown): { name: string; message: string; stack?: string } {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  const stack = error.stack
    ?.split('\n')
    .filter((line) => !line.includes('node:internal'))
    .join('\n');
  return { name: error.name, message: error.message, ...(stack ? { stack } : {}) };
}
