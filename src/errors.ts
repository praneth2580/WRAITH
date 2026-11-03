/** Base class for every error wraith throws. */
export class WraithError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A response kept failing with a status worth retrying (408, 425, 429 or 5xx) until retries ran out. */
export class HttpError extends WraithError {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** The site's robots.txt disallows the URL and `network.respectRobotsTxt` is on. */
export class RobotsDisallowedError extends WraithError {
  constructor(readonly url: string) {
    super(`robots.txt disallows ${url}`);
  }
}

/** An AI provider failed, refused, or replied with something that doesn't fit the schema. */
export class AIError extends WraithError {}

/** A wait ran out of time. */
export class WaitTimeoutError extends WraithError {}

/** A CAPTCHA or verification step couldn't be handed to a person, or wasn't solved in time. */
export class ChallengeError extends WraithError {}

/** An optional package (such as an AI SDK) is needed but not installed. */
export class MissingDependencyError extends WraithError {
  constructor(
    readonly packageName: string,
    feature: string,
  ) {
    super(`${feature} needs the "${packageName}" package. Install it with: npm install ${packageName}`);
  }
}
