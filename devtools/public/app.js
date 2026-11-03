// wraith devtools front end. Plain JavaScript, no build step. Everything that comes from the page
// under test (URLs, console output, results) is inserted as text, never as HTML.

const token = document.querySelector('meta[name="devtools-token"]').content;
const byId = (id) => document.getElementById(id);

const state = {
  catalog: [],
  /** Reports from the server, oldest first. */
  entries: [],
  /** The report on screen, or a "live" view of the page. */
  selected: null,
  tab: 'result',
  frame: 'click',
  /** Options of the running browser, or null. */
  session: null,
  /** { action, started } while something runs. */
  running: null,
  netFilter: '',
  bodies: new Map(),
};

// ---- Helpers -----------------------------------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-devtools-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `${response.status} ${response.statusText}`);
  return data;
}

const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`);
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const store = (key, value) => localStorage.setItem(`wraith-devtools:${key}`, JSON.stringify(value));
function recall(key) {
  try {
    return JSON.parse(localStorage.getItem(`wraith-devtools:${key}`));
  } catch {
    return null;
  }
}

function setStatus(text, kind = '') {
  const el = byId('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function notice(message) {
  byId('detail').replaceChildren(h('div', { class: 'error-box' }, h('strong', {}, 'Problem'), ': ', message));
}

// ---- Browser session ---------------------------------------------------------------------

const sessionForm = byId('session-form');

function saveSessionForm() {
  const values = { block: [] };
  for (const el of sessionForm.elements) {
    if (!el.name) continue;
    if (el.name === 'block') {
      if (el.checked) values.block.push(el.value);
    } else values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  store('session', values);
}

function restoreSessionForm() {
  const values = recall('session');
  if (!values) return;
  for (const el of sessionForm.elements) {
    if (!el.name || !(el.name in values)) continue;
    if (el.name === 'block') el.checked = values.block.includes(el.value);
    else if (el.type === 'checkbox') el.checked = values[el.name];
    else el.value = values[el.name];
  }
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    const both = [value, target[key]].every((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (both) merge(target[key], value);
    else target[key] = value;
  }
  return target;
}

function sessionOptions() {
  const f = sessionForm.elements;
  const options = { browser: f.browser.value, headless: f.headless.checked, human: f.human.value, waits: { afterAction: f.afterAction.value } };
  if (f.consent.value) options.consent = f.consent.value;
  if (f.seed.value !== '') options.seed = Number(f.seed.value);
  const blocked = [...sessionForm.querySelectorAll('input[name="block"]:checked')].map((input) => input.value);
  if (blocked.length > 0) options.blockResources = blocked;
  const extra = f.extra.value.trim();
  if (extra) {
    let parsed;
    try {
      parsed = JSON.parse(extra);
    } catch (error) {
      throw new Error(`"More options" isn't valid JSON: ${error.message}`);
    }
    merge(options, parsed);
  }
  return options;
}

