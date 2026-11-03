import type * as AnthropicSdk from '@anthropic-ai/sdk';
import type * as AnthropicZod from '@anthropic-ai/sdk/helpers/beta/zod';
import { AIError } from '../../errors.js';
import type { AIProvider, AnthropicOptions } from '../types.js';
import { importOptional } from './optional.js';

const DEFAULT_MODEL = 'claude-opus-5-5';

/** Models that accept `fallbacks: "default"` on the Claude API. */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export async function createAnthropicProvider(options: AnthropicOptions): Promise<AIProvider> {
  const feature = 'The "anthropic" AI provider';
  const { default: Anthropic } = await importOptional<typeof AnthropicSdk>('@anthropic-ai/sdk', feature);
  const { betaZodOutputFormat } = await importOptional<typeof AnthropicZod>('@anthropic-ai/sdk/helpers/beta/zod', feature);

  const client = new Anthropic({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });
  const model = options.model ?? DEFAULT_MODEL;
  // Server-side fallback is a Claude API feature; skip it behind a custom base URL (proxies, gateways).
  const fallbacks = (options.fallbacks ?? true) && FALLBACK_MODELS.has(model) && !options.baseURL;

  return {
    name: 'anthropic',
    model,
    strictJson: true,
    async complete(request) {
      const message = await client.beta.messages.parse({
        model,
        max_tokens: request.maxTokens ?? 16000,
        ...(request.system ? { system: request.system } : {}),
        messages: [{ role: 'user', content: request.prompt }],
        output_config: {
          effort: options.effort ?? 'medium',
          ...(request.schema ? { format: betaZodOutputFormat(request.schema) } : {}),
        },
        ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });

      if (message.stop_reason === 'refusal') {
        const category = message.stop_details?.category;
        throw new AIError(`Claude declined the request${category ? ` (category: ${category})` : ''}`);
      }
      if (message.stop_reason === 'max_tokens') {
        throw new AIError('The reply was cut off at max_tokens. Narrow the content or ask for less.');
      }
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return { text, data: message.parsed_output ?? undefined };
    },
  };
}
