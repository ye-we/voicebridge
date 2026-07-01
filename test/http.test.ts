import { describe, it, expect } from "vitest";
import { HttpClient, ProviderError } from "../src/index.js";
import { jsonResponse } from "./helpers.js";

const BASE = { baseUrl: "https://api.test", apiKey: "k", provider: "test" };

/** A `fetch` that never resolves on its own — it only rejects when aborted. */
function hangingFetch(): typeof fetch {
  return ((_url: string | URL, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }
    })) as unknown as typeof fetch;
}

describe("HttpClient timeouts", () => {
  it("aborts a request that exceeds timeoutMs and throws a ProviderError", async () => {
    const http = new HttpClient({
      ...BASE,
      fetchImpl: hangingFetch(),
      timeoutMs: 20,
      maxRetries: 0,
    });

    const err = await http.get("/thing").catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toMatch(/timed out after 20ms/);
  });

  it("retries after a timeout, then succeeds", async () => {
    let attempts = 0;
    const fetchImpl = ((_url: string | URL, init?: RequestInit) => {
      attempts += 1;
      if (attempts === 1) {
        // First attempt hangs until the timeout aborts it.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    }) as unknown as typeof fetch;

    const http = new HttpClient({
      ...BASE,
      fetchImpl,
      timeoutMs: 20,
      maxRetries: 1,
      backoffBaseMs: 0,
    });

    const result = await http.get<{ ok: boolean }>("/thing");
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it("does not time out a request that completes in time", async () => {
    const http = new HttpClient({
      ...BASE,
      fetchImpl: (() => Promise.resolve(jsonResponse({ ok: true }))) as unknown as typeof fetch,
      timeoutMs: 1000,
    });

    await expect(http.get("/thing")).resolves.toEqual({ ok: true });
  });

  it("has no timeout by default", async () => {
    // A slow-but-eventual response resolves when no timeout is configured.
    const fetchImpl = (() =>
      new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse({ ok: true })), 30);
      })) as unknown as typeof fetch;

    const http = new HttpClient({ ...BASE, fetchImpl });
    await expect(http.get("/thing")).resolves.toEqual({ ok: true });
  });

  it("lets a per-request timeoutMs override the client default", async () => {
    // No client-level timeout, but the request opts into a tiny one.
    const http = new HttpClient({ ...BASE, fetchImpl: hangingFetch(), maxRetries: 0 });

    const err = await http.get("/thing", { timeoutMs: 15 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toMatch(/timed out after 15ms/);
  });
});