function sessionLabel(options) {
  if (!options) return 'No browser';
  return [
    options.browser ?? 'chromium',
    options.headless === false ? 'visible window' : 'headless',
    `human: ${typeof options.human === 'string' ? options.human : 'custom'}`,
    `after action: ${options.waits?.afterAction ?? 'navigation'}`,
    options.consent && `consent: ${options.consent}`,
    options.ai && `ai: ${options.ai.provider}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

async function launch() {
  const options = sessionOptions();
  saveSessionForm();
  const data = await api('POST', '/api/session', { options });
  state.session = data.session;
  showLive(data);
}

function showLive(view) {
  select({ live: true, ok: true, mouse: [], keys: [], network: [], console: [], logs: [], ...view });
}

/** Runs one thing at a time, keeping the buttons and status in step. */
async function guarded(label, task) {
  if (state.running) return;
  state.running = { action: label, started: Date.now() };
  renderBusy();
  renderTimeline();
  try {
    await task();
  } catch (error) {
    notice(error.message);
  } finally {
    state.running = null;
    renderBusy();
    renderTimeline();
  }
}

function run(name, args) {
  return guarded(name, async () => {
    if (!state.session) await launch();
    const report = await api('POST', '/api/run', { action: name, args });
    state.entries.push(report);
    select(report);
    const address = byId('address').elements.url;
    if (document.activeElement !== address) address.value = report.url;
    requestAnimationFrame(() => (byId('timeline').scrollTop = byId('timeline').scrollHeight));
  });
}

let ticker;
function renderBusy() {
  const running = Boolean(state.running);
  for (const button of document.querySelectorAll('#run, #refresh, #close-session, #address button, #session-form button')) {
    button.disabled = running;
  }
  clearInterval(ticker);
  if (!running) return setStatus(sessionLabel(state.session), state.session ? 'live' : '');
  const tick = () => {
    const elapsed = fmtMs(Date.now() - state.running.started);
    setStatus(`Running ${state.running.action}… ${elapsed}`, 'busy');
    const cell = byId('running-time');
    if (cell) cell.textContent = elapsed;
  };
  tick();
  ticker = setInterval(tick, 100);
}

// ---- Action form -------------------------------------------------------------------------

const actionForm = byId('action-form');
const actionSelect = byId('action-select');
const findAction = (name) => state.catalog.find((action) => action.name === name);

function buildActionSelect() {
  const groups = new Map();
  for (const action of state.catalog) {
    if (!groups.has(action.group)) groups.set(action.group, []);
    groups.get(action.group).push(action);
  }
  actionSelect.replaceChildren(
    ...[...groups].map(([group, actions]) => h('optgroup', { label: group }, ...actions.map((a) => h('option', { value: a.name }, a.name)))),
  );
  actionSelect.value = recall('action') ?? 'goto';
  if (!actionSelect.value) actionSelect.selectedIndex = 0;
  renderFields(actionSelect.value);
}

function renderFields(name, values = recall(`args:${name}`) ?? {}) {
  const action = findAction(name);
  byId('action-help').textContent = action.help;
  byId('fields').replaceChildren(...action.fields.map((field) => fieldInput(field, values[field.name])));
}

function fieldInput(field, saved) {
  const value = saved ?? field.default ?? '';
  const label = `${field.label}${field.required ? ' *' : ''}`;
  if (field.type === 'checkbox') {
    return h('div', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: field.name, checked: Boolean(value) }), label));
  }
  let input;
  if (field.type === 'select') input = h('select', { name: field.name }, ...field.options.map((option) => h('option', { value: option }, option)));
  else if (field.type === 'json' || field.type === 'textarea') {
    input = h('textarea', { name: field.name, rows: field.type === 'json' ? 5 : 2, placeholder: field.placeholder ?? '', spellcheck: false });
  } else {
    input = h('input', { name: field.name, type: field.type === 'number' ? 'number' : 'text', placeholder: field.placeholder ?? '', spellcheck: false });
  }
  input.value = value;
  if (field.type === 'target') input.title = 'A CSS or Playwright selector, or JSON: {"role": "button", "name": "Save"}, {"label": "Email"}, {"text": "/next/i"}';
  return h('label', {}, h('span', {}, label), input);
}

function readArgs(action) {
  const args = {};
  for (const field of action.fields) {
    const input = byId('fields').querySelector(`[name="${field.name}"]`);
    if (field.type === 'checkbox') args[field.name] = input.checked;
    else if (field.type === 'number') args[field.name] = input.value === '' ? undefined : Number(input.value);
    else args[field.name] = input.value;
  }
  return args;
}

function loadIntoForm(entry) {
  actionSelect.value = entry.action;
  renderFields(entry.action, entry.args);
}

// ---- Selection, viewer and overlay -------------------------------------------------------

function select(entry) {
  state.selected = entry;
  renderTimeline();
  renderViewer();
  renderDetail();
}

const shot = byId('shot');
const overlay = byId('overlay');

function renderViewer() {
  const e = state.selected;
  const canShowClick = Boolean(e?.clickShot);
  const frame = state.frame === 'click' && canShowClick ? 'click' : 'after';
  for (const button of document.querySelectorAll('[data-frame]')) {
    button.classList.toggle('active', button.dataset.frame === frame);
    button.disabled = button.dataset.frame === 'click' && !canShowClick;
  }
  const src = frame === 'click' ? e?.clickShot : e?.screenshot;
  byId('frame').hidden = !src;
  byId('empty').hidden = Boolean(src);
  byId('view-caption').textContent = e ? `${e.live ? 'Now' : `#${e.id} ${e.action}`} · ${clip(e.title || e.url || '', 80)}` : '';
  if (!src) return;
  if (shot.getAttribute('src') === src) return drawOverlay();
  shot.onload = drawOverlay;
  shot.src = src;
}

function drawOverlay() {
  const e = state.selected;
  overlay.width = shot.naturalWidth;
  overlay.height = shot.naturalHeight;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!e) return;
  // Line widths in screen pixels, whatever the screenshot is scaled to.
  const px = overlay.width / Math.max(1, overlay.getBoundingClientRect().width);
  if (byId('show-boxes').checked) drawBoxes(ctx, e, px);
  if (byId('show-path').checked) drawPath(ctx, e.mouse ?? [], px);
}

/** Things with a `box` anywhere in a result: inspect's matches, activity's loaders. */
function boxesIn(value, out = []) {
  if (Array.isArray(value)) for (const item of value) boxesIn(item, out);
  else if (value && typeof value === 'object') {
    if (value.box && typeof value.box.x === 'number') out.push(value);
    for (const [key, item] of Object.entries(value)) if (key !== 'box') boxesIn(item, out);
  }
  return out;
}

function drawBoxes(ctx, e, px) {
  if (!e.ok || !e.result || typeof e.result !== 'object') return;
  const uses = e.action === 'inspect' ? e.result.uses : undefined;
  ctx.lineWidth = 2 * px;
  ctx.font = `${12 * px}px system-ui, sans-serif`;
  for (const item of boxesIn(e.result)) {
    const { x, y, width, height } = item.box;
    const chosen = uses !== undefined && item.index === uses;
    const color = item.selector ? '#f08c00' : chosen ? '#e8590c' : '#4c6ef5';
    ctx.strokeStyle = color;
    ctx.setLineDash(uses !== undefined && !chosen ? [5 * px, 4 * px] : []);
    ctx.strokeRect(x, y, width, height);
    const label = item.index !== undefined ? `#${item.index}${chosen ? ' (used)' : ''}` : item.element;
    if (!label) continue;
    const top = Math.max(0, y - 16 * px);
    ctx.fillStyle = color;
    ctx.fillRect(x, top, ctx.measureText(label).width + 8 * px, 16 * px);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 4 * px, top + 12 * px);
  }
  ctx.setLineDash([]);
}

