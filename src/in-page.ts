// Functions in this file are serialized and run inside the browser by page.evaluate(). Keep them
// self-contained: no imports, and no named inner functions or `const fn = () => ...` helpers.
// Some TypeScript runners (tsx, esbuild with keepNames) wrap those in a __name() helper that
// doesn't exist in the page. tests/in-page.test.ts checks this. Anything bigger than a one-line
// arrow that runs in the page belongs here.

/** An interactive element as read in the page. Strings are raw; act.ts tidies them. */
export interface RawElement {
  id: number;
  tag: string;
  role: string | null;
  type: string | null;
  label: string;
  placeholder: string | null;
  href: string | null;
  state: string | null;
  options: string[] | null;
  inView: boolean;
}

/**
 * Tags each visible, enabled interactive element with data-wraith-id and describes it. Field
 * values are never read, only whether a field is empty, so secrets don't reach the model.
 */
export function collectElements(max: number, isHoneypot?: (el: Element) => string | null): RawElement[] {
  const selector = [
    'a[href]',
    'button',
    'input:not([type=hidden])',
    'textarea',
    'select',
    'summary',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[role=button]',
    '[role=link]',
    '[role=checkbox]',
    '[role=radio]',
    '[role=switch]',
    '[role=tab]',
    '[role=menuitem]',
    '[role=option]',
    '[role=combobox]',
    '[role=textbox]',
    '[role=searchbox]',
    '[onclick]',
  ].join(',');

  for (const el of document.querySelectorAll('[data-wraith-id]')) el.removeAttribute('data-wraith-id');
  const found: RawElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (found.length >= max) break;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if ((el as HTMLButtonElement).disabled) continue;
    if (isHoneypot?.(el)) continue;

    const tag = el.tagName.toLowerCase();
    const input = el as HTMLInputElement;
    const type = tag === 'input' ? input.type || 'text' : null;
    const buttonLike = type === 'submit' || type === 'button' || type === 'reset';
    const field = (tag === 'input' && !buttonLike) || tag === 'textarea' || tag === 'select';
    const labels = field && input.labels ? Array.from(input.labels, (l) => l.innerText).join(' ') : '';
    const label =
      el.getAttribute('aria-label') ||
      labels ||
      (buttonLike ? input.value : '') ||
      (field ? '' : el.innerText.slice(0, 300)) ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.querySelector('img[alt]')?.getAttribute('alt') ||
      el.getAttribute('name') ||
      '';

    let state: string | null = null;
    if (type === 'checkbox' || type === 'radio') state = input.checked ? 'checked' : 'unchecked';
    else if (tag === 'select') state = `selected: ${(el as HTMLSelectElement).selectedOptions[0]?.text ?? ''}`;
    else if (field) state = input.value ? 'filled' : 'empty';

    const id = found.length + 1;
    el.setAttribute('data-wraith-id', String(id));
    found.push({
      id,
      tag,
      role: el.getAttribute('role'),
      type,
      label,
      placeholder: el.getAttribute('placeholder'),
      href: tag === 'a' ? el.getAttribute('href') : null,
      state,
      options: tag === 'select' ? Array.from((el as HTMLSelectElement).options, (o) => o.text).slice(0, 25) : null,
      inView: rect.bottom > 0 && rect.top < window.innerHeight,
    });
  }
  return found;
}

/**
 * How long the page's content has been unchanged, and whether a loading indicator is showing.
 * Installs a MutationObserver on first call; only content changes count, not style or class
 * flips, so animations don't keep the page "busy" forever.
 */
