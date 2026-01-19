import { describe, it, expect } from "vitest";
import { createVoiceClient, type VoiceClient } from "../src/index.js";
import { jsonResponse, mockFetch, type MockRequest } from "./helpers.js";

const VAPI_ASSISTANT = {
  id: "asst_1",
  name: "Receptionist",
  firstMessage: "Hello!",
  model: { provider: "openai", model: "gpt-4o", messages: [{ role: "system", content: "Be nice." }] },
  voice: { provider: "11labs", voiceId: "burt" },
  transcriber: { language: "en" },
  metadata: { team: "support" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const VAPI_CALL = {
  id: "call_1",
  assistantId: "asst_1",
  type: "outboundPhoneCall",
  status: "ended",
  customer: { number: "+15550000001" },
  phoneNumber: { number: "+15550000099" },
  createdAt: "2026-01-03T00:00:00.000Z",
  startedAt: "2026-01-03T00:00:01.000Z",
  endedAt: "2026-01-03T00:01:00.000Z",
  artifact: { recordingUrl: "https://rec/1.mp3", transcript: "hi there" },
};

const VAPI_PHONE = {
  id: "pn_1",
  number: "+15550000099",
  name: "Main line",
  assistantId: "asst_1",
  provider: "twilio",
};

function build(handler: (req: MockRequest) => Response): {
  client: VoiceClient;
  calls: ReturnType<typeof mockFetch>["calls"];
} {
  const { fetch, calls } = mockFetch(handler);
  const client = createVoiceClient({ provider: "vapi", apiKey: "sk_test", fetch });
  return { client, calls };
}

describe("vapi adapter", () => {
  it("creates an agent and maps the response", async () => {
    const { client, calls } = build(() => jsonResponse(VAPI_ASSISTANT));
    const agent = await client.agents.create({
      name: "Receptionist",
      systemPrompt: "Be nice.",
      firstMessage: "Hello!",
      voice: "burt",
      model: "gpt-4o",
    });

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toBe("/assistant");
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.name).toBe("Receptionist");
    expect((body.model as Record<string, unknown>).model).toBe("gpt-4o");

    expect(agent.id).toBe("asst_1");
    expect(agent.provider).toBe("vapi");
    expect(agent.systemPrompt).toBe("Be nice.");
    expect(agent.firstMessage).toBe("Hello!");
    expect(agent.voice).toBe("burt");
    expect(agent.model).toBe("gpt-4o");
    expect(agent.language).toBe("en");
    expect(agent.metadata).toEqual({ team: "support" });
  });

  it("gets an agent by id", async () => {
    const { client, calls } = build(() => jsonResponse(VAPI_ASSISTANT));
    const agent = await client.agents.get("asst_1");
    expect(calls[0]?.path).toBe("/assistant/asst_1");
    expect(agent.name).toBe("Receptionist");
  });

  it("lists agents", async () => {
    const { client, calls } = build(() => jsonResponse([VAPI_ASSISTANT]));
    const page = await client.agents.list({ limit: 10 });
    expect(calls[0]?.query.get("limit")).toBe("10");
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.id).toBe("asst_1");
    expect(page.hasMore).toBe(false);
  });

  it("updates an agent via PATCH", async () => {
    const { client, calls } = build(() => jsonResponse({ ...VAPI_ASSISTANT, name: "New" }));
    const agent = await client.agents.update("asst_1", { name: "New" });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.path).toBe("/assistant/asst_1");
    expect(agent.name).toBe("New");
  });

  it("removes an agent via DELETE", async () => {
    const { client, calls } = build(() => jsonResponse(undefined, { status: 200 }));
    await client.agents.remove("asst_1");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.path).toBe("/assistant/asst_1");
  });

  it("creates and maps a call", async () => {
    const { client, calls } = build(() => jsonResponse(VAPI_CALL));
    const call = await client.calls.create({ agentId: "asst_1", to: "+15550000001" });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.assistantId).toBe("asst_1");
    expect((body.customer as Record<string, unknown>).number).toBe("+15550000001");

    expect(call.status).toBe("completed");
    expect(call.direction).toBe("outbound");
    expect(call.to).toBe("+15550000001");
    expect(call.from).toBe("+15550000099");
    expect(call.recordingUrl).toBe("https://rec/1.mp3");
    expect(call.transcript).toBe("hi there");
  });

  it("lists and maps phone numbers", async () => {
    const { client } = build(() => jsonResponse([VAPI_PHONE]));
    const page = await client.phoneNumbers.list();
    expect(page.data[0]?.number).toBe("+15550000099");
    expect(page.data[0]?.agentId).toBe("asst_1");
    expect(page.data[0]?.name).toBe("Main line");
  });

  it("creates a phone number mapping agentId to assistantId", async () => {
    const { client, calls } = build(() => jsonResponse(VAPI_PHONE));
    await client.phoneNumbers.create({ number: "+15550000099", agentId: "asst_1", name: "Main line" });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.assistantId).toBe("asst_1");
    expect(body.number).toBe("+15550000099");
  });
});
