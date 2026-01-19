/**
 * Tiny fetch wrapper used by every provider adapter.
 *
 * Responsibilities:
 *  - inject auth headers
 *  - serialize query/body and parse JSON responses
 *  - translate non-2xx responses into the typed error hierarchy
 *  - retry 429 / 5xx with exponential backoff (honouring Retry-After)
 */

import { z } from "zod";
import { errorFromStatus, ProviderError, ValidationError, VoiceBridgeError } from "./errors.js";
import type { Page } from "./types.js";

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip retries for this call (e.g. non-idempotent edge cases). */
  noRetry?: boolean;
}

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  provider: string;
  /** Build auth headers from the api key. Defaults to Bearer auth. */
  authHeader?: (apiKey: string) => Record<string, string>;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Base backoff in ms (doubled each attempt). Default 300ms. */
  backoffBaseMs?: number;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 300;

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly provider: string;
  private readonly authHeader: (apiKey: string) => Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(options: HttpClientOptions) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new ProviderError(
        "global fetch is not available. Use Node 18+ or pass a custom fetch implementation.",
        { provider: options.provider },
      );
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.provider = options.provider;
    this.authHeader = options.authHeader ?? ((key) => ({ Authorization: `Bearer ${key}` }));
    this.fetchImpl = fetchImpl;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_MS;
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  patch<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("PATCH", path, options);
  }

  put<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.authHeader(this.apiKey),
      ...options.headers,
    };

    let bodyInit: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(options.body);
    }

    const maxAttempts = options.noRetry ? 1 : this.maxRetries + 1;
    let lastError: VoiceBridgeError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { method, headers, body: bodyInit });
      } catch (cause) {
        // Network-level failure (DNS, socket, etc.). Retry like a 5xx.
        lastError = new ProviderError("Network request failed", {
          provider: this.provider,
          cause,
        });
        if (attempt < maxAttempts) {
          await sleep(this.backoffDelay(attempt));
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return (await parseBody(response)) as T;
      }

      const raw = await parseBody(response);
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const error = errorFromStatus({
        status: response.status,
        provider: this.provider,
        raw,
        retryAfter,
      });

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxAttempts) {
        lastError = error;
        const wait = retryAfter !== undefined ? retryAfter * 1000 : this.backoffDelay(attempt);
        await sleep(wait);
        continue;
      }
      throw error;
    }

    // Exhausted retries.
    throw lastError ?? new ProviderError("Request failed", { provider: this.provider });
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private backoffDelay(attempt: number): number {
    // Exponential backoff with light jitter.
    const exp = this.backoffBaseMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * this.backoffBaseMs);
    return exp + jitter;
  }
}

/** Parse a response body as JSON, falling back to text, then undefined. */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;
  // HTTP-date form.
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000));
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Shared helpers used by adapters                                            */
/* -------------------------------------------------------------------------- */

/**
 * Validate input against a zod schema, throwing a typed `ValidationError`
 * with structured issues on failure.
 */
export function parseInput<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  provider?: string,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    const summary = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
    throw new ValidationError(`Invalid input — ${summary}`, { provider, issues });
  }
  return result.data;
}

/**
 * Build a `Page<T>` with a working `iterateAll()` async generator. The
 * `fetchNext` callback is invoked with the cursor to load each subsequent page.
 */
export function makePage<T>(args: {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
  fetchNext: (cursor: string) => Promise<Page<T>>;
}): Page<T> {
  const page: Page<T> = {
    data: args.data,
    hasMore: args.hasMore,
    nextCursor: args.nextCursor,
    async *iterateAll(): AsyncGenerator<T, void, unknown> {
      let current: Page<T> = page;
      for (;;) {
        for (const item of current.data) {
          yield item;
        }
        if (!current.hasMore || current.nextCursor === null) break;
        current = await args.fetchNext(current.nextCursor);
      }
    },
  };
  return page;
}
