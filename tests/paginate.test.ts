import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WraithError } from '../src/errors.js';
import { createWraith, type Wraith } from '../src/wraith.js';
import { json, startServer, type TestServer } from './helpers/server.js';

/** Server-rendered pages 1-3, each with a Next link except the last. */
function listPage(page: number): string {
  const next = page < 3 ? `<a class="pg-x1" href="/list?page=${page + 1}">Next</a>` : '';
  return `<!doctype html><body><p class="item">item ${page}a</p><p class="item">item ${page}b</p>${next}</body>`;
}

const SPA = `<!doctype html><body><div id="items"></div>
<button id="next">Next</button><script>
  let page = 1;
  function render() {
    items.innerHTML = '<p class="item">spa ' + page + 'a</p><p class="item">spa ' + page + 'b</p>';
    next.disabled = page === 3;
  }
  next.onclick = () => { page++; setTimeout(render, 150); };
  render();
</script></body>`;

const LOAD_MORE = `<!doctype html><body><div id="items"></div>
<button id="more">Load more</button><script>
  let batch = 0;
  async function load() {
    const data = await (await fetch('/api/batch?n=' + batch++)).json();
    items.insertAdjacentHTML('beforeend', data.items.map((i) => '<p class="item">' + i + '</p>').join(''));
    if (batch === 4) more.remove();
  }
  more.onclick = load;
  load();
</script></body>`;

const FEED = `<!doctype html><body style="margin:0"><div id="list"></div><script>
  let batches = 0, loading = false;
  function add() {
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'item';
      el.style.height = '120px';
      el.textContent = 'feed ' + document.querySelectorAll('.item').length;
      list.appendChild(el);
    }
  }
  add();
  addEventListener('scroll', () => {
    if (innerHeight + scrollY < document.documentElement.scrollHeight - 50 || loading || batches >= 3) return;
    loading = true;
    batches++;
    setTimeout(() => { add(); loading = false; }, 200);
  });
</script></body>`;

let server: TestServer;
let wraith: Wraith;

beforeAll(async () => {
  server = await startServer({
    '/list': (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(listPage(Number(new URL(req.url!, 'http://x').searchParams.get('page') ?? 1)));
    },
    '/loop': '<p>same page</p><a class="next" href="/loop">Next</a>',
    '/spa': SPA,
    '/more': LOAD_MORE,
    '/api/batch': (req, res) => {
      const n = Number(new URL(req.url!, 'http://x').searchParams.get('n'));
      setTimeout(() => json(res, 200, { items: [`more ${n}a`, `more ${n}b`] }), 200);
    },
    '/feed': FEED,
  });
  wraith = createWraith({ human: 'fast', network: { rateLimit: false } });
});

afterAll(async () => {
  await wraith?.close();
  await server?.close();
});

async function collect(page: Awaited<ReturnType<Wraith['open']>>, options: Parameters<typeof page.paginate>[0]) {
  const pages: number[] = [];
  for await (const n of page.paginate(options)) pages.push(n);
  return pages;
}

describe('page.paginate', () => {
  it('follows Next links until there are none', async () => {
    const page = await wraith.open(`${server.url}/list?page=1`);
    const items: string[] = [];
    for await (const n of page.paginate({ next: { role: 'link', name: 'Next' } })) {
      items.push(...(await page.extract({ items: { selector: '.item', list: true } })).items);
      expect(page.url()).toBe(`${server.url}/list?page=${n}`);
    }
    expect(items).toEqual(['item 1a', 'item 1b', 'item 2a', 'item 2b', 'item 3a', 'item 3b']);
    await page.close();
  });

  it('stops at maxPages', async () => {
    const page = await wraith.open(`${server.url}/list?page=1`);
    expect(await collect(page, { next: 'a.pg-x1', maxPages: 2 })).toEqual([1, 2]);
    await page.close();
  });

  it('stops when a Next button becomes disabled (single-page apps)', async () => {
    const page = await wraith.open(`${server.url}/spa`);
    const seen: string[] = [];
    for await (const _ of page.paginate({ next: '#next' })) seen.push((await page.text('.item')).split(' ')[1]!);
    expect(seen).toEqual(['1a', '2a', '3a']);
    await page.close();
  });

  it('clicks Load more until the button goes', async () => {
    const page = await wraith.open(`${server.url}/more`);
    await page.waitForText('more 0a');
    expect(await collect(page, { loadMore: { role: 'button', name: 'Load more' } })).toEqual([1, 2, 3, 4]);
    expect(await page.raw.locator('.item').count()).toBe(8);
    await page.close();
  });

  it('scrolls an infinite feed until it ends', async () => {
    const page = await wraith.open(`${server.url}/feed`);
    expect(await collect(page, { scroll: true, waitMs: 1500 })).toEqual([1, 2, 3, 4]);
    expect(await page.raw.locator('.item').count()).toBe(40);
    await page.close();
  });

  it('needs exactly one mode', async () => {
    const page = await wraith.open(`${server.url}/spa`);
    await expect(collect(page, { next: '#next', scroll: true })).rejects.toThrow(WraithError);
    await page.close();
  });
});

describe('wraith.paginate (no browser)', () => {
  it('follows Next links, given a selector for the link', async () => {
    const urls: string[] = [];
    for await (const page of wraith.paginate(`${server.url}/list?page=1`, { next: 'a.pg-x1' })) urls.push(page.url);
    expect(urls).toEqual([1, 2, 3].map((n) => `${server.url}/list?page=${n}`));
  });

  it('accepts a text match or a function, and never visits a page twice', async () => {
    let count = 0;
    for await (const _ of wraith.paginate(`${server.url}/list?page=1`, { next: { text: 'Next', attr: 'href' } })) count++;
    expect(count).toBe(3);

    let loops = 0;
    for await (const _ of wraith.paginate(`${server.url}/loop`, { next: (page) => page.extract({ n: 'a.next@href' }).n })) loops++;
    expect(loops).toBe(1);
  });
});
