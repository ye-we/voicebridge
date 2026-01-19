import { describe, it, expect, afterEach } from "vitest";
import {
  createVoiceClient,
  registerProvider,
  unregisterProvider,
  hasProvider,
  listProviders,
  ValidationError,
  type ProviderFactory,
} from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

describe("createVoiceClient", () => {
  afterEach(() => {
    unregisterProvider("dummy");
  });

  it("creates a client for a built-in provider", () => {
    const { fetch } = mockFetch(() => jsonResponse([]));
    const client = createVoiceClient({ provider: "vapi", apiKey: "sk_test", fetch });
    expect(client.provider).toBe("vapi");
    expect(typeof client.agents.create).toBe("function");
    expect(typeof client.calls.list).toBe("function");
    expect(typeof client.phoneNumbers.get).toBe("function");
  });

  it("is case-insensitive on provider name", () => {
    const { fetch } = mockFetch(() => jsonResponse([]));
    const client = createVoiceClient({ provider: "ReTeLL", apiKey: "key", fetch });
    expect(client.provider).toBe("retell");
  });

  it("throws ValidationError for an empty apiKey", () => {
    expect(() => createVoiceClient({ provider: "vapi", apiKey: "" })).toThrow(ValidationError);
  });

  it("throws ValidationError for an unknown provider", () => {
    expect(() => createVoiceClient({ provider: "nope", apiKey: "key" })).toThrow(
      /Unknown provider/,
    );
  });

  it("lists built-in providers", () => {
    expect(listProviders()).toEqual(expect.arrayContaining(["retell", "vapi"]));
  });

  it("injects the Bearer auth header on requests", async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse([]));
    const client = createVoiceClient({ provider: "vapi", apiKey: "sk_live_123", fetch });
    await client.agents.list();
    expect(calls[0]?.headers["authorization"]).toBe("Bearer sk_live_123");
  });

  it("supports registering and using a custom provider", async () => {
    const dummyFactory: ProviderFactory = (ctx) => ({
      name: "dummy",
      agents: {
        async create() {
          return { id: "a1", provider: "dummy", name: "Custom", raw: {} };
        },
        async list() {
          await ctx.http.get("/whatever").catch(() => undefined);
          return {
            data: [],
            hasMore: false,
            nextCursor: null,
            async *iterateAll() {},
          };
        },
        async get() {
          return { id: "a1", provider: "dummy", name: "Custom", raw: {} };
        },
        async update() {
          return { id: "a1", provider: "dummy", name: "Custom", raw: {} };
        },
        async remove() {},
      },
      calls: {
        async create() {
          return { id: "c1", provider: "dummy", status: "queued", raw: {} };
        },
        async list() {
          return { data: [], hasMore: false, nextCursor: null, async *iterateAll() {} };
        },
        async get() {
          return { id: "c1", provider: "dummy", status: "queued", raw: {} };
        },
      },
      phoneNumbers: {
        async list() {
          return { data: [], hasMore: false, nextCursor: null, async *iterateAll() {} };
        },
        async get() {
          return { id: "p1", provider: "dummy", number: "+1", raw: {} };
        },
        async create() {
          return { id: "p1", provider: "dummy", number: "+1", raw: {} };
        },
      },
    });

    registerProvider("dummy", dummyFactory);
    expect(hasProvider("dummy")).toBe(true);

    const { fetch } = mockFetch(() => jsonResponse({}));
    const client = createVoiceClient({
      provider: "dummy",
      apiKey: "key",
      baseUrl: "https://example.test",
      fetch,
    });
    const agent = await client.agents.create({ name: "Custom" });
    expect(agent.id).toBe("a1");
    expect(client.provider).toBe("dummy");
  });

  it("requires a baseUrl for custom providers", () => {
    registerProvider("dummy", (() => {
      throw new Error("factory should not be called");
    }) as unknown as ProviderFactory);
    expect(() => createVoiceClient({ provider: "dummy", apiKey: "key" })).toThrow(
      /No baseUrl configured/,
    );
  });
});