function drawPath(ctx, mouse, px) {
  const moves = mouse.filter((m) => m.type === 'move');
  if (moves.length > 1) {
    const t0 = moves[0].t;
    const span = Math.max(1, moves.at(-1).t - t0);
    ctx.lineWidth = 2 * px;
    ctx.lineCap = 'round';
    // Blue at the start, red at the end.
    for (let i = 1; i < moves.length; i++) {
      ctx.strokeStyle = `hsl(${220 - 220 * ((moves[i].t - t0) / span)} 85% 50%)`;
      ctx.beginPath();
      ctx.moveTo(moves[i - 1].x, moves[i - 1].y);
      ctx.lineTo(moves[i].x, moves[i].y);
      ctx.stroke();
    }
    // One dot per mouse event: wide gaps mean fast movement.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    for (const m of moves) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.5 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'hsl(220 85% 50%)';
    ctx.beginPath();
    ctx.arc(moves[0].x, moves[0].y, 5 * px, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const press of mouse.filter((m) => m.type === 'down')) {
    ctx.strokeStyle = '#e03131';
    ctx.fillStyle = '#e03131';
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath();
    ctx.arc(press.x, press.y, 9 * px, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(press.x, press.y, 2.5 * px, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- Timeline ----------------------------------------------------------------------------

function describeArgs(args) {
  const first = Object.values(args ?? {}).find((value) => typeof value === 'string' && value.trim());
  return first ? clip(first.replace(/\s+/g, ' '), 80) : '';
}

function renderTimeline() {
  const items = state.entries.map((e) =>
    h(
      'li',
      { class: `${e.ok ? 'ok' : 'err'}${e === state.selected ? ' selected' : ''}`, onclick: () => select(e) },
      h('div', { class: 'top' }, h('span', { class: 'n' }, `#${e.id}`), h('span', { class: 'name' }, e.action), h('span', { class: 'dur' }, fmtMs(e.durationMs))),
      h('div', { class: 'sub' }, e.ok ? describeArgs(e.args) : e.error.message.split('\n')[0]),
    ),
  );
  if (state.running) {
    items.push(h('li', { class: 'pending' }, h('div', { class: 'top' }, h('span', { class: 'name' }, state.running.action), h('span', { class: 'dur', id: 'running-time' }, '…'))));
  }
  if (items.length === 0) items.push(h('li', { class: 'hint' }, 'Actions you run appear here.'));
  byId('timeline').replaceChildren(...items);
}

// ---- Detail tabs -------------------------------------------------------------------------

function renderDetail() {
  const e = state.selected;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === state.tab);
    const count = e && { input: e.mouse.length + e.keys.length, network: e.network.length, console: e.console.length, logs: e.logs.length }[button.dataset.tab];
    button.replaceChildren(button.dataset.label, count ? h('span', { class: 'count' }, String(count)) : '');
  }
  const detail = byId('detail');
  if (!e) return detail.replaceChildren(h('p', { class: 'hint' }, 'Run an action to see what it did.'));
  const render = { result: renderResult, input: renderInput, network: renderNetwork, console: renderConsole, logs: renderLogs, code: renderCode }[state.tab];
  detail.replaceChildren(...render(e).filter(Boolean));
}

function withoutImages(value, path, images) {
  if (Array.isArray(value)) return value.map((item, i) => withoutImages(item, `${path}[${i}]`, images));
  if (value && typeof value === 'object') {
    if (typeof value.__image === 'string' && value.__image.startsWith('data:image/')) {
      images.push({ path, src: value.__image });
      return '[image, shown above]';
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutImages(item, `${path}.${key}`, images)]));
  }
  return value;
}

function inspectSummary(r) {
  if (r.count === 0) return 'Nothing matches. An action on this target would wait for a match, then time out.';
  if (r.uses === null) return `${plural(r.count, 'element')} match, but nth is past the last one.`;
  const used = r.matches.find((m) => m.index === r.uses);
  const problems = used
    ? [!used.visible && 'not visible', !used.enabled && 'disabled', used.coveredBy && `covered by ${used.coveredBy}`, !used.inViewport && 'off screen (wraith scrolls to it first)'].filter(Boolean)
    : [];
  return `${plural(r.count, 'element')} ${r.count === 1 ? 'matches' : 'match'}; wraith uses #${r.uses}, which is ${problems.length ? problems.join(', ') : 'visible, enabled and uncovered'}.`;
}

function activitySummary(r) {
  const now = [];
  if (r.busyRequests.length) now.push(`${plural(r.busyRequests.length, 'request')} in flight`);
  if (r.loadingIndicatorShowing) now.push(`a loader is showing (${r.visibleLoaders.map((l) => l.element).join(', ')})`);
  now.push(`content last changed ${fmtMs(r.domQuietForMs)} ago`);
  const verdict = r.settled === undefined ? '' : r.settled ? 'Settled. ' : "Didn't settle in time. ";
  return `${verdict}Now: ${now.join('; ')}.`;
}

function renderResult(e) {
  const where = h('p', { class: 'hint' }, e.title ? `${e.title} — ${e.url}` : e.url);
  if (e.live) return [h('h3', {}, 'The page now'), where];
  const head = h(
    'div',
    { class: 'toolbar' },
    h('h3', { style: 'margin:0;flex:1' }, `#${e.id} ${e.action} — ${e.ok ? 'done' : 'failed'} in ${fmtMs(e.durationMs)}`),
    h('button', { type: 'button', onclick: () => run(e.action, e.args) }, 'Run again'),
    h('button', { type: 'button', onclick: () => loadIntoForm(e) }, 'Load into the form'),
  );
  if (!e.ok) {
    return [
      head,
      e.relaunched ? h('p', { class: 'hint' }, 'The browser had been closed, so this action started a new one with the same settings.') : null,
      h('div', { class: 'error-box' }, h('strong', {}, e.error.name), ': ', e.error.message),
      e.error.stack ? h('details', {}, h('summary', {}, 'Stack'), h('pre', {}, e.error.stack)) : null,
      where,
    ];
  }
  const images = [];
  const value = withoutImages(e.result, 'result', images);
  const relaunched = e.relaunched
    ? h('p', { class: 'hint' }, 'The browser had been closed (was its window closed?), so this action started a new one with the same settings. Cookies and logins from before are gone.')
    : null;
  const summary =
    e.action === 'inspect' ? inspectSummary(e.result) : ['activity', 'waitForSettled'].includes(e.action) ? activitySummary(e.result) : null;
  return [
    head,
    relaunched,
    where,
    summary ? h('p', {}, summary) : null,
    ...images.map(({ path, src }) => h('figure', {}, h('img', { src, alt: path }), h('figcaption', {}, path))),
    e.result === undefined || e.result === null
      ? h('p', { class: 'muted' }, 'Done. (No return value.)')
      : h('pre', {}, typeof value === 'string' ? value : JSON.stringify(value, null, 2)),
  ];
}

function renderInput(e) {
  const mouse = e.mouse;
  const keys = e.keys;
  if (mouse.length === 0 && keys.length === 0) {
    return [h('p', { class: 'hint' }, "No mouse or keyboard input was recorded. With human: 'off', wraith clicks and fills through Playwright directly, without moving the mouse.")];
  }
  const stats = [];
  const moves = mouse.filter((m) => m.type === 'move');
  if (moves.length > 1) {
    let length = 0;
    let peak = 0;
    for (let i = 1; i < moves.length; i++) {
      const distance = Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y);
      length += distance;
      const dt = moves[i].t - moves[i - 1].t;
      if (dt > 0) peak = Math.max(peak, distance / dt);
    }
    const straight = Math.hypot(moves.at(-1).x - moves[0].x, moves.at(-1).y - moves[0].y);
    stats.push(
      ['Mouse moves', `${plural(moves.length, 'event')} over ${fmtMs(moves.at(-1).t - moves[0].t)}`],
      ['Path', `${Math.round(length)} px; ${Math.round(straight)} px in a straight line${straight > 1 ? ` (${(length / straight).toFixed(2)}×)` : ''}`],
      ['Top speed', `${Math.round(peak * 1000)} px/s`],
    );
  }
  for (const press of mouse.filter((m) => m.type === 'down')) {
    const release = mouse.find((m) => m.type === 'up' && m.t >= press.t);
    const lastMove = moves.filter((m) => m.t <= press.t).at(-1);
    stats.push([
      `${press.button} press`,
      `at (${Math.round(press.x)}, ${Math.round(press.y)})${lastMove ? `, ${fmtMs(press.t - lastMove.t)} after the mouse stopped` : ''}${release ? `, held ${fmtMs(release.t - press.t)}` : ''}`,
    ]);
  }
  const wheels = mouse.filter((m) => m.type === 'wheel');
  if (wheels.length) stats.push(['Scrolling', `${plural(wheels.length, 'wheel tick')}, ${Math.round(wheels.reduce((sum, w) => sum + (w.dy ?? 0), 0))} px`]);
  const out = [];
  if (keys.length) {
    const gaps = keys.slice(1).map((k, i) => k.t - keys[i].t);
    const fixes = keys.filter((k) => k.key === 'Backspace').length;
    stats.push([
      'Keys',
      `${keys.length} over ${fmtMs(keys.at(-1).t - keys[0].t)}${gaps.length ? `, ${fmtMs(gaps.reduce((a, b) => a + b, 0) / gaps.length)} apart on average` : ''}${fixes ? `, ${plural(fixes, 'correction')}` : ''}`,
    ]);
  }
  out.push(h('dl', { class: 'stats' }, ...stats.flatMap(([term, text]) => [h('dt', {}, term), h('dd', {}, text)])));
  if (keys.length) {
    out.push(
      h('h3', {}, 'Keystrokes (ms since the previous one)'),
      h(
        'div',
        { class: 'keys' },
        ...keys.map((k, i) => {
          const fix = k.key === 'Backspace' || keys[i + 1]?.key === 'Backspace';
          const label = k.key === ' ' ? '␣' : k.key === '\n' ? '⏎' : k.key;
          return h('span', { class: `key${fix ? ' fix' : ''}` }, h('small', {}, i === 0 ? '' : String(k.t - keys[i - 1].t)), h('kbd', {}, label));
        }),
      ),
    );
  }
  out.push(h('details', {}, h('summary', {}, 'Raw events'), h('pre', {}, JSON.stringify({ mouse, keys }, null, 1))));
  return out;
}

