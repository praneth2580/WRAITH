import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AIClient } from '../src/ai/client.js';
import type { AIRequest } from '../src/ai/types.js';
import { AIError } from '../src/errors.js';
import { json, startServer, type TestServer } from './helpers/server.js';

const Product = z.object({ name: z.string(), price: z.number() });

function scripted(replies: string[], strictJson = false) {
  const requests: AIRequest[] = [];
  const client = new AIClient({
    provider: 'custom',
    strictJson,
    complete: async (request) => {
      requests.push(request);
      return replies[requests.length - 1] ?? '';
    },
  });
  return { client, requests };
}

describe('AIClient', () => {
  it('extracts and validates JSON, even inside a code fence', async () => {
    const { client, requests } = scripted(['```json\n{"name":"Widget","price":9.99}\n```']);
    expect(await client.extract('# Widget\n$9.99', Product, { source: 'https://shop.test/w' })).toEqual({
      name: 'Widget',
      price: 9.99,
    });
    expect(requests[0]!.prompt).toContain('<page url="https://shop.test/w">');
    // Providers without constrained decoding get the schema in the prompt.
    expect(requests[0]!.prompt).toContain('JSON Schema');
  });

  it('shows the model its mistake and accepts the corrected reply', async () => {
    const { client, requests } = scripted(['{"name":"Widget","price":"cheap"}', '{"name":"Widget","price":5}']);
    expect(await client.extract('page', Product)).toEqual({ name: 'Widget', price: 5 });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.prompt).toContain('price');
    expect(requests[1]!.prompt).toContain('rejected');
  });

  it('gives up after one correction', async () => {
    const { client } = scripted(['nope', 'still nope']);
    await expect(client.extract('page', Product)).rejects.toThrow(AIError);
  });

  it('leaves the schema out of the prompt for strict providers', async () => {
    const { client, requests } = scripted(['{"name":"A","price":1}'], true);
    await client.extract('page', Product);
    expect(requests[0]!.prompt).not.toContain('JSON Schema');
    expect(requests[0]!.schema).toBe(Product);
  });

  it('refuses oversized content instead of cutting it short', async () => {
    const { client, requests } = scripted([]);
    const small = new AIClient({ provider: 'custom', maxInputChars: 10, complete: async () => '' });
    await expect(small.extract('x'.repeat(11), Product)).rejects.toThrow(/over the limit of 10/);
    expect(requests).toHaveLength(0);
    expect(client.maxInputChars).toBe(100_000);
  });
});

describe('providers', () => {
  let server: TestServer;
  const seen: { path: string; headers: Record<string, string | string[] | undefined>; body: any }[] = [];
  let anthropicReply: Record<string, unknown> = {};

  beforeAll(async () => {
    server = await startServer({
      '/api/chat': (req, res, body) => {
        seen.push({ path: req.url!, headers: req.headers, body: JSON.parse(body) });
        const parsed = JSON.parse(body);
        if (parsed.model === 'missing') return json(res, 404, { error: 'model not found' });
        json(res, 200, { message: { role: 'assistant', content: '{"name":"Lamp","price":12}' }, done: true });
      },
      '/v1/chat/completions': (req, res, body) => {
        seen.push({ path: req.url!, headers: req.headers, body: JSON.parse(body) });
        json(res, 200, {
          id: 'c1',
          object: 'chat.completion',
          created: 0,
          model: 'local',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"name":"Desk","price":80}', refusal: null },
              finish_reason: 'stop',
            },
          ],
        });
      },
      '/v1/messages': (req, res, body) => {
        seen.push({ path: req.url!, headers: req.headers, body: JSON.parse(body) });
        json(res, 200, {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: '{"name":"Chair","price":45}' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
          ...anthropicReply,
        });
      },
    });
  });

  afterEach(() => {
    seen.length = 0;
    anthropicReply = {};
    delete process.env.ANTHROPIC_BASE_URL;
  });

  afterAll(() => server.close());

  it('ollama: sends the JSON schema as the format and a larger context window', async () => {
    const client = new AIClient({ provider: 'ollama', model: 'qwen2.5:7b', host: server.url });
    expect(await client.extract('page', Product)).toEqual({ name: 'Lamp', price: 12 });
    const request = seen[0]!.body;
    expect(request.model).toBe('qwen2.5:7b');
    expect(request.stream).toBe(false);
    expect(request.format).toMatchObject({ type: 'object', required: ['name', 'price'] });
    expect(request.options.num_ctx).toBe(16384);
  });

  it('ollama: explains a missing model', async () => {
    const client = new AIClient({ provider: 'ollama', model: 'missing', host: server.url });
    await expect(client.ask('hi')).rejects.toThrow(/ollama pull missing/);
  });

  it('openai: works with any compatible server through baseURL', async () => {
    const client = new AIClient({ provider: 'openai', model: 'local', baseURL: `${server.url}/v1` });
    expect(await client.extract('page', Product)).toEqual({ name: 'Desk', price: 80 });
    expect(seen[0]!.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'response' } });
  });

  it('anthropic: uses structured output and medium effort', async () => {
    const client = new AIClient({ provider: 'anthropic', apiKey: 'test', baseURL: server.url });
    expect(await client.extract('page', Product)).toEqual({ name: 'Chair', price: 45 });
    const request = seen[0]!.body;
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.output_config.effort).toBe('medium');
    expect(request.output_config.format.type).toBe('json_schema');
    // Behind a custom base URL (a proxy), server-side fallback is left off.
    expect(request.fallbacks).toBeUndefined();
    expect(request.messages[0].content).not.toContain('JSON Schema');
  });

  it('anthropic: asks for server-side fallback on the Claude API', async () => {
    process.env.ANTHROPIC_BASE_URL = server.url;
    const client = new AIClient({ provider: 'anthropic', apiKey: 'test' });
    await client.extract('page', Product);
    expect(seen[0]!.body.fallbacks).toBe('default');
    expect(seen[0]!.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
  });

  it('anthropic: reports a refusal with its category', async () => {
    anthropicReply = {
      content: [],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
    };
    const client = new AIClient({ provider: 'anthropic', apiKey: 'test', baseURL: server.url });
    await expect(client.ask('hi')).rejects.toThrow(/declined.*cyber/);
  });
});
