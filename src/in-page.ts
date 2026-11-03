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
export function collectElements(max: number): RawElement[] {
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