function renderNetwork(e) {
  const requests = e.network;
  if (!requests.length) return [h('p', { class: 'hint' }, 'No requests during this action.')];
  const tbody = h('tbody');
  const bodyView = h('div', { style: 'margin-top:10px' });
  const rows = () => {
    const q = state.netFilter.toLowerCase();
    const shown = requests.filter((r) => !q || `${r.url} ${r.type} ${r.status ?? ''} ${r.method}`.toLowerCase().includes(q));
    tbody.replaceChildren(
      ...shown.map((r) =>
        h(
          'tr',
          {
            class: r.failed ? 'failed' : 'clickable',
            title: r.failed ? '' : 'Show the response',
            onclick: r.failed ? undefined : () => showBody(r, bodyView, rows),
          },
          h('td', { class: 'num' }, fmtMs(r.t)),
          h('td', {}, r.method),
          h('td', {}, r.failed ? 'failed' : (r.status ?? '…')),
          h('td', {}, r.type),
          h('td', { class: 'url' }, clip(r.url, 300), r.failed ? ` — ${r.failed}` : ''),
          h('td', { class: 'num' }, r.ms === undefined ? '…' : fmtMs(r.ms)),
        ),
      ),
    );
  };
  rows();
  const failed = requests.filter((r) => r.failed).length;
  return [
    h(
      'div',
      { class: 'toolbar' },
      h('input', { placeholder: 'Filter: url, type, status', value: state.netFilter, oninput: (event) => ((state.netFilter = event.target.value), rows()) }),
      h('span', { class: 'hint' }, `${plural(requests.length, 'request')}${failed ? `, ${failed} failed` : ''}. Click one to see its response; "…" was still going when the action ended.`),
    ),
    h('table', {}, h('thead', {}, h('tr', {}, ...['Started', 'Method', 'Status', 'Type', 'URL', 'Took'].map((t) => h('th', {}, t)))), tbody),
    bodyView,
  ];
}

