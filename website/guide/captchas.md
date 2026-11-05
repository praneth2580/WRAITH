# CAPTCHAs and verification codes

wraith doesn't solve CAPTCHAs, and doesn't send them to solving services or AI models: they exist to keep automation out, and getting around them is up to the site's owner to allow. What wraith does is notice them, show them to a **person**, and carry on once they're dealt with. The same goes for one-time codes sent by SMS or email.

## Detecting a challenge

`detectChallenge()` looks at the page and returns a description with a picture, without changing anything:

```ts
const challenge = await page.detectChallenge();

if (challenge) {
  console.log(challenge.kind, challenge.provider, challenge.message);
  await import('node:fs/promises').then((fs) => fs.writeFile('challenge.png', challenge.image));
}
```

| Field | |
| --- | --- |
| `kind` | `'captcha'`, `'otp'` (a one-time code prompt) or `'browser-check'` |
| `provider` | `'recaptcha'`, `'hcaptcha'`, `'turnstile'`, `'geetest'`, `'datadome'`, `'perimeterx'` (HUMAN's "Press & Hold"), `'image'`, `'cloudflare'` or `'otp'` |
| `message` | A one-line explanation for the person. For codes, it includes the page's own wording, such as "We sent a code to +91 98•••••210" |
| `image` | A PNG `Buffer` of the challenge: the CAPTCHA image or widget, or the form asking for the code |
| `answerable` | `true` when typing an answer solves it (image CAPTCHAs, codes). `false` for widgets that need clicks |
| `url` | The page it appeared on |

Invisible widgets (such as invisible reCAPTCHA) and widgets that have already been solved are ignored, since there's nothing for a person to do.

## Handing it to a person

`handoff()` checks for a challenge and, if there is one, gets someone through it. It returns the challenge, or `null` if there wasn't one.

```ts
await page.handoff();
```

By default, it asks whoever is at the machine:

- **Visible browser** (`headless: false`): it prints what to do and waits while the person solves it in the window.
- **Headless**: for answerable challenges, it saves the image, prints its path and asks for the answer in the terminal. Widgets that need clicks can't be solved headless; it throws a `ChallengeError` saying to use `headless: false`.

### Asking from anywhere

Pass `onChallenge` to ask your own way: a web app, a chat bot, a push notification. Return the answer to have it typed in, or return nothing once the person has dealt with it some other way:

```ts
import { createWraith, type Challenge } from 'wraithjs';

declare function askOnSlack(text: string, image: Buffer): Promise<string>;

const wraith = createWraith({
  handoff: {
    onChallenge: async (challenge: Challenge) => {
      if (!challenge.answerable) throw new Error('Needs a person at the browser');
      return askOnSlack(challenge.message, challenge.image);
    },
    timeout: 300_000,     // how long to wait for an answer (default 5 minutes)
  },
});
```

When an answer comes back, wraith types it into the challenge's field (without typos) and presses Enter, then waits for the page to settle. If a challenge is still there, the site rejected the answer, and the person is asked again with the new one, up to three attempts. Set `submit: false` to type the answer without pressing Enter.

### Automatically

With `auto: true`, wraith checks after every navigation and action, and hands off whatever appears:

```ts
import { createWraith } from 'wraithjs';

declare function askSomeone(message: string, image: Buffer): Promise<string>;

const wraith = createWraith({
  handoff: { auto: true, onChallenge: (c) => askSomeone(c.message, c.image) },
});
```

## Browser checks

Cloudflare's "Checking your browser" page usually clears by itself. `handoff()` first waits up to 15 seconds for it to go away before involving anyone.

Without `handoff`, `goto()` gives browser checks from Cloudflare and other services the same 15 seconds, then throws `BlockedError` if they're still there. See [Bot protection](/guide/bot-protection).

## Errors

`handoff()` throws `ChallengeError` when nobody can be asked (headless with no terminal, or a widget in a headless browser), when the person doesn't respond within `timeout`, or when the answer has no field to go into.
