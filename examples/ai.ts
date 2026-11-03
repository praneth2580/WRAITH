// AI extraction and plain-language actions, with a local or hosted model.
//
// Pick the model with WRAITH_AI:
//   WRAITH_AI=ollama:qwen2.5:7b        local, via Ollama (default)
//   WRAITH_AI=anthropic                Claude; needs ANTHROPIC_API_KEY
//   WRAITH_AI=openai:<model>           OpenAI; needs OPENAI_API_KEY
//   WRAITH_AI=openai:<model> OPENAI_BASE_URL=http://localhost:1234/v1   LM Studio or any compatible server
//
// Run: npm run example examples/ai.ts
import { createWraith, z, type AIOptions } from '../src/index.js';

function aiFromEnv(): AIOptions {
  const [provider = 'ollama', ...rest] = (process.env.WRAITH_AI ?? 'ollama:qwen2.5:7b').split(':');
  const model = rest.join(':');
  switch (provider) {
    case 'anthropic':
      return { provider: 'anthropic', ...(model ? { model } : {}) };
    case 'openai':
      if (!model) throw new Error('Name the model: WRAITH_AI=openai:<model>');
      return { provider: 'openai', model, ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}) };
    case 'ollama':
      return { provider: 'ollama', model: model || 'qwen2.5:7b' };
    default:
      throw new Error(`Unknown provider "${provider}"`);
  }
}

const wraith = createWraith({ ai: aiFromEnv(), human: 'fast', logger: true });

try {
  // 1. Structured extraction from a page, with a zod schema. `selector` keeps the input small,
  //    which matters a lot for speed and cost (local models on a CPU especially).
  const shop = await wraith.fetch('https://books.toscrape.com/');
  const books = await shop.ai.extract(
    z.object({
      books: z.array(z.object({ title: z.string(), price: z.number(), inStock: z.boolean() })),
    }),
    { selector: 'ol.row > li:nth-child(-n+5)', instruction: 'Price as a number in pounds.' },
  );
  console.log('Extracted:', books.books);

  // 2. Plain-language actions in a real browser. Secrets go in `variables`; the model never sees them.
  const page = await wraith.open('https://quotes.toscrape.com/login');
  const result = await page.ai.act('Log in with username %user% and password %pass%', {
    variables: { user: 'demo-user', pass: 'demo-password' },
  });
  console.log('act():', result.success ? 'done' : 'failed', '-', result.message);
  for (const step of result.steps) console.log('  ', step.action, step.element ?? '', step.value ?? '', step.error ?? '');
  console.log('Logged in:', (await page.raw.locator('a[href="/logout"]').count()) > 0);
} finally {
  await wraith.close();
}