async function showBody(request, view, refreshRows) {
  view.replaceChildren(h('p', { class: 'hint' }, 'Loading…'));
  try {
    const body = state.bodies.get(request.id) ?? (await api('GET', `/api/body?id=${request.id}`));
    state.bodies.set(request.id, body);
    // The request may have finished after the action did.
    if (body.request) {
      Object.assign(request, body.request);
      refreshRows();
    }
    view.replaceChildren(
      h('h3', {}, `${request.method} ${clip(request.url, 140)}`),
      h('p', { class: 'hint' }, `${body.contentType || 'no content type'}${body.truncated ? ' — cut at 200,000 characters' : ''}`),
      h('pre', {}, body.text),
    );
  } catch (error) {
    view.replaceChildren(h('div', { class: 'error-box' }, error.message));
  }
  view.scrollIntoView({ block: 'nearest' });
}

function renderConsole(e) {
  if (!e.console.length) return [h('p', { class: 'hint' }, 'Nothing was logged to the console during this action.')];
  return [h('ul', { class: 'lines' }, ...e.console.map((line) => h('li', { class: line.type }, h('span', { class: 'badge' }, line.type), ' ', line.text)))];
}

function renderLogs(e) {
  if (!e.logs.length) return [h('p', { class: 'hint' }, "wraith didn't log anything during this action.")];
  return [
    h(
      'ul',
      { class: 'lines' },
      ...e.logs.map((line) =>
        h('li', { class: line.level }, h('span', { class: 'badge' }, fmtMs(line.t)), ` ${line.level}: ${line.message}`, line.meta === undefined ? '' : ` ${JSON.stringify(line.meta)}`),
      ),
    ),
  ];
}

