import { vi } from "vitest";

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

export interface MockRequest {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export type Handler = (req: MockRequest) => Response | Promise<Response>;

/** Build a JSON `Response`, mirroring how a real provider would reply. */
export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...init.headers,
  };
  const payload = body === undefined ? "" : JSON.stringify(body);
  return new Response(payload, { status, headers });
}

/**
 * A `fetch` replacement that routes requests through `handler` and records
 * every call for assertions. No real network is touched.
 */
export function mockFetch(handler: Handler): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  const impl = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const url = new URL(rawUrl);
    const method = (init?.method ?? "GET").toUpperCase();

    let body: unknown;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }

    const req: MockRequest = {
      method,
      url: rawUrl,
      path: url.pathname,
      query: url.searchParams,
      body,
    };
    calls.push({ ...req, headers });
    return handler(req);
  });

  return { fetch: impl as unknown as typeof fetch, calls };
}
