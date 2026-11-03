// The actions the devtools UI can run. Each is a thin wrapper around one wraith call, plus the
// same call written as code so a working step can be copied into a script.
//
// Functions passed to page.evaluate() here must not declare named inner functions: tsx adds a
// __name() helper to them that doesn't exist in the browser (see src/in-page.ts).
import {
  ChallengeError,
  DEFAULT_LOADERS,
  WaitTimeoutError,
  z,
  type SelectorSchema,
  type TargetQuery,
  type Wraith,
  type WraithPage,
} from '../src/index.js';
import { pageActivity } from '../src/in-page.js';
import { matchTarget } from '../src/target.js';

export type FieldType = 'target' | 'pattern' | 'text' | 'textarea' | 'json' | 'number' | 'select' | 'checkbox';

export interface Field {
  name: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  options?: readonly string[];
  default?: string | number | boolean;
  required?: boolean;
}

export interface InflightRequest {
  method: string;
  url: string;
  type: string;
  ms: number;
  /** Whether waitForSettled treats this request as the page still loading. */
  countsAsBusy: boolean;
}

export interface ActionContext {
  wraith: Wraith;
  page: WraithPage;
  headless: boolean;
  inflight(): InflightRequest[];
}

// Values arrive as JSON from the form and are checked by parseArgs, so each action reads them loosely.
type Args = Record<string, any>;

export interface Action {
  name: string;
  group: string;
  help: string;
  fields: Field[];
  run(context: ActionContext, args: Args): Promise<unknown>;
  /** The same call as library code. */
  code(args: Args): string;
}

// ---- Fields ------------------------------------------------------------------------------

const target = (label = 'Target'): Field => ({
  name: 'target',
  type: 'target',
  label,
  required: true,
  placeholder: 'CSS selector, or {"role": "button", "name": "Sign in"}',
});
const optionalTarget = (label: string): Field => ({ ...target(label), required: false });
const timeout = (placeholder = 'default'): Field => ({ name: 'timeout', type: 'number', label: 'Timeout (ms)', placeholder });
const selector: Field = { name: 'selector', type: 'text', label: 'Selector', placeholder: 'whole page' };
const url: Field = { name: 'url', type: 'text', label: 'URL', required: true, placeholder: 'https://…' };
const selectorSchema = (required: boolean): Field => ({
  name: 'schema',
  type: 'json',
  label: 'Selector schema (JSON)',
  required,
  placeholder: '{ "title": "h1", "price": { "near": "Price" }, "links": { "selector": "a", "attr": "href", "list": true } }',
});

// ---- Parsing -----------------------------------------------------------------------------

const REGEX = /^\/(.+)\/([dgimsuvy]*)$/s;
/** Keys whose values wraith accepts as RegExps; "/like this/i" strings under them become one. */
const PATTERN_KEYS = new Set(['name', 'label', 'text', 'placeholder', 'alt', 'title', 'testId', 'near']);

function toPattern(value: string): string | RegExp {
  const match = REGEX.exec(value);
  return match ? new RegExp(match[1]!, match[2]) : value;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text, (key, value) => (typeof value === 'string' && PATTERN_KEYS.has(key) ? toPattern(value) : value));
  } catch (error) {
    throw new Error(`${label} isn't valid JSON: ${(error as Error).message}`);
  }
}

/** Turns the form's values into what the action expects, or throws a message for the form. */
export function parseArgs(action: Action, raw: Record<string, unknown>): Args {
  const args: Args = {};
  for (const field of action.fields) {
    const value = raw[field.name];
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new Error(`${field.label} is required`);
      if (field.default !== undefined) args[field.name] = field.default;
      continue;
    }
    const text = String(value);
    switch (field.type) {
      case 'target':
        args[field.name] = text.trim().startsWith('{') ? (parseJson(text, field.label) as TargetQuery) : text.trim();
        break;
      case 'pattern':
        args[field.name] = toPattern(text);
        break;
      case 'json':
        args[field.name] = parseJson(text, field.label);
        break;
      case 'number':
        if (!Number.isFinite(Number(value))) throw new Error(`${field.label} must be a number`);
        args[field.name] = Number(value);
        break;
      case 'checkbox':
        args[field.name] = value === true || value === 'true';
        break;
      default:
        args[field.name] = text;
    }
  }
  return args;
}