function copyButton(text) {
  return h(
    'button',
    {
      type: 'button',
      onclick: async (event) => {
        await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
        event.target.textContent = 'Copied';
        setTimeout(() => (event.target.textContent = 'Copy'), 1200);
      },
    },
    'Copy',
  );
}

/** Renames an identifier outside string and regex literals. */
function rename(code, from, to) {
  return code
    .split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/(?:\\.|[^/\\\n])+\/[a-z]*)/)
    .map((part, i) => (i % 2 ? part : part.replace(new RegExp(`\\b${from}\\b`, 'g'), to)))
    .join('');
}

/** Every successful step so far as one script, for pasting into a project. */
function script() {
  const declared = new Map();
  const steps = state.entries
    .filter((e) => e.ok && e.code && !e.code.startsWith('//'))
    .map((e) => {
      let code = e.code;
      const name = /^const (\w+) =/.exec(code)?.[1];
      if (name) {
        const seen = (declared.get(name) ?? 0) + 1;
        declared.set(name, seen);
        if (seen > 1) code = rename(code, name, `${name}${seen}`);
      }
      return code
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
    });
  const options = JSON.parse(JSON.stringify(state.session ?? {}));
  const hadKey = Boolean(options.ai && 'apiKey' in options.ai);
  if (hadKey) delete options.ai.apiKey;
  const usesZ = steps.some((step) => step.includes('z.fromJSONSchema'));
  return [
    `import { createWraith${usesZ ? ', z' : ''} } from 'wraithjs';`,
    '',
    hadKey ? '// apiKey left out: set it in the environment instead.' : null,
    `const wraith = createWraith(${JSON.stringify(options, null, 2)});`,
    'try {',
    '  const page = await wraith.newPage();',
    steps.length ? steps.join('\n') : '  // no steps yet',
    '} finally {',
    '  await wraith.close();',
    '}',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function renderCode(e) {
  const out = [];
  if (e.code) out.push(h('h3', {}, 'This step'), h('pre', {}, e.code), h('div', { class: 'toolbar', style: 'margin-top:6px' }, copyButton(e.code)));
  out.push(h('h3', { style: 'margin-top:14px' }, 'Every successful step so far'), h('pre', {}, script()), h('div', { class: 'toolbar', style: 'margin-top:6px' }, copyButton(script)));
  return out;
}

// ---- Wiring ------------------------------------------------------------------------------

sessionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  guarded('launch', launch);
});
sessionForm.addEventListener('change', saveSessionForm);

