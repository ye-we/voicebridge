import { describe, it, expect } from "vitest";
import { createVoiceClient, type VoiceClient } from "../src/index.js";
import { jsonResponse, mockFetch, type MockRequest } from "./helpers.js";

const RETELL_AGENT = {
  agent_id: "agent_1",
  agent_name: "Booker",
  voice_id: "11labs-Adrian",
  language: "en-US",
  general_prompt: "Book appointments.",
  begin_message: "Hi, how can I help?",
  last_modification_timestamp: 1767225600000, // 2026-01-01T00:00:00.000Z
};

const RETELL_CALL = {
  call_id: "call_abc",
  agent_id: "agent_1",
  call_status: "ended",
  direction: "inbound",
  from_number: "+15551112222",
  to_number: "+15553334444",
  start_timestamp: 1767225600000,
  end_timestamp: 1767225660000,
  recording_url: "https://rec/abc.wav",
  transcript: "User: hi",
};

const RETELL_PHONE = {
  phone_number: "+15553334444",
  phone_number_pretty: "(555) 333-4444",
  nickname: "Support",
  inbound_agent_id: "agent_1",
};

function build(handler: (req: MockRequest) => Response): {
  client: VoiceClient;
  calls: ReturnType<typeof mockFetch>["calls"];
} {
  const { fetch, calls } = mockFetch(handler);
  const client = createVoiceClient({ provider: "retell", apiKey: "key_test", fetch });
  return { client, calls };
}

describe("retell adapter", () => {
  it("creates an agent and maps the response", async () => {
    const { client, calls } = build(() => jsonResponse(RETELL_AGENT));
    const agent = await client.agents.create({
      name: "Booker",
      systemPrompt: "Book appointments.",
      firstMessage: "Hi, how can I help?",
      voice: "11labs-Adrian",
      language: "en-US",
    });

    expect(calls[0]?.path).toBe("/create-agent");
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.agent_name).toBe("Booker");
    expect(body.general_prompt).toBe("Book appointments.");
    expect(body.begin_message).toBe("Hi, how can I help?");

    expect(agent.id).toBe("agent_1");
    expect(agent.provider).toBe("retell");
    expect(agent.systemPrompt).toBe("Book appointments.");
    expect(agent.voice).toBe("11labs-Adrian");
    expect(agent.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("gets an agent by id", async () => {
    const { client, calls } = build(() => jsonResponse(RETELL_AGENT));
    const agent = await client.agents.get("agent_1");
    expect(calls[0]?.path).toBe("/get-agent/agent_1");
    expect(agent.name).toBe("Booker");
  });

  it("lists agents via /list-agents", async () => {
    const { client, calls } = build(() => jsonResponse([RETELL_AGENT]));
    const page = await client.agents.list();
    expect(calls[0]?.path).toBe("/list-agents");
    expect(page.data).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  it("creates a call mapping agentId to override_agent_id", async () => {
    const { client, calls } = build(() => jsonResponse(RETELL_CALL));
    const call = await client.calls.create({
      agentId: "agent_1",
      from: "+15551112222",
      to: "+15553334444",
    });
    expect(calls[0]?.path).toBe("/v2/create-phone-call");
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.override_agent_id).toBe("agent_1");
    expect(body.from_number).toBe("+15551112222");

    expect(call.status).toBe("completed");
    expect(call.direction).toBe("inbound");
    expect(call.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(call.endedAt).toBe("2026-01-01T00:01:00.000Z");
    expect(call.recordingUrl).toBe("https://rec/abc.wav");
  });

  it("lists calls via POST /v2/list-calls", async () => {
    const { client, calls } = build(() => jsonResponse([RETELL_CALL]));
    const page = await client.calls.list({ limit: 50 });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toBe("/v2/list-calls");
    expect((calls[0]?.body as Record<string, unknown>).limit).toBe(50);
    expect(page.data[0]?.id).toBe("call_abc");
  });

  it("maps phone numbers using the number as id", async () => {
    const { client } = build(() => jsonResponse([RETELL_PHONE]));
    const page = await client.phoneNumbers.list();
    expect(page.data[0]?.id).toBe("+15553334444");
    expect(page.data[0]?.number).toBe("+15553334444");
    expect(page.data[0]?.name).toBe("Support");
    expect(page.data[0]?.agentId).toBe("agent_1");
  });

  it("exposes knowledge bases as a provider extra", async () => {
    const { client, calls } = build(() =>
      jsonResponse([{ knowledge_base_id: "kb_1", knowledge_base_name: "FAQ", status: "complete" }]),
    );
    const extras = client.extras as {
      knowledgeBases: { list: () => Promise<Array<{ knowledge_base_id: string }>> };
    };
    const kbs = await extras.knowledgeBases.list();
    expect(calls[0]?.path).toBe("/list-knowledge-bases");
    expect(kbs[0]?.knowledge_base_id).toBe("kb_1");
  });
});
