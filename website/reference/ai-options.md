# AI options

The `ai` option of `createWraith()`. One of four providers:

```ts sig
type AIOptions = AnthropicOptions | OpenAIOptions | OllamaOptions | CustomAIOptions;
```

Every provider also accepts `maxInputChars`: content longer than this is refused with an `AIError` rather than cut short.

## anthropic

Needs `npm install @anthropic-ai/sdk`.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `provider` | `'anthropic'` | | |
| `apiKey` | `string` | `ANTHROPIC_API_KEY`, or an `ant auth login` profile | |
| `model` | `string` | `'claude-opus-5-5'` | |
| `effort` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | `'medium'` | Lower is faster and cheaper |
| `fallbacks` | `boolean` | `true` | Retry a declined request on Anthropic's recommended fallback model |
| `baseURL` | `string` | | For a proxy or gateway. Fallbacks are off with a custom `baseURL` |
| `maxInputChars` | `number` | `400000` | |

Replies use structured outputs, so they always match the schema.

## openai

Needs `npm install openai`. Works with OpenAI and any server that implements chat completions: LM Studio, llama.cpp, vLLM, OpenRouter, Groq…

| Option | Type | Default | |
| --- | --- | --- | --- |
| `provider` | `'openai'` | | |
| `model` | `string` | required | |
| `apiKey` | `string` | `OPENAI_API_KEY` | Local servers usually don't need one |
| `baseURL` | `string` | OpenAI's API | e.g. `'http://localhost:1234/v1'` for LM Studio |
| `jsonMode` | `'json_schema' \| 'json_object'` | `'json_schema'` | Use `'json_object'` if a server rejects JSON schemas |
| `maxInputChars` | `number` | `200000` | |

## ollama

No package needed, just a running [Ollama](https://ollama.com) with the model pulled (`ollama pull qwen2.5:7b`).

| Option | Type | Default | |
| --- | --- | --- | --- |
| `provider` | `'ollama'` | | |
| `model` | `string` | required | Such as `'qwen2.5:7b'` or `'llama3.1'` |
| `host` | `string` | `OLLAMA_HOST`, or `http://localhost:11434` | |
| `numCtx` | `number` | `16384` | Context window in tokens. Ollama's own default is too small for most pages |
| `maxInputChars` | `number` | `48000` | |

The schema is sent as Ollama's `format`, so replies follow it.

## custom

Any model you can call from Node.js.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `provider` | `'custom'` | | |
| `complete` | `(request: AIRequest) => Promise<string \| AIResponse>` | required | Return the reply text, or `{ text, data }` if you parsed it already |
| `model` | `string` | | Your model's name, for your own reference |
| `strictJson` | `boolean` | `false` | Set when your model guarantees replies match the schema |
| `maxInputChars` | `number` | `100000` | |

```ts sig
interface AIRequest {
  system?: string;
  prompt: string;
  schema?: z.ZodType;     // when set, the reply must be JSON matching it
  maxTokens?: number;
}

interface AIResponse {
  text: string;
  data?: unknown;
}
```

Unless `strictJson` is set, wraith also describes the schema in the prompt and validates the reply itself, with one correction round.

## Your own AIProvider

To reuse a provider object across Wraiths, implement `AIProvider` and wrap it with `custom`:

```ts
import { createWraith, type AIProvider } from 'wraithjs';

const myProvider: AIProvider = {
  name: 'my-model',
  model: 'v1',
  complete: async ({ prompt }) => ({ text: `echo: ${prompt.length}` }),
};

const wraith = createWraith({ ai: { provider: 'custom', model: myProvider.model, complete: (req) => myProvider.complete(req) } });
```

`createProvider(options)`, `createAnthropicProvider`, `createOpenAIProvider` and `createOllamaProvider` build the built-in providers directly, if you want to call a model outside a page.
