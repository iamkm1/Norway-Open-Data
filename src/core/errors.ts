/** Details attached to errors raised by the SDK. */
export type OpenDataErrorDetails = {
  provider?: string;
  statusCode?: number;
  retryAfter?: number;
  cause?: unknown;
};

/** Base class for all SDK errors. */
export class OpenDataError extends Error {
  readonly provider?: string;
  readonly statusCode?: number;
  readonly retryAfter?: number;
  override readonly cause?: unknown;

  constructor(message: string, details: OpenDataErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = new.target.name;
    this.provider = details.provider;
    this.statusCode = details.statusCode;
    this.retryAfter = details.retryAfter;
    this.cause = details.cause;
  }
}

/** Raised when SDK or provider identification configuration is invalid. */
export class ConfigurationError extends OpenDataError {}

/** Raised before a request when caller input is invalid. */
export class InputValidationError extends OpenDataError {}

/** Raised when a provider returns HTTP 404. */
export class NotFoundError extends OpenDataError {}

/** Raised when a provider's rate limit remains exhausted after retries. */
export class RateLimitError extends OpenDataError {}

/** Raised for provider HTTP, network, or GraphQL failures. */
export class ProviderError extends OpenDataError {}

/** Raised when the configured request timeout expires. */
export class RequestTimeoutError extends OpenDataError {}

/** Raised when a provider returns JSON that does not match its runtime schema. */
export class ResponseValidationError extends OpenDataError {}
