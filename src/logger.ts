export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

const noop = () => {};

export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };

export const consoleLogger: Logger = {
  debug: (message, ...meta) => console.debug(`[wraith] ${message}`, ...meta),
  info: (message, ...meta) => console.info(`[wraith] ${message}`, ...meta),
  warn: (message, ...meta) => console.warn(`[wraith] ${message}`, ...meta),
  error: (message, ...meta) => console.error(`[wraith] ${message}`, ...meta),
};

/** `true` logs to the console; a Logger is used as is; otherwise silent unless WRAITH_DEBUG is set. */
export function resolveLogger(option: Logger | boolean | undefined): Logger {
  if (typeof option === 'object') return option;
  if (option === true) return consoleLogger;
  if (option === undefined && process.env.WRAITH_DEBUG) return consoleLogger;
  return silentLogger;
}
