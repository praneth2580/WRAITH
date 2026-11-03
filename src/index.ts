export { Wraith, createWraith, type FetchOptions, type NewPageOptions } from './wraith.js';
export type {
  WraithOptions,
  NetworkOptions,
  RateLimitOptions,
  HumanOption,
  ResourceType,
  DeepPartial,
} from './config.js';
export {
  WraithPage,
  type Target,
  type GotoOptions,
  type ScrollOptions,
  type AutoScrollOptions,
  type ReadOptions,
} from './page.js';
export { StaticPage } from './static-page.js';
export type { CrawlOptions, CrawlContext, CrawlResult, UrlFilter } from './crawl.js';

export { Humanizer, type ClickOptions, type TypeOptions } from './human/humanizer.js';
export { humanPresets, type HumanBehavior, type HumanPreset } from './human/behavior.js';
export { createRng, sleep, type Rng, type Range } from './human/random.js';
export { humanPath, pointInBox, type Point, type Box, type TimedPoint } from './human/mouse.js';

export {
  extractHtml,
  type SelectorSchema,
  type FieldSpec,
  type ValueField,
  type NestedField,
  type InferSchema,
} from './extract/schema.js';
export { htmlToMarkdown, htmlToText } from './extract/content.js';

export { AIClient, ContentAI, type ExtractOptions, type PageContent } from './ai/client.js';
export { PageAI, type ActOptions, type ActResult, type ActStep } from './ai/act.js';
export {
  createProvider,
  createAnthropicProvider,
  createOpenAIProvider,
  createOllamaProvider,
} from './ai/providers/index.js';
export type {
  AIOptions,
  AIProvider,
  AIRequest,
  AIResponse,
  AnthropicOptions,
  OpenAIOptions,
  OllamaOptions,
  CustomAIOptions,
} from './ai/types.js';

export { WraithError, HttpError, RobotsDisallowedError, AIError, MissingDependencyError } from './errors.js';
export { consoleLogger, silentLogger, type Logger } from './logger.js';

/** Re-exported so your schemas use the same zod instance wraith does. */
export { z } from 'zod';
