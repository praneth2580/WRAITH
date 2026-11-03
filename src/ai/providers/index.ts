import { WraithError } from '../../errors.js';
import type { AIOptions, AIProvider } from '../types.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOllamaProvider } from './ollama.js';
import { createOpenAIProvider } from './openai.js';

export { createAnthropicProvider, createOllamaProvider, createOpenAIProvider };

export async function createProvider(options: AIOptions): Promise<AIProvider> {
  switch (options.provider) {
    case 'anthropic':
      return createAnthropicProvider(options);
    case 'openai':
      return createOpenAIProvider(options);
    case 'ollama':
      return createOllamaProvider(options);
    case 'custom':
      return {
        name: 'custom',
        model: options.model ?? 'custom',
        strictJson: options.strictJson ?? false,
        async complete(request) {
          const reply = await options.complete(request);
          return typeof reply === 'string' ? { text: reply } : reply;
        },
      };
    default:
      throw new WraithError(`Unknown AI provider "${(options as { provider: unknown }).provider}"`);
  }
}
