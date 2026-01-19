import { describe, it, expect } from "vitest";
import { createVoiceClient, makePage } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

describe("pagination", () => {
  it("iterateAll walks every page transparently (vapi agents)", async () => {
    const pageOne = [
      { id: "a1", name: "One", createdAt: "2026-01-03T00:00:00.000Z" },
      { id: "a2", name: "Two", createdAt: "2026-01-02T00:00:00.000Z" },
    ];
    const pageTwo = [{ id: "a3", name: "Three", createdAt: "2026-01-01T00:00:00.000Z" }];

    const { fetch, calls } = mockFetch((req) => {
      const cursor = req.query.get("createdAtLt");
      return jsonResponse(cursor ? pageTwo : pageOne);
    });
    const client = createVoiceClient({ provider: "vapi", apiKey: "k", fetch });

    const first = await client.agents.list({ limit: 2 });
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe("2026-01-02T00:00:00.000Z");

    const ids: string[] = [];
    for await (const agent of first.iterateAll()) {
      ids.push(agent.id);
    }
    expect(ids).toEqual(["a1", "a2", "a3"]);
    // page one + the next page fetched by iterateAll.
    expect(calls.length).toBe(2);
    expect(calls[1]?.query.get("createdAtLt")).toBe("2026-01-02T00:00:00.000Z");
  });

  it("stops cleanly on a single page", async () => {
    const { fetch } = mockFetch(() => jsonResponse([{ id: "a1", name: "Only" }]));
    const client = createVoiceClient({ provider: "vapi", apiKey: "k", fetch });
    const page = await client.agents.list({ limit: 50 });
    const collected: string[] = [];
    for await (const a of page.iterateAll()) collected.push(a.id);
    expect(collected).toEqual(["a1"]);
    expect(page.hasMore).toBe(false);
  });

  it("retell calls paginate by pagination_key", async () => {
    const first = [
      { call_id: "c1", call_status: "ended" },
      { call_id: "c2", call_status: "ended" },
    ];
    const second = [{ call_id: "c3", call_status: "ended" }];
    const { fetch, calls } = mockFetch((req) => {
      const key = (req.body as Record<string, unknown> | undefined)?.pagination_key;
      return jsonResponse(key ? second : first);
    });
    const client = createVoiceClient({ provider: "retell", apiKey: "k", fetch });

    const page = await client.calls.list({ limit: 2 });
    expect(page.nextCursor).toBe("c2");

    const ids: string[] = [];
    for await (const call of page.iterateAll()) ids.push(call.id);
    expect(ids).toEqual(["c1", "c2", "c3"]);
    expect((calls[1]?.body as Record<string, unknown>).pagination_key).toBe("c2");
  });

  it("makePage exposes data, cursor and an iterator", async () => {
    const page = makePage<number>({
      data: [1, 2],
      hasMore: false,
      nextCursor: null,
      fetchNext: async () => {
        throw new Error("should not fetch");
      },
    });
    const out: number[] = [];
    for await (const n of page.iterateAll()) out.push(n);
    expect(out).toEqual([1, 2]);
    expect(page.hasMore).toBe(false);
  });
});
