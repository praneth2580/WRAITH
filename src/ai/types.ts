import type { z } from 'zod';

export interface AIRequest {
  system?: string;
  prompt: string;
  /** When set, the reply must be JSON matching this schema. */
  schema?: z.ZodType;
  maxTokens?: number;
}

export interface AIResponse {
  /** The reply text. */
  text: string;
  /** The reply already parsed, for providers that parse structured output themselves. */
  data?: unknown;
}

/** Anything that can answer a prompt. Implement this to plug in a model wraith doesn't ship. */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /**
   * True when the provider guarantees replies match `request.schema` (constrained decoding).
   * Otherwise wraith also puts the schema in the prompt and checks the reply itself.
   */
  readonly strictJson?: boolean;
  complete(request: AIRequest): Promise<AIResponse>;
}

interface SharedAIOptions {
  /**
   * Refuse pages whose content is longer than this many characters, instead of sending them
   * cut short. Narrow big pages with `{ selector }`. Default depends on the provider.
   */
  maxInputChars?: number;
}

export interface AnthropicOptions extends SharedAIOptions {
  provider: 'anthropic';
  /** Default: the ANTHROPIC_API_KEY environment variable, or an `ant auth login` profile. */
  apiKey?: string;
  /** Default 'claude-opus-5-5'. */
  model?: string;
  /** How hard the model thinks. Lower is faster and cheaper. Default 'medium'. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * If the model declines a request, re-run it on Anthropic's recommended fallback model.
   * Default true, on models that support it.
   */
  fallbacks?: boolean;
  baseURL?: string;
}

export interface OpenAIOptions extends SharedAIOptions {
  provider: 'openai';
  model: string;
  /** Default: the OPENAI_API_KEY environment variable. Local servers usually don't need one. */
  apiKey?: string;
  /**
   * Any OpenAI-compatible server: LM Studio (http://localhost:1234/v1), llama.cpp, vLLM,
   * OpenRouter, Groq…
   */
  baseURL?: string;
  /** How to ask for JSON. 'json_schema' (default) needs server support; 'json_object' works almost everywhere. */
  jsonMode?: 'json_schema' | 'json_object';
}

export interface OllamaOptions extends SharedAIOptions {
  provider: 'ollama';
  /** A model you have pulled, such as 'qwen2.5:7b' or 'llama3.1'. */
  model: string;
  /** Default: the OLLAMA_HOST environment variable, or http://localhost:11434. */
  host?: string;
  /** Context window in tokens. Ollama's own default is too small for most pages. Default 16384. */
  numCtx?: number;
}

export interface CustomAIOptions extends SharedAIOptions {
  provider: 'custom';
  model?: string;
  /** Return the reply text, or `{ text, data }` if you parsed it already. */
  complete: (request: AIRequest) => Promise<AIResponse | string>;
  strictJson?: boolean;
}

export type AIOptions = AnthropicOptions | OpenAIOptions | OllamaOptions | CustomAIOptions;
