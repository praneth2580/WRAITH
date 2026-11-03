# AI extraction and actions

AI is optional. When you configure a provider, every page gets `page.ai` with three helpers:

- **`extract(schema)`**: pull data matching a zod schema out of the page;
- **`ask(question)`**: answer a question about the page;
- **`act(instruction)`**: carry out a plain-language instruction in the browser, step by step.

Use it for pages too irregular for selectors, or for one-off jobs where writing selectors isn't worth it. Selectors are faster, cheaper and deterministic, so prefer them for anything you run often.

## Choosing a provider

```ts
import { createWraith } from 'wraithjs';

// Local, free, private: a running Ollama with a pulled model
const local = createWraith({ ai: { provider: 'ollama', model: 'qwen2.5:7b' } });

// Claude (npm install @anthropic-ai/sdk; reads ANTHROPIC_API_KEY)
const claude = createWraith({ ai: { provider: 'anthropic' } });

// OpenAI (npm install openai; reads OPENAI_API_KEY)
const openai = createWraith({ ai: { provider: 'openai', model: 'your-model-name' } });

// Any OpenAI-compatible server: LM Studio, llama.cpp, vLLM, OpenRouter, Groq…
const lmStudio = createWraith({ ai: { provider: 'openai', model: 'local-model', baseURL: 'http://localhost:1234/v1' } });
```

Keep API keys in environment variables rather than in code. Each provider's options are listed in [AI options](/reference/ai-options).

## Extracting into a schema

Describe the result with [zod](https://zod.dev), using the `z` that wraith exports so both share one zod instance:

```ts
import { createWraith, z } from 'wraithjs';

const wraith = createWraith({ ai: { provider: 'ollama', model: 'qwen2.5:7b' } });
const page = await wraith.fetch('https://books.toscrape.com/');

const { books } = await page.ai.extract(
  z.object({
    books: z.array(z.object({ title: z.string(), price: z.number(), inStock: z.boolean() })),
  }),
  { selector: 'ol.row', instruction: 'Price as a number in pounds' },
);
```

The page is converted to Markdown (scripts, styles and hidden elements removed) and sent with the schema. The reply is validated with zod; if it doesn't fit, the model is shown the errors and gets one chance to correct itself. If it still doesn't fit, you get an `AIError`.

Add `.describe()` to schema fields to guide the model:

```ts
import { z } from 'wraithjs';

const Job = z.object({
  title: z.string(),
  salary: z.number().nullable().describe('Annual salary in USD, or null if not stated'),
  remote: z.boolean().describe('True if the job can be done fully remotely'),
});
```

## Asking questions

```ts
const answer = await page.ai.ask('What is the return policy, in one sentence?');
const shipping = await page.ai.ask('Do they ship to India?', { selector: 'footer' });
```

## Acting on instructions

On browser pages, `act()` carries out an instruction. Each step, the model sees a list of the page's interactive elements and picks one action (click, type, select, press or scroll). wraith performs it with the page's human behaviour, waits for any page load, and shows the model the result, until the model reports the task done or `maxSteps` runs out.

```ts
const result = await page.ai.act('Log in with username %user% and password %pass%', {
  variables: { user: process.env.SITE_USER!, pass: process.env.SITE_PASS! },
  maxSteps: 5,
});

if (!result.success) console.warn('Did not finish:', result.message);
for (const step of result.steps) console.log(step.action, step.element, step.reason, step.error ?? '');
```

### Secrets stay out of the prompt

- **`variables`** are referred to as `%name%` in the instruction. The model only ever sees the placeholder; wraith substitutes the real value at the moment it types.
- **Field contents are never sent.** The model sees whether each field is empty or filled, not what's in it.

## For content you already have

`wraith.ai` works on any text, without a page:

```ts
import { createWraith, z } from 'wraithjs';

const wraith = createWraith({ ai: { provider: 'anthropic' } });
const email = 'Your order #4412 ships on 3 March to Pune.';

const order = await wraith.ai.extract(email, z.object({ orderId: z.string(), city: z.string() }));
const summary = await wraith.ai.ask('When does it ship?', email);
```

## Size limits

Pages longer than the provider's `maxInputChars` are refused with an error, rather than silently cut short (which would make the model miss data without telling you). The defaults are 400,000 characters for Anthropic, 200,000 for OpenAI, 48,000 for Ollama and 100,000 for custom providers.

The fix is almost always `selector`, which sends only part of the page and makes calls faster and cheaper:

```ts
import { z } from 'wraithjs';

await page.ai.extract(z.object({ specs: z.record(z.string(), z.string()) }), { selector: '#specifications' });
```

## Safety

Page content is always marked to the model as untrusted data, so instructions hidden in a page ("ignore previous instructions…") are treated as text, not commands.

## Provider notes

- **anthropic** defaults to `claude-opus-5-5` at `effort: 'medium'`, with structured outputs, so replies always match the schema. If the model declines a request, it's retried on Anthropic's recommended fallback model (`fallbacks: false` turns this off). Lower `effort` for faster, cheaper calls.
- **ollama** sends your schema as Ollama's `format` and asks for a 16k context (`numCtx`), because Ollama's default is too small for most pages. On a machine without a GPU, expect minutes per call for a full page; use `selector`.
- **openai** works with any server that implements chat completions. Use `jsonMode: 'json_object'` if a server rejects `json_schema`.
- **custom** plugs in anything:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  ai: {
    provider: 'custom',
    complete: async ({ system, prompt, schema }) => {
      // call your model here and return its reply text
      return JSON.stringify({ system, prompt, hasSchema: Boolean(schema) });
    },
  },
});
```
