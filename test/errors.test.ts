import { describe, it, expect } from "vitest";
import {
  createVoiceClient,
  HttpClient,
  AuthError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  ProviderError,
} from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

function clientWith(handler: () => Response) {
  const { fetch, calls } = mockFetch(handler);
  const client = createVoiceClient({
    provider: "vapi",
    apiKey: "sk_test",
    fetch,
    maxRetries: 0,
  });
  return { client, calls };
}

describe("error mapping", () => {
  it("maps 401 to AuthError", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ message: "Invalid key" }, { status: 401 }),
    );
    await expect(client.agents.get("x")).rejects.toMatchObject({
      name: "AuthError",
      status: 401,
      provider: "vapi",
    });
    await expect(client.agents.get("x")).rejects.toBeInstanceOf(AuthError);
  });

  it("maps 403 to AuthError", async () => {
    const { client } = clientWith(() => jsonResponse({ error: "Forbidden" }, { status: 403 }));
    await expect(client.agents.get("x")).rejects.toBeInstanceOf(AuthError);
  });

  it("maps 404 to NotFoundError and extracts the message", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ message: "Assistant not found" }, { status: 404 }),
    );
    const err = await client.agents.get("missing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
    expect((err as NotFoundError).message).toBe("Assistant not found");
  });

  it("maps 400/422 to ValidationError", async () => {
    const { client } = clientWith(() => jsonResponse({ message: "bad" }, { status: 422 }));
    await expect(client.agents.get("x")).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps 429 to RateLimitError with retryAfter", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ message: "slow down" }, { status: 429, headers: { "retry-after": "7" } }),
    );
    const err = await client.agents.get("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(7);
  });

  it("maps 500 to ProviderError when retries are exhausted", async () => {
    const { client } = clientWith(() => jsonResponse({ message: "boom" }, { status: 500 }));
    await expect(client.agents.get("x")).rejects.toBeInstanceOf(ProviderError);
  });

  it("throws ValidationError with issues on invalid input (no network call)", async () => {
    const { client, calls } = clientWith(() => jsonResponse({}));
    const err = await client.agents.create({ name: "" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).issues?.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it("retries 429 then succeeds", async () => {
    let attempts = 0;
    const { fetch } = mockFetch(() => {
      attempts += 1;
      if (attempts < 3) return jsonResponse({ message: "slow" }, { status: 429 });
      return jsonResponse([{ id: "asst_1", name: "ok" }]);
    });
    const http = new HttpClient({
      baseUrl: "https://api.vapi.ai",
      apiKey: "k",
      provider: "vapi",
      fetchImpl: fetch,
      maxRetries: 3,
      backoffBaseMs: 0,
    });
    const rows = await http.get<Array<{ id: string }>>("/assistant");
    expect(attempts).toBe(3);
    expect(rows[0]?.id).toBe("asst_1");
  });

  it("retries 5xx then gives up after maxRetries", async () => {
    let attempts = 0;
    const { fetch } = mockFetch(() => {
      attempts += 1;
      return jsonResponse({ message: "down" }, { status: 503 });
    });
    const http = new HttpClient({
      baseUrl: "https://api.vapi.ai",
      apiKey: "k",
      provider: "vapi",
      fetchImpl: fetch,
      maxRetries: 2,
      backoffBaseMs: 0,
    });
    await expect(http.get("/assistant")).rejects.toBeInstanceOf(ProviderError);
    expect(attempts).toBe(3); // initial + 2 retries
  });
});