const FUNCTION = /^\s*(async\s+)?(function\b|(\([^)]*\)|[\w$]+)\s*=>)/;

const withScheme =(address: string) => (/^[a-z][\w+.-]*:/i.test(address) ? address : `https://${address}`);

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---- Code generation ---------------------------------------------------------------------

/** A JavaScript literal for a parsed value. */
function lit(value: unknown): string {
  if (value instanceof RegExp) return String(value);
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (Array.isArray(value)) return `[${value.map(lit).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return `{ ${entries.map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : lit(k)}: ${lit(v)}`).join(', ')} }`;
  }
  return String(value);
}

/** A trailing options argument, or nothing when every option is left at its default. */
function opts(values: Record<string, unknown>): string {
  const set = defined(values);
  return Object.keys(set).length > 0 ? `, ${lit(set)}` : '';
}

/** The only argument: options, or nothing when every option is left at its default. */
const onlyOpts = (values: Record<string, unknown>) => opts(values).slice(2);

const unless = <T>(value: T, fallback: T) => (value === fallback ? undefined : value);

// ---- In-page diagnostics -----------------------------------------------------------------

/** Every element a target matches, with what decides whether wraith can use it. */
async function inspect(page: WraithPage, query: string | TargetQuery) {
  const all = matchTarget(page.raw, query);
  const count = await all.count();
  const uses = typeof query === 'string' ? 0 : (query.nth ?? 0);
  const matches = await all.evaluateAll(
    (elements, limit) =>
      elements.slice(0, limit).map((el, index) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const inViewport = x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
        const hit = visible && inViewport ? document.elementFromPoint(x, y) : null;
        const covered = hit !== null && hit !== el && !el.contains(hit);
        return {
          index,
          element: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + [...el.classList].slice(0, 3).map((c) => `.${c}`).join(''),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
          visible,
          enabled: !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true',
          inViewport,
          coveredBy: covered ? hit.tagName.toLowerCase() + (hit.id ? `#${hit.id}` : '') + (hit.classList[0] ? `.${hit.classList[0]}` : '') : null,
          box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        };
      }),
    20,
  );
  return { count, uses: uses < count ? uses : null, matches };
}

/** What waitForSettled is waiting on right now. */
async function activity({ page, inflight }: ActionContext) {
  const loaders = [...DEFAULT_LOADERS];
  const { domQuietFor, loading } = await page.raw.evaluate(pageActivity, loaders);
  const visibleLoaders = await page.raw.evaluate((selectors) => {
    // An element can match several loader selectors; list it under the first.
    const seen = new Set<Element>();
    return selectors.flatMap((css) =>
      [...document.querySelectorAll<HTMLElement>(css)]
        .filter((el) => {
          if (seen.has(el)) return false;
          seen.add(el);
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width >= 1 && rect.height >= 1 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
        })
        .slice(0, 3)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            selector: css,
            element: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList[0] ? `.${el.classList[0]}` : ''),
            box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          };
        }),
    );
  }, loaders);
  const requests = inflight();
  return {
    loadingIndicatorShowing: loading,
    visibleLoaders,
    domQuietForMs: Math.round(domQuietFor),
    busyRequests: requests.filter((r) => r.countsAsBusy),
    otherPendingRequests: requests.filter((r) => !r.countsAsBusy),
  };
}

// ---- The actions -------------------------------------------------------------------------

