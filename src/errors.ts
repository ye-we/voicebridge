/**
 * Typed error hierarchy for VoiceBridge.
 *
 * Every error carries the originating `provider`, the HTTP `status` (when the
 * error came from a network call) and the `raw` payload returned by the
 * provider so callers can inspect provider-specific details.
 */

export interface VoiceBridgeErrorOptions {
  status?: number;
  provider?: string;
  raw?: unknown;
  cause?: unknown;
}

/** Base class for every error thrown by the SDK. */
export class VoiceBridgeError extends Error {
  readonly status?: number;
  readonly provider?: string;
  readonly raw?: unknown;

  constructor(message: string, options: VoiceBridgeErrorOptions = {}) {
    super(message);
    this.name = "VoiceBridgeError";
    this.status = options.status;
    this.provider = options.provider;
    this.raw = options.raw;
    if (options.cause !== undefined) {
      // `cause` is supported on Error in Node 18+.
      (this as { cause?: unknown }).cause = options.cause;
    }
    // Restore prototype chain when targeting ES5-ish runtimes / transpilers.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 / 403 — bad or missing credentials. */
export class AuthError extends VoiceBridgeError {
  constructor(message: string, options: VoiceBridgeErrorOptions = {}) {
    super(message, options);
    this.name = "AuthError";
  }
}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends VoiceBridgeError {
  constructor(message: string, options: VoiceBridgeErrorOptions = {}) {
    super(message, options);
    this.name = "NotFoundError";
  }
}

/** 422 / client-side schema failures — invalid input. */
export class ValidationError extends VoiceBridgeError {
  /** Structured field issues when the failure came from input validation. */
  readonly issues?: ReadonlyArray<{ path: string; message: string }>;

  constructor(
    message: string,
    options: VoiceBridgeErrorOptions & {
      issues?: ReadonlyArray<{ path: string; message: string }>;
    } = {},
  ) {
    super(message, options);
    this.name = "ValidationError";
    this.issues = options.issues;
  }
}

/** 429 — too many requests. */
export class RateLimitError extends VoiceBridgeError {
  /** Seconds to wait before retrying, parsed from the `Retry-After` header. */
  readonly retryAfter?: number;

  constructor(
    message: string,
    options: VoiceBridgeErrorOptions & { retryAfter?: number } = {},
  ) {
    super(message, options);
    this.name = "RateLimitError";
    this.retryAfter = options.retryAfter;
  }
}

/** Any other non-2xx response (5xx, unexpected 4xx, etc.). */
export class ProviderError extends VoiceBridgeError {
  constructor(message: string, options: VoiceBridgeErrorOptions = {}) {
    super(message, options);
    this.name = "ProviderError";
  }
}

/**
 * Map an HTTP status code to the matching typed error.
 * Used by the fetch wrapper to translate provider responses.
 */
export function errorFromStatus(args: {
  status: number;
  provider: string;
  raw: unknown;
  message?: string;
  retryAfter?: number;
}): VoiceBridgeError {
  const { status, provider, raw, retryAfter } = args;
  const message = args.message ?? extractMessage(raw) ?? `Request failed with status ${status}`;
  const base: VoiceBridgeErrorOptions = { status, provider, raw };

  if (status === 401 || status === 403) {
    return new AuthError(message, base);
  }
  if (status === 404) {
    return new NotFoundError(message, base);
  }
  if (status === 422 || status === 400) {
    return new ValidationError(message, base);
  }
  if (status === 429) {
    return new RateLimitError(message, { ...base, retryAfter });
  }
  return new ProviderError(message, base);
}

/** Best-effort extraction of a human-readable message from a provider payload. */
function extractMessage(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.message ?? obj.error ?? obj.detail ?? obj.error_message;
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = (candidate as Record<string, unknown>).message;
      if (typeof nested === "string") return nested;
    }
  }
  return undefined;
}
