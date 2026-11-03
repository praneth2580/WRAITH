import type * as OpenAISdk from 'openai';
import { z } from 'zod';
import { AIError } from '../../errors.js';
import type { AIProvider, OpenAIOptions } from '../types.js';
import { importOptional } from './optional.js';

/** OpenAI, or any server that speaks the OpenAI chat completions API. */
export async function createOpenAIProvider(options: OpenAIOptions): Promise<AIProvider> {
  const { default: OpenAI } = await importOptional<typeof OpenAISdk>('openai', 'The "openai" AI provider');
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const client = new OpenAI({
    // Local OpenAI-compatible servers ignore the key, but the SDK insists on one.
    apiKey: apiKey ?? (options.baseURL ? 'not-needed' : undefined),
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });

  return {
    name: 'openai',
    model: options.model,
    async complete(request) {
      const responseFormat = !request.schema
        ? undefined
        : options.jsonMode === 'json_object'
          ? { type: 'json_object' as const }
          : {
              type: 'json_schema' as const,
              json_schema: {
                name: 'response',
                schema: z.toJSONSchema(request.schema) as Record<string, unknown>,
                strict: false,
              },
            };

      const completion = await client.chat.completions.create({
        model: options.model,
        messages: [
          ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
          { role: 'user' as const, content: request.prompt },
        ],
        ...(request.maxTokens ? { max_completion_tokens: request.maxTokens } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
      });

      const choice = completion.choices[0];
      if (!choice) throw new AIError('The model returned no reply');
      if (choice.message.refusal) throw new AIError(`The model declined: ${choice.message.refusal}`);
      if (choice.finish_reason === 'length') {
        throw new AIError('The reply was cut off by the token limit. Narrow the content or ask for less.');
      }
      return { text: choice.message.content ?? '' };
    },
  };
}