const actions: Action[] = [
  {
    name: 'goto',
    group: 'Navigate',
    help: 'Opens a URL through the rate limit, retries and robots.txt check, then waits as afterAction says.',
    fields: [url, { name: 'waitUntil', type: 'select', label: 'Wait until', options: ['load', 'domcontentloaded', 'networkidle', 'commit'], default: 'load' }],
    async run({ page }, a) {
      const response = await page.goto(withScheme(a.url), { waitUntil: a.waitUntil });
      return { status: response?.status() ?? null, url: page.url(), title: await page.title() };
    },
    code: (a) => `await page.goto(${lit(withScheme(a.url))}${opts({ waitUntil: unless(a.waitUntil, 'load') })});`,
  },

  // Act
  {
    name: 'click',
    group: 'Act',
    help: 'Waits until the element is visible, enabled, still and uncovered, moves the mouse to it, and clicks.',
    fields: [target(), { name: 'button', type: 'select', label: 'Button', options: ['left', 'right', 'middle'], default: 'left' }, timeout()],
    run: ({ page }, a) => page.click(a.target, defined({ button: a.button, timeout: a.timeout })),
    code: (a) => `await page.click(${lit(a.target)}${opts({ button: unless(a.button, 'left'), timeout: a.timeout })});`,
  },
  {
    name: 'dblclick',
    group: 'Act',
    help: 'Double-clicks, with the same checks as click.',
    fields: [target(), timeout()],
    run: ({ page }, a) => page.dblclick(a.target, defined({ timeout: a.timeout })),
    code: (a) => `await page.dblclick(${lit(a.target)}${opts({ timeout: a.timeout })});`,
  },
  {
    name: 'hover',
    group: 'Act',
    help: 'Moves the mouse over the element.',
    fields: [target(), timeout()],
    run: ({ page }, a) => page.hover(a.target, defined({ timeout: a.timeout })),
    code: (a) => `await page.hover(${lit(a.target)}${opts({ timeout: a.timeout })});`,
  },
  {
    name: 'type',
    group: 'Act',
    help: 'Clicks the field and types key by key, with human timing and occasional corrected typos.',
    fields: [
      target('Field'),
      { name: 'text', type: 'textarea', label: 'Text', required: true },
      { name: 'clear', type: 'checkbox', label: 'Replace what is in the field', default: true },
      { name: 'typos', type: 'checkbox', label: 'Allow typos', default: true },
      timeout(),
    ],
    run: ({ page }, a) => page.type(a.target, a.text, defined({ clear: a.clear, typos: a.typos, timeout: a.timeout })),
    code: (a) =>
      `await page.type(${lit(a.target)}, ${lit(a.text)}${opts({ clear: unless(a.clear, true), typos: unless(a.typos, true), timeout: a.timeout })});`,
  },
  {
    name: 'fill',
    group: 'Act',
    help: 'Sets the value instantly, without typing.',
    fields: [target('Field'), { name: 'value', type: 'text', label: 'Value', default: '' }, timeout()],
    run: ({ page }, a) => page.fill(a.target, a.value, defined({ timeout: a.timeout })),
    code: (a) => `await page.fill(${lit(a.target)}, ${lit(a.value)}${opts({ timeout: a.timeout })});`,
  },
  {
    name: 'press',
    group: 'Act',
    help: 'Presses a key or chord, on the target if given, otherwise on whatever has focus.',
    fields: [{ name: 'key', type: 'text', label: 'Key', required: true, placeholder: 'Enter, Tab, ControlOrMeta+A' }, optionalTarget('Target (optional)'), timeout()],
    run: ({ page }, a) => page.press(a.key, defined({ target: a.target, timeout: a.timeout })),
    code: (a) => `await page.press(${lit(a.key)}${opts({ target: a.target, timeout: a.timeout })});`,
  },
  {
    name: 'select',
    group: 'Act',
    help: 'Chooses options in a <select> by value or visible label.',
    fields: [target('Select'), { name: 'values', type: 'text', label: 'Values', required: true, placeholder: 'one, or several separated by commas' }, timeout()],
    run({ page }, a) {
      const values = (a.values as string).split(',').map((v) => v.trim()).filter(Boolean);
      return page.select(a.target, values.length === 1 ? values[0]! : values, defined({ timeout: a.timeout }));
    },
    code(a) {
      const values = (a.values as string).split(',').map((v) => v.trim()).filter(Boolean);
      return `await page.select(${lit(a.target)}, ${lit(values.length === 1 ? values[0] : values)}${opts({ timeout: a.timeout })});`;
    },
  },
  {
    name: 'check',
    group: 'Act',
    help: 'Ticks or unticks a checkbox or radio, clicking only if it needs to change.',
    fields: [target('Checkbox'), { name: 'checked', type: 'checkbox', label: 'Checked', default: true }],
    run: ({ page }, a) => page.check(a.target, a.checked),
    code: (a) => `await page.check(${lit(a.target)}${a.checked ? '' : ', false'});`,
  },
  {
    name: 'scroll',
    group: 'Act',
    help: 'Scrolls with the mouse wheel: by some pixels, to the top or bottom, or to an element.',
    fields: [
      { name: 'to', type: 'select', label: 'Scroll', options: ['by pixels', 'top', 'bottom', 'element'], default: 'by pixels' },
      { name: 'by', type: 'number', label: 'Pixels (negative is up)', default: 600 },
      optionalTarget('Element (for "element")'),
    ],
    run({ page }, a) {
      if (a.to === 'by pixels') return page.scroll({ by: a.by });
      if (a.to !== 'element') return page.scroll({ to: a.to });
      if (!a.target) throw new Error('Give the element to scroll to');
      return page.scroll({ to: a.target });
    },
    code: (a) => `await page.scroll(${lit(a.to === 'by pixels' ? { by: a.by } : { to: a.to === 'element' ? a.target : a.to })});`,
  },
  {
    name: 'autoScroll',
    group: 'Act',
    help: 'Keeps scrolling to the bottom while the page keeps growing. Returns the number of scrolls.',
    fields: [
      { name: 'maxScrolls', type: 'number', label: 'Most scrolls', placeholder: '20' },
      { name: 'idleMs', type: 'number', label: 'Wait for new content (ms)', placeholder: '2000' },
    ],
    run: ({ page }, a) => page.autoScroll(defined({ maxScrolls: a.maxScrolls, idleMs: a.idleMs })),
    code: (a) => `await page.autoScroll(${onlyOpts({ maxScrolls: a.maxScrolls, idleMs: a.idleMs })});`,
  },
  {
    name: 'read',
    group: 'Act',
    help: 'Scrolls through the page at reading speed, as a person would. Does nothing with human: off.',
    fields: [{ name: 'maxMs', type: 'number', label: 'At most (ms)', placeholder: '20000' }],
    run: ({ page }, a) => page.read(defined({ maxMs: a.maxMs })),
    code: (a) => `await page.read(${onlyOpts({ maxMs: a.maxMs })});`,
  },

  // Wait
  {
    name: 'waitForSettled',
    group: 'Wait',
    help: "Waits for the page's requests to finish, its content to stop changing and loaders to go. Shows what was still busy at the end.",
    fields: [
      { name: 'networkIdleMs', type: 'number', label: 'Network quiet for (ms)', placeholder: '500' },
      { name: 'domIdleMs', type: 'number', label: 'Content unchanged for (ms)', placeholder: '300' },
      timeout('15000'),
    ],
    async run(context, a) {
      const settled = await context.page.waitForSettled(defined({ networkIdleMs: a.networkIdleMs, domIdleMs: a.domIdleMs, timeout: a.timeout }));
      return { settled, ...(await activity(context)) };
    },
    code: (a) => `await page.waitForSettled(${onlyOpts({ networkIdleMs: a.networkIdleMs, domIdleMs: a.domIdleMs, timeout: a.timeout })});`,
  },
  {
    name: 'waitFor',
    group: 'Wait',
    help: 'Waits for an element to reach a state. "hidden" waits for a loader to go away.',
    fields: [target('Element'), { name: 'state', type: 'select', label: 'State', options: ['visible', 'hidden', 'attached', 'detached'], default: 'visible' }, timeout()],
    run: ({ page }, a) => page.waitFor(a.target, defined({ state: a.state, timeout: a.timeout })),
    code: (a) => `await page.waitFor(${lit(a.target)}${opts({ state: unless(a.state, 'visible'), timeout: a.timeout })});`,
  },
  {
    name: 'waitForText',
    group: 'Wait',
    help: 'Waits for text to appear. Plain text matches case-insensitively; /regex/ works too.',
    fields: [{ name: 'text', type: 'pattern', label: 'Text', required: true, placeholder: 'Welcome back, or /order #\\d+/i' }, timeout()],
    run: ({ page }, a) => page.waitForText(a.text, defined({ timeout: a.timeout })),
    code: (a) => `await page.waitForText(${lit(a.text)}${opts({ timeout: a.timeout })});`,
  },
  {
    name: 'waitForUrl',
    group: 'Wait',
    help: 'Waits for the URL to match a glob or a /regex/.',
    fields: [{ name: 'url', type: 'pattern', label: 'URL', required: true, placeholder: '**/dashboard, or /\\/orders\\/\\d+/' }, timeout()],
    run: ({ page }, a) => page.waitForUrl(a.url, defined({ timeout: a.timeout })),
    code: (a) => `await page.waitForUrl(${lit(a.url)}${opts({ timeout: a.timeout })});`,
  },
  {
    name: 'wait',
    group: 'Wait',
    help: 'Waits a fixed time.',
    fields: [{ name: 'ms', type: 'number', label: 'Milliseconds', required: true, default: 1000 }],
    run: ({ page }, a) => page.wait(a.ms),
    code: (a) => `await page.wait(${a.ms});`,
  },

  // Read
  {
    name: 'extract',
    group: 'Read',
    help: 'Pulls values out with a selector schema. "/regex/" works in text and near.',
    fields: [selectorSchema(true)],
    run: ({ page }, a) => page.extract(a.schema as SelectorSchema),
    code: (a) => `const data = await page.extract(${lit(a.schema)});`,
  },
  {
    name: 'text',
    group: 'Read',
    help: 'Visible text, with whitespace collapsed.',
    fields: [selector],
    run: ({ page }, a) => page.text(a.selector),
    code: (a) => `const text = await page.text(${a.selector ? lit(a.selector) : ''});`,
  },
  {
    name: 'markdown',
    group: 'Read',
    help: 'The page as clean Markdown, as AI features see it.',
    fields: [selector],
    run: ({ page }, a) => page.markdown(a.selector),
    code: (a) => `const markdown = await page.markdown(${a.selector ? lit(a.selector) : ''});`,
  },
  {
    name: 'html',
    group: 'Read',
    help: 'The current HTML, or the outer HTML of the first match.',
    fields: [selector],
    run: ({ page }, a) => page.html(a.selector),
    code: (a) => `const html = await page.html(${a.selector ? lit(a.selector) : ''});`,
  },
  {
    name: 'links',
    group: 'Read',
    help: 'Every http(s) link, absolute and de-duplicated.',
    fields: [],
    run: ({ page }) => page.links(),
    code: () => 'const links = await page.links();',
  },
  {
    name: 'structuredData',
    group: 'Read',
    help: 'JSON-LD, microdata, OpenGraph, meta tags, embedded JSON and app state on window.',
    fields: [],
    run: ({ page }) => page.structuredData(),
    code: () => 'const data = await page.structuredData();',
  },
  {
    name: 'captureJson',
    group: 'Read',
    help: 'Collects JSON responses whose URL matches, while reloading the page (or waiting for you to trigger them in a later action).',
    fields: [
      { name: 'match', type: 'pattern', label: 'URL contains', required: true, placeholder: '/api/, or /\\/api\\/v\\d\\//' },
      { name: 'reload', type: 'checkbox', label: 'Reload the page while capturing', default: true },
      { name: 'count', type: 'number', label: 'Wait for this many', default: 1 },
      timeout('10000'),
    ],
    async run({ page }, a) {
      const capture = page.captureJson(a.match);
      try {
        if (a.reload) await page.goto(page.url());
        try {
          await capture.waitFor(a.count, defined({ timeout: a.timeout }));
        } catch (error) {
          // Show whatever did arrive.
          if (!(error instanceof WaitTimeoutError) || capture.items.length === 0) throw error;
        }
        return capture.items;
      } finally {
        capture.stop();
      }
    },
    code: (a) =>
      [
        `const capture = page.captureJson(${lit(a.match)});`,
        a.reload ? 'await page.goto(page.url());' : '// …the action that makes the requests',
        `await capture.waitFor(${a.count});`,
        'capture.stop();',
      ].join('\n'),
  },
  {
    name: 'screenshot',
    group: 'Read',
    help: 'A PNG of the viewport, or of the whole page.',
    fields: [{ name: 'fullPage', type: 'checkbox', label: 'Whole page', default: false }],
    run: ({ page }, a) => page.screenshot({ fullPage: a.fullPage }),
    code: (a) => `const png = await page.screenshot(${a.fullPage ? '{ fullPage: true }' : ''});`,
  },

  // Diagnose
  {
    name: 'inspect',
    group: 'Diagnose',
    help: 'Shows every element a target matches, which one wraith would use, and whether it is visible, enabled and uncovered. Changes nothing.',
    fields: [target()],
    run: ({ page }, a) => inspect(page, a.target),
    code: (a) => `// ${lit(a.target)} — inspected in devtools`,
  },
  {
    name: 'activity',
    group: 'Diagnose',
    help: "What waitForSettled is waiting on right now: requests in flight, recent content changes, loaders showing. Checks the built-in loader selectors only.",
    fields: [],
    run: (context) => activity(context),
    code: () => '// page activity — checked in devtools',
  },

  // Challenges and consent
  {
    name: 'detectChallenge',
    group: 'CAPTCHAs & consent',
    help: 'Looks for a CAPTCHA, browser check or one-time-code prompt and returns it with a picture. Changes nothing.',
    fields: [],
    run: async ({ page }) => (await page.detectChallenge()) ?? 'No challenge found.',
    code: () => 'const challenge = await page.detectChallenge();',
  },
  {
    name: 'handoff',
    group: 'CAPTCHAs & consent',
    help: 'Types your answer into the challenge and submits it. Leave the answer empty to solve it yourself in the browser window (needs Headless off).',
    fields: [
      { name: 'answer', type: 'text', label: 'Answer', placeholder: 'the characters or code; empty to use the window' },
      timeout('120000'),
    ],
    async run({ page, headless }, a) {
      if (!a.answer && headless) throw new Error('The browser is headless. Type an answer, or relaunch with Headless off to solve it in the window.');
      let asked = 0;
      return page.handoff({
        timeout: a.timeout ?? 120_000,
        onChallenge: () => {
          asked++;
          if (!a.answer) return undefined;
          if (asked > 1) throw new ChallengeError(`The site didn't accept "${a.answer}". Run detectChallenge to see the new one.`);
          return a.answer as string;
        },
      });
    },
    code: () => 'await page.handoff({ onChallenge: async (challenge) => askSomeone(challenge.image) });',
  },
  {
    name: 'consentStatus',
    group: 'CAPTCHAs & consent',
    help: "What happened with this page's consent banner. Needs Consent set when launching.",
    fields: [],
    run: async ({ page }) => page.consentStatus(),
    code: () => 'const status = page.consentStatus();',
  },
  {
    name: 'waitForConsent',
    group: 'CAPTCHAs & consent',
    help: "Waits until the page's consent banner has been dealt with. Timing out is normal on pages without one.",
    fields: [timeout('5000')],
    run: ({ page }, a) => page.waitForConsent(defined({ timeout: a.timeout })),
    code: (a) => `await page.waitForConsent(${onlyOpts({ timeout: a.timeout })});`,
  },

  // Pagination
  {
    name: 'paginate',
    group: 'Pagination',
    help: 'Goes through pages with a Next control, a Load more button, or infinite scroll, extracting each page if a schema is given.',
    fields: [
      { name: 'mode', type: 'select', label: 'How', options: ['next', 'loadMore', 'scroll'], default: 'next' },
      optionalTarget('Next / Load more control'),
      { name: 'maxPages', type: 'number', label: 'Most pages', default: 3 },
      selectorSchema(false),
    ],
    async run({ page }, a) {
      if (a.mode !== 'scroll' && !a.target) throw new Error(`Give the ${a.mode === 'next' ? 'Next' : 'Load more'} control`);
      const how = a.mode === 'scroll' ? { scroll: true } : { [a.mode]: a.target };
      const pages = [];
      for await (const n of page.paginate({ ...how, maxPages: a.maxPages })) {
        pages.push({ page: n, url: page.url(), ...(a.schema ? { data: await page.extract(a.schema as SelectorSchema) } : {}) });
      }
      return pages;
    },
    code: (a) =>
      [
        `for await (const n of page.paginate(${lit({ ...(a.mode === 'scroll' ? { scroll: true } : { [a.mode]: a.target }), maxPages: a.maxPages })})) {`,
        a.schema ? `  const data = await page.extract(${lit(a.schema)});` : '  // read page n',
        '}',
      ].join('\n'),
  },

  // AI
  {
    name: 'ai.ask',
    group: 'AI',
    help: 'Answers a question about the page. Needs "ai" in the extra launch options.',
    fields: [{ name: 'question', type: 'textarea', label: 'Question', required: true }, selector],
    run: ({ page }, a) => page.ai.ask(a.question, defined({ selector: a.selector })),
    code: (a) => `const answer = await page.ai.ask(${lit(a.question)}${opts({ selector: a.selector })});`,
  },
  {
    name: 'ai.extract',
    group: 'AI',
    help: 'Pulls data matching a JSON Schema out of the page. Needs "ai" in the extra launch options.',
    fields: [
      {
        name: 'schema',
        type: 'json',
        label: 'JSON Schema',
        required: true,
        placeholder: '{ "type": "object", "properties": { "title": { "type": "string" } }, "required": ["title"] }',
      },
      { name: 'instruction', type: 'text', label: 'Instruction', placeholder: 'optional' },
      selector,
    ],
    run: ({ page }, a) =>
      page.ai.extract(z.fromJSONSchema(a.schema as Parameters<typeof z.fromJSONSchema>[0]), defined({ instruction: a.instruction, selector: a.selector })),
    code: (a) =>
      `const data = await page.ai.extract(z.fromJSONSchema(${JSON.stringify(a.schema)})${opts({ instruction: a.instruction, selector: a.selector })});`,
  },
  {
    name: 'ai.act',
    group: 'AI',
    help: 'Carries out a plain-language instruction step by step. Put secrets in variables and refer to them as %name%.',
    fields: [
      { name: 'instruction', type: 'textarea', label: 'Instruction', required: true, placeholder: 'log in as %user% with password %pass%' },
      { name: 'maxSteps', type: 'number', label: 'Most steps', placeholder: '5' },
      { name: 'variables', type: 'json', label: 'Variables (JSON)', placeholder: '{ "user": "tom", "pass": "…" }' },
    ],
    run: ({ page }, a) => page.ai.act(a.instruction, defined({ maxSteps: a.maxSteps, variables: a.variables })),
    code: (a) =>
      `const result = await page.ai.act(${lit(a.instruction)}${opts({ maxSteps: a.maxSteps, variables: a.variables ? Object.fromEntries(Object.keys(a.variables).map((k) => [k, '…'])) : undefined })});`,
  },

  // No browser
  {
    name: 'fetch',
    group: 'No browser',
    help: "Downloads a page without the browser, through the same rate limit and retries. Shows the start of its Markdown, or the schema's result.",
    fields: [url, selectorSchema(false)],
    async run({ wraith }, a) {
      const page = await wraith.fetch(withScheme(a.url));
      return {
        status: page.status,
        url: page.url,
        headers: Object.fromEntries(page.headers),
        ...(a.schema ? { data: page.extract(a.schema as SelectorSchema) } : { markdown: page.markdown().slice(0, 4000) }),
      };
    },
    code: (a) =>
      [`const res = await wraith.fetch(${lit(withScheme(a.url))});`, a.schema ? `const data = res.extract(${lit(a.schema)});` : ''].filter(Boolean).join('\n'),
  },

  // Advanced
  {
    name: 'evaluate',
    group: 'Advanced',
    help: 'Runs JavaScript in the page and returns the result: an expression, or a function.',
    fields: [{ name: 'expression', type: 'textarea', label: 'JavaScript', required: true, placeholder: 'document.title, or () => [...document.forms].length' }],
    // Playwright evaluates a string as an expression, so call it if it's a function.
    run: ({ page }, a) => page.raw.evaluate(FUNCTION.test(a.expression) ? `(${a.expression})()` : a.expression),
    code: (a) => `const value = await page.raw.evaluate(${FUNCTION.test(a.expression) ? a.expression.trim() : `() => ${a.expression.trim()}`});`,
  },
];

export const ACTIONS = new Map(actions.map((action) => [action.name, action]));

/** What the UI needs to build its forms. */
export function catalog() {
  return actions.map(({ name, group, help, fields }) => ({ name, group, help, fields }));
}