export function pageActivity(loaders: string[]): { domQuietFor: number; loading: boolean } {
  const w = window as unknown as { __wraithLastMutation?: number };
  if (w.__wraithLastMutation === undefined) {
    w.__wraithLastMutation = performance.now();
    new MutationObserver(() => {
      w.__wraithLastMutation = performance.now();
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }
  let loading = false;
  if (loaders.length > 0) {
    for (const el of document.querySelectorAll<HTMLElement>(loaders.join(','))) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      loading = true;
      break;
    }
  }
  return { domQuietFor: performance.now() - w.__wraithLastMutation, loading };
}

/** A cheap fingerprint of the URL and visible text, to tell whether "Next" changed anything. */
export function pageSignature(): string {
  const text = document.body ? document.body.innerText : '';
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `${location.href}#${text.length}:${hash}`;
}

/** Whether a pagination control can be used: visible and not disabled in any of the usual ways. */
export function controlUsable(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if ((el as HTMLButtonElement).disabled) return false;
  return el.closest('[aria-disabled="true"], [disabled], .disabled, .is-disabled') === null;
}

/** App state that frameworks leave on window, copied out as plain JSON. Unserializable values are skipped. */
export function readAppState(names: string[]): Record<string, unknown> {
  const w = window as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of names) {
    if (w[name] === undefined || w[name] === null) continue;
    try {
      out[name] = JSON.parse(JSON.stringify(w[name]));
    } catch {
      // Circular or otherwise not JSON; leave it out.
    }
  }
  return out;
}

export type ChallengeProvider = 'recaptcha' | 'hcaptcha' | 'turnstile' | 'geetest' | 'image' | 'cloudflare' | 'otp';

/** A challenge as found in the page. The element to show is tagged data-wraith-challenge; the answer field data-wraith-answer. */
export interface RawChallenge {
  kind: 'captcha' | 'otp' | 'browser-check';
  provider: ChallengeProvider;
  /** Typing an answer solves it (image CAPTCHAs, one-time codes). */
  answerable: boolean;
  hasAnswerField: boolean;
  /** Text around the challenge, such as "Enter the code we sent to …". */
  hint: string;
}

/**
 * Looks for something only a person should get past: a CAPTCHA, a browser check, or a request for
 * a one-time code. Hidden widgets (invisible reCAPTCHA badges) and solved ones don't count.
 */
export function detectChallenge(): RawChallenge | null {
  for (const el of document.querySelectorAll('[data-wraith-challenge]')) el.removeAttribute('data-wraith-challenge');
  for (const el of document.querySelectorAll('[data-wraith-answer]')) el.removeAttribute('data-wraith-answer');

  // A check that replaces the whole page, such as Cloudflare's "Just a moment...".
  const checkMarkers =
    '#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running, script[src*="challenges.cloudflare.com"]';
  if (/^(just a moment|attention required|please wait)/i.test(document.title.trim()) && document.querySelector(checkMarkers)) {
    document.body?.setAttribute('data-wraith-challenge', '');
    return { kind: 'browser-check', provider: 'cloudflare', answerable: false, hasAnswerField: false, hint: document.title };
  }

  const widgets: [ChallengeProvider, string][] = [
    ['recaptcha', 'iframe[src*="/recaptcha/"]:not([src*="size=invisible"])'],
    ['hcaptcha', 'iframe[src*="hcaptcha.com"]:not([src*="invisible"])'],
    ['turnstile', 'iframe[src*="challenges.cloudflare.com"]'],
    ['geetest', '.geetest_panel, .geetest_holder, .geetest_box'],
    [
      'image',
      'img[src*="captcha" i], img[id*="captcha" i], img[class*="captcha" i], img[alt*="captcha" i], canvas[id*="captcha" i], canvas[class*="captcha" i]',
    ],
  ];
  for (const [provider, selector] of widgets) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width < 10 || rect.height < 10) continue;
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const form = el.closest('form');
      const scope: ParentNode = form ?? document;
      // A widget whose response token is filled in has already been solved.
      const token = scope.querySelector<HTMLTextAreaElement>(
        '[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]',
      );
      if (provider !== 'image' && token && token.value) continue;

      el.setAttribute('data-wraith-challenge', '');
      let answer: Element | null = null;
      if (provider === 'image') {
        answer =
          scope.querySelector(
            'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], input[aria-label*="captcha" i]',
          ) ??
          form?.querySelector('input[type="text"], input:not([type])') ??
          null;
        answer?.setAttribute('data-wraith-answer', '');
      }
      return { kind: 'captcha', provider, answerable: provider === 'image', hasAnswerField: answer !== null, hint: '' };
    }
  }

  // A one-time code: by autocomplete hint, or by what the field is called or labelled.
  const codeWords =
    /otp|2fa|mfa|one[-_ ]?time|(verification|verify|auth|authentication|security|sms|login|confirmation|access)[-_ ]?(code|pin)|\d[- ]digit code|enter (the |your )?code|two[- ]factor/i;
  for (const input of document.querySelectorAll<HTMLInputElement>(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button])',
  )) {
    const rect = input.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || getComputedStyle(input).visibility === 'hidden') continue;
    const described = [
      input.name,
      input.id,
      input.placeholder,
      input.getAttribute('aria-label'),
      input.labels ? Array.from(input.labels, (l) => l.innerText).join(' ') : '',
    ].join(' ');
    if (input.autocomplete !== 'one-time-code' && !codeWords.test(described)) continue;
    input.setAttribute('data-wraith-answer', '');
    const container = (input.closest('form') ?? input.parentElement ?? input) as HTMLElement;
    container.setAttribute('data-wraith-challenge', '');
    return {
      kind: 'otp',
      provider: 'otp',
      answerable: true,
      hasAnswerField: true,
      hint: container.innerText.replace(/\s+/g, ' ').trim().slice(0, 300),
    };
  }
  return null;
}

