export { Wraith, createWraith, type FetchOptions, type NewPageOptions, type StaticPaginateOptions } from './wraith.js';
export type {
  WraithOptions,
  NetworkOptions,
  RateLimitOptions,
  HumanOption,
  ResourceType,
  DeepPartial,
  WaitOptions,
} from './config.js';
export {
  WraithPage,
  type GotoOptions,
  type ScrollOptions,
  type AutoScrollOptions,
  type ReadOptions,
} from './page.js';
export { StaticPage } from './static-page.js';
export type { Target, TargetQuery } from './target.js';
export { waitUntil, DEFAULT_LOADERS, type AfterAction, type SettleOptions, type WaitUntilOptions } from './wait.js';
export { JsonCapture, type CapturedJson, type ResponseMatcher } from './capture.js';
export type { PaginateOptions } from './paginate.js';
export type { ConsentChoice, ConsentStatus } from './consent.js';
export type { Challenge, ChallengeHandler, ChallengeProvider, HandoffOptions } from './handoff.js';
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
export { jsonLdOfType, type StructuredData, type MicrodataItem } from './extract/structured.js';

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

export {
  WraithError,
  HttpError,
  RobotsDisallowedError,
  AIError,
  MissingDependencyError,
  WaitTimeoutError,
  ChallengeError,
} from './errors.js';
export { consoleLogger, silentLogger, type Logger } from './logger.js';

/** Re-exported so your schemas use the same zod instance wraith does. */
export { z } from 'zod';
