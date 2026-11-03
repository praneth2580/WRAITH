// Functions in this file are serialized and run inside the browser by page.evaluate(). Keep them
// self-contained: no imports, and no named inner functions or `const fn = () => ...` helpers.
// Some TypeScript runners (tsx, esbuild with keepNames) wrap those in a __name() helper that
// doesn't exist in the page. tests/in-page.test.ts checks this.

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