/** Whether the element (or something inside it) is what a click at `point` would land on. Works inside shadow DOM. */
export function hitsElement(el: Element, point: { x: number; y: number }): boolean {
  const root = el.getRootNode() as Document | ShadowRoot;
  const hit = typeof root.elementFromPoint === 'function' ? root.elementFromPoint(point.x, point.y) : null;
  return hit !== null && (hit === el || el.contains(hit));
}

/** Whether the element is in the top-level page rather than inside an iframe. */
export function inTopFrame(): boolean {
  return window.top === window;
}

/**
 * Accepts a consent banner using autoconsent's own popup finder and button classifier (exposed
 * on window by its Playwright script). Its rule engine can't opt in on custom banners, only on
 * known consent platforms; this covers the rest. Returns whether a button was clicked.
 */
export function clickConsentAccept(): boolean {
  type Popup = { regexClassification: string; buttons: { regexClassification?: string; element: HTMLElement }[] };
  const heuristics = (window as unknown as { autoconsentHeuristics?: { getPotentialPopups(timeout?: number, hitTest?: boolean): Popup[] } })
    .autoconsentHeuristics;
  if (!heuristics) return false;
  for (const popup of heuristics.getPotentialPopups(1000, true)) {
    // 'none' means the popup's buttons don't look like a consent choice.
    if (popup.regexClassification === 'none') continue;
    const accept = popup.buttons.find((button) => button.regexClassification === 'accept');
    if (accept) {
      accept.element.click();
      return true;
    }
  }
  return false;
}

/**
 * Why a person couldn't see or reach `el`, or null if they could. Honeypots are links, buttons and
 * fields that are in the page's code but not visible, put there so that whatever uses them is
 * known to be a bot: hidden links that crawlers follow, invisible buttons, form fields only a bot
 * would fill in.
 */
