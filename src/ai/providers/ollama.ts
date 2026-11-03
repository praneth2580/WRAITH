import { z } from 'zod';
import { AIError } from '../../errors.js';
import type { AIProvider, OllamaOptions } from '../types.js';

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
}

/** A local model served by Ollama, through its REST API. No extra package needed. */
export function createOllamaProvider(options: OllamaOptions): AIProvider {
  let host = (options.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/+$/, '');
  // OLLAMA_HOST is often written without a scheme, e.g. "127.0.0.1:11434".
  if (!/^https?:\/\//.test(host)) host = `http://${host}`;

  return {
    name: 'ollama',
    model: options.model,
    async complete(request) {
      let response: Response;
      try {
        response = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: options.model,
            stream: false,
            messages: [
              ...(request.system ? [{ role: 'system', content: request.system }] : []),
              { role: 'user', content: request.prompt },
            ],
            ...(request.schema ? { format: z.toJSONSchema(request.schema) } : {}),
            options: {
              num_ctx: options.numCtx ?? 16384,
              temperature: 0,
              ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
            },
          }),
        });
      } catch (error) {
        throw new AIError(`Could not reach Ollama at ${host}. Is it running? Start it with "ollama serve".`, {
          cause: error,
        });
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const hint = response.status === 404 ? ` Pull the model first: ollama pull ${options.model}` : '';
        throw new AIError(`Ollama returned ${response.status}: ${detail}${hint}`);
      }
      const body = (await response.json()) as OllamaChatResponse;
      if (body.done_reason === 'length') {
        throw new AIError('The reply was cut off by the token limit. Narrow the content or raise numCtx.');
      }
      return { text: body.message?.content ?? '' };
    },
  };
}
