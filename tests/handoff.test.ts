import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Challenge } from '../src/handoff.js';
import { ChallengeError } from '../src/errors.js';
import { createWraith, type Wraith } from '../src/wraith.js';
import { startServer, type TestServer } from './helpers/server.js';

const CAPTCHA_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="44">
<rect width="140" height="44" fill="#eee"/><text x="14" y="31" font-size="26" font-family="monospace">W7XK</text></svg>`;

function captchaForm(error = ''): string {
  return `<!doctype html><body><h1>Log in</h1>${error}
  <form method="post" action="/captcha">
    <img id="captcha-image" src="/captcha.svg" width="140" height="44" alt="security check">
    <input name="captcha_answer" placeholder="Type the characters">
    <button>Continue</button>
  </form></body>`;
}

const OTP = `<!doctype html><body><form method="post" action="/otp">
  <p>We sent a 6-digit code to +91 98•••••210.</p>
  <label for="code">Verification code</label> <input id="code" name="code" autocomplete="one-time-code">
  <button>Verify</button>
</form></body>`;

const widget = (src: string, token = '') => `<!doctype html><body><form>
  <iframe src="${src}" width="304" height="78"></iframe>
  <textarea name="g-recaptcha-response" style="display:none">${token}</textarea>
</form></body>`;

let server: TestServer;
let wraith: Wraith;

beforeAll(async () => {
  server = await startServer({
    '/captcha': (req, res, body) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      if (req.method !== 'POST') return res.end(captchaForm());
      const answer = new URLSearchParams(body).get('captcha_answer');
      res.end(answer === 'W7XK' ? '<h1>Welcome back</h1>' : captchaForm('<p>Wrong answer, try again.</p>'));
    },
    '/captcha.svg': (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end(CAPTCHA_IMAGE);
    },
    '/otp': (req, res, body) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(req.method === 'POST' && new URLSearchParams(body).get('code') === '123456' ? '<h1>Signed in</h1>' : OTP);
    },
    '/recaptcha': widget('/recaptcha/api2/anchor?k=test&size=normal'),
    '/recaptcha-invisible': widget('/recaptcha/api2/anchor?k=test&size=invisible'),
    '/recaptcha-solved': widget('/recaptcha/api2/anchor?k=test&size=normal', 'token-123'),
    '/plain': '<h1>Nothing to see</h1><input name="search">',
  });
  wraith = createWraith({ human: 'fast', network: { rateLimit: false } });
});

afterAll(async () => {
  await wraith?.close();
  await server?.close();
});

const isPng = (image: Buffer) => image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

describe('detectChallenge', () => {
  it('returns the CAPTCHA image as a PNG, ready to show a person', async () => {
    const page = await wraith.open(`${server.url}/captcha`);
    const challenge = await page.detectChallenge();
    expect(challenge).toMatchObject({ kind: 'captcha', provider: 'image', answerable: true, url: `${server.url}/captcha` });
    expect(isPng(challenge!.image)).toBe(true);
    expect(challenge!.message).toMatch(/image CAPTCHA/);
    await page.close();
  });

  it('recognises widgets, but not invisible or already-solved ones', async () => {
    const page = await wraith.open(`${server.url}/recaptcha`);
    expect(await page.detectChallenge()).toMatchObject({ kind: 'captcha', provider: 'recaptcha', answerable: false });
    for (const path of ['/recaptcha-invisible', '/recaptcha-solved', '/plain']) {
      await page.goto(`${server.url}${path}`);
      expect(await page.detectChallenge()).toBeNull();
    }
    await page.close();
  });
});

describe('handoff', () => {
  it("types the person's answer, and asks again if the site rejects it", async () => {
    const page = await wraith.open(`${server.url}/captcha`);
    const seen: Challenge[] = [];
    const answers = ['WRONG', 'W7XK'];
    const challenge = await page.handoff({ onChallenge: (c) => (seen.push(c), answers[seen.length - 1]) });
    expect(seen).toHaveLength(2);
    expect(challenge?.provider).toBe('image');
    expect(await page.text('h1')).toBe('Welcome back');
    await page.close();
  });

  it('handles one-time codes, passing on what the page says', async () => {
    const page = await wraith.open(`${server.url}/otp`);
    let message = '';
    await page.handoff({ onChallenge: (c) => ((message = c.message), '123456') });
    expect(message).toContain('We sent a 6-digit code to +91');
    expect(await page.text('h1')).toBe('Signed in');
    await page.close();
  });

  it('waits while the person deals with it some other way', async () => {
    const page = await wraith.open(`${server.url}/recaptcha`);
    const challenge = await page.handoff({
      onChallenge: async () => {
        // Stands in for someone ticking the box in the browser window.
        setTimeout(() => void page.raw.evaluate(() => document.querySelector('iframe')!.remove()), 500);
      },
    });
    expect(challenge?.provider).toBe('recaptcha');
    await page.close();
  });

  it('does nothing when there is no challenge', async () => {
    const page = await wraith.open(`${server.url}/plain`);
    expect(await page.handoff({ onChallenge: () => 'unused' })).toBeNull();
    await page.close();
  });

  it('explains what to do when no one can be asked', async () => {
    const page = await wraith.open(`${server.url}/captcha`);
    // Tests run without a terminal, and the browser is headless.
    await expect(page.handoff()).rejects.toThrow(/no terminal to ask in/);
    await page.goto(`${server.url}/recaptcha`);
    await expect(page.handoff()).rejects.toThrow(/headless: false/);
    await expect(page.handoff({ onChallenge: () => 'abc' })).rejects.toThrow(/no field to type it into/);
    await expect(page.handoff({ onChallenge: () => new Promise(() => {}), timeout: 500 })).rejects.toThrow(ChallengeError);
    await page.close();
  });

  it('runs by itself after navigation with handoff: { auto: true }', async () => {
    let asked = 0;
    const auto = createWraith({
      human: 'fast',
      network: { rateLimit: false },
      handoff: { auto: true, onChallenge: () => (asked++, 'W7XK') },
    });
    try {
      const page = await auto.open(`${server.url}/captcha`);
      expect(asked).toBe(1);
      expect(await page.text('h1')).toBe('Welcome back');
    } finally {
      await auto.close();
    }
  });
});