export function honeypotReason(el: Element): string | null {
  if (!el.isConnected) return 'no longer on the page';
  const style = getComputedStyle(el);
  // A wrapper without a box of its own; its children are what show.
  if (style.display === 'contents') return null;

  // A form control styled away behind a label people can see (custom checkboxes, file pickers) is
  // what they click, through the label. A trap field hidden along with its label isn't.
  const labels = (el as HTMLInputElement).labels;
  if (labels) {
    for (const label of Array.from(labels)) if (honeypotReason(label) === null) return null;
  }

  const shown = el.checkVisibility
    ? el.checkVisibility({ visibilityProperty: true })
    : style.display !== 'none' && style.visibility === 'visible';
  if (!shown) return style.visibility === 'visible' ? 'hidden (display: none, on it or a parent)' : 'hidden (visibility: hidden)';

  let opacity = 1;
  for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
  if (opacity < 0.1) return `transparent (opacity ${Math.round(opacity * 100) / 100})`;

  // An inline link around a block can measure nothing while its content shows; use the content.
  let box = el.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) {
    const own = box;
    for (const child of Array.from(el.querySelectorAll('*')).slice(0, 50)) {
      const childBox = child.getBoundingClientRect();
      if (childBox.width >= 2 && childBox.height >= 2) {
        box = childBox;
        break;
      }
    }
    if (box === own) return `too small to see (${Math.round(own.width)}×${Math.round(own.height)} px)`;
  }

  const root = document.documentElement;
  const left = box.left + window.scrollX;
  const top = box.top + window.scrollY;
  if (left + box.width <= 0 || top + box.height <= 0) return 'positioned off the page';
  if (left >= Math.max(root.scrollWidth, root.clientWidth) || top >= Math.max(root.scrollHeight, root.clientHeight)) {
    return 'positioned off the page';
  }

  if (style.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(\s*(50|100)%/.test(style.clipPath)) return 'clipped to nothing';

  // Cut off by a container that hides its overflow. A fixed-position element escapes its
  // ancestors' clipping, so stop looking there.
  for (let child: Element = el, node = el.parentElement; node && node !== root; child = node, node = node.parentElement) {
    if (getComputedStyle(child).position === 'fixed') break;
    const outer = getComputedStyle(node);
    const hidesX = outer.overflowX === 'hidden' || outer.overflowX === 'clip';
    const hidesY = outer.overflowY === 'hidden' || outer.overflowY === 'clip';
    if (!hidesX && !hidesY) continue;
    const bounds = node.getBoundingClientRect();
    if (
      (hidesX && (box.right <= bounds.left || box.left >= bounds.right)) ||
      (hidesY && (box.bottom <= bounds.top || box.top >= bounds.bottom))
    ) {
      return 'clipped out of sight by its container';
    }
  }

  const hasText = Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  if (hasText) {
    if (parseFloat(style.fontSize) < 1) return 'text too small to see (font-size 0)';
    // The colour behind the text: the nearest background colour, unless an image is in the way.
    let background: string | null = 'rgb(255, 255, 255)';
    for (let node: Element | null = el; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.backgroundImage !== 'none') {
        background = null;
        break;
      }
      if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') {
        background = s.backgroundColor;
        break;
      }
    }
    if (background && style.color.startsWith('rgb') && background.startsWith('rgb')) {
      const [text, back] = [style.color, background].map((value) => (value.match(/[\d.]+/g) ?? []).map(Number));
      const alpha = text![3] ?? 1;
      if (alpha < 0.1) return 'transparent text';
      const difference = [0, 1, 2].reduce((sum, i) => sum + Math.abs(text![i]! - back![i]!), 0);
      if (difference < 10 && alpha >= 0.9 && (back![3] ?? 1) >= 0.9) return 'text the same colour as its background';
    }
  }
  return null;
}

/** A short description of an element for messages: `a#next.btn "Next page"`. */
export function describeElement(el: Element): string {
  const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('');
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}${text ? ` "${text}"` : ''}`;
}

/** The hrefs of links a person can see, and the URL they're relative to. Run with a honeypot check. */
export function visibleLinks(_: null, isHoneypot: (el: Element) => string | null): { base: string; hrefs: string[] } {
  const hrefs: string[] = [];
  for (const link of Array.from(document.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href');
    if (href && !isHoneypot(link)) hrefs.push(href);
  }
  return { base: document.baseURI, hrefs };
}

export interface RawHoneypot {
  element: string;
  href: string | null;
  reason: string;
  box: { x: number; y: number; width: number; height: number };
}

/** Links, buttons and fields on the page that a person couldn't see. Run with a honeypot check. */
export function listHoneypots(max: number, isHoneypot: (el: Element) => string | null): RawHoneypot[] {
  const selector =
    'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=checkbox], [onclick], [tabindex]:not([tabindex="-1"])';
  const found: RawHoneypot[] = [];
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (found.length >= max) break;
    const reason = isHoneypot(el);
    if (!reason) continue;
    const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('');
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const name = el.getAttribute('name');
    const rect = el.getBoundingClientRect();
    found.push({
      element: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}${name ? `[name=${name}]` : ''}${text ? ` "${text}"` : ''}`,
      href: el.getAttribute('href'),
      reason,
      box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    });
  }
  return found;
}