actionSelect.addEventListener('change', () => {
  store('action', actionSelect.value);
  renderFields(actionSelect.value);
});

actionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const action = findAction(actionSelect.value);
  const args = readArgs(action);
  store('action', action.name);
  store(`args:${action.name}`, args);
  run(action.name, args);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && actionForm.contains(document.activeElement)) {
    event.preventDefault();
    actionForm.requestSubmit();
  }
});

byId('address').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = event.target.elements.url.value.trim();
  if (url) run('goto', { url, waitUntil: 'load' });
});

byId('refresh').addEventListener('click', () =>
  guarded('refresh', async () => {
    const data = await api('GET', '/api/state');
    state.session = data.session;
    if (!data.session) throw new Error('No browser is running.');
    showLive(data);
  }),
);

byId('close-session').addEventListener('click', () =>
  guarded('close', async () => {
    await api('DELETE', '/api/session');
    state.session = null;
  }),
);

byId('clear').addEventListener('click', () => {
  state.entries = [];
  state.bodies.clear();
  if (!state.selected?.live) state.selected = null;
  select(state.selected);
});

for (const button of document.querySelectorAll('[data-frame]')) {
  button.addEventListener('click', () => {
    state.frame = button.dataset.frame;
    renderViewer();
  });
}
for (const id of ['show-path', 'show-boxes']) byId(id).addEventListener('change', drawOverlay);
window.addEventListener('resize', () => state.selected && drawOverlay());

for (const button of document.querySelectorAll('[data-tab]')) {
  button.dataset.label = button.textContent;
  button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    store('tab', state.tab);
    renderDetail();
  });
}

async function init() {
  state.tab = recall('tab') ?? 'result';
  restoreSessionForm();
  state.catalog = await api('GET', '/api/catalog');
  buildActionSelect();
  const data = await api('GET', '/api/state');
  state.session = data.session;
  renderBusy();
  if (data.session) showLive(data);
  else select(null);
}

init().catch((error) => notice(error.message));
