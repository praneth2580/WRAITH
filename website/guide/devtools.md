# Devtools

wraith's repository includes a local web UI for running wraith one action at a time and seeing exactly what each did. It's for developing scrapers and working on wraith itself. It isn't part of the npm package, so run it from a clone of the repository:

```bash
git clone https://github.com/praneth2580/WRAITH.git
cd WRAITH
npm install
npx playwright install chromium
npm run devtools
```

Then open **http://127.0.0.1:4477**. Set `PORT` to use another port: `PORT=4478 npm run devtools`.

## The layout

**Left: Browser and Action.** The Browser panel sets the engine, human preset, after-action wait, consent choice and blocked resources; any other option goes in as JSON (for example `{ "ai": { "provider": "ollama", "model": "qwen2.5:7b" } }`). Untick **Headless** to watch the real window. The Action panel runs one of 38 actions: every page method, plus `fetch` without a browser and `evaluate` for your own JavaScript.

Targets are typed as a selector or as JSON: `{"role": "button", "name": "Sign in"}`, `{"label": "Email"}`, `{"text": "/next/i"}` (slashes make a RegExp).

**Middle: the page.** A URL bar, and the screenshot of the selected action. **After** shows the page once the action finished; **At click** shows it just before the mouse button went down, with the mouse path drawn on top:

- the blue ring is where the cursor started, and the line runs from blue to red over time;
- each dot is one mouse event, so wide gaps mean fast movement;
- the red ring is where it pressed.

**Right: the timeline.** Every action you've run, with its duration; red ones failed. Click one to see it again.

## The tabs

| Tab | Shows |
| --- | --- |
| Result | What the action returned, images (such as a CAPTCHA), or the error and stack. **Run again** and **Load into the form** |
| Mouse & keys | Path length against a straight line, top speed, pause before pressing, press duration; every keystroke with the gap since the previous one, typos highlighted |
| Network | Every request the action made, with status, type and timing. Click one to see its response body |
| Console | What the page logged, including JavaScript errors |
| Log | wraith's own log for the action |
| Code | The action as wraith code, and every successful step so far as one script |

## Diagnosing

- **A click doesn't work:** run **inspect** with the same target. It outlines every match on the screenshot, marks the one wraith uses, and says whether it's hidden, disabled, off screen or covered (and by what).
- **Possible bot traps:** run **honeypots**. It outlines, in red, the links, buttons and fields a person couldn't see, with the reason for each.
- **A page never settles:** run **activity** or **waitForSettled**. They list requests in flight, visible loaders, and when the content last changed.
- **Classes are generated:** run an action that loads data, open **Network**, and look for JSON responses. Then try **captureJson** with that URL, and **structuredData**.

## Good to know

- One action runs at a time.
- With `human: 'off'` there's no mouse path, because clicks don't move the mouse.
- Taking the "At click" screenshot delays the first press of each action by about 0.1 s.
- If you close a visible browser window, the next action opens a new browser with the same settings.
- The server only listens on 127.0.0.1, and its API needs a token that only its own page has, so websites open in the driven browser can't control it.
