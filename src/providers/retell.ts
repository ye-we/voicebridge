/**
 * Retell adapter — maps the Retell AI REST API (https://api.retellai.com) onto
 * the unified VoiceBridge resource shapes.
 *
 * Retell uses Bearer auth, millisecond epoch timestamps, and a POST-based
 * `pagination_key` cursor for listing calls. The agent's `phone_number`
 * doubles as its id. Knowledge bases are exposed as a provider extra.
 */

import {
  createAgentInputSchema,
  createCallInputSchema,
  createPhoneNumberInputSchema,
  listParamsSchema,
  updateAgentInputSchema,
} from "../types.js";
import type {
  Agent,
  Call,
  CallStatus,
  CreateAgentInput,
  CreateCallInput,
  CreatePhoneNumberInput,
  ListParams,
  Page,
  PhoneNumber,
  ProviderContext,
  ProviderFactory,
  UpdateAgentInput,
  VoiceProvider,
} from "../types.js";
import { makePage, parseInput } from "../http.js";

export const RETELL_BASE_URL = "https://api.retellai.com";
const PROVIDER = "retell";
const DEFAULT_LIMIT = 100;
const DEFAULT_VOICE = "11labs-Adrian";
const DEFAULT_LANGUAGE = "en-US";

/* -------------------------------- raw shapes ------------------------------- */

interface RetellAgent {
  agent_id: string;
  agent_name?: string;
  voice_id?: string;
  language?: string;
  general_prompt?: string;
  begin_message?: string;
  metadata?: Record<string, unknown>;
  last_modification_timestamp?: number;
}

interface RetellCall {
  call_id: string;
  agent_id?: string;
  call_status?: string;
  direction?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  recording_url?: string;
  transcript?: string;
  metadata?: Record<string, unknown>;
}

interface RetellPhoneNumber {
  phone_number: string;
  phone_number_pretty?: string;
  nickname?: string;
  inbound_agent_id?: string;
  outbound_agent_id?: string;
  metadata?: Record<string, unknown>;
}

interface RetellKnowledgeBase {
  knowledge_base_id: string;
  knowledge_base_name?: string;
  status?: string;
}

/* -------------------------------- helpers --------------------------------- */

function msToIso(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function mapAgent(a: RetellAgent): Agent {
  const agent: Agent = {
    id: a.agent_id,
    provider: PROVIDER,
    name: a.agent_name ?? "",
    raw: a,
  };
  if (a.general_prompt !== undefined) agent.systemPrompt = a.general_prompt;
  if (a.begin_message !== undefined) agent.firstMessage = a.begin_message;
  if (a.voice_id !== undefined) agent.voice = a.voice_id;
  if (a.language !== undefined) agent.language = a.language;
  if (a.metadata !== undefined) agent.metadata = a.metadata;
  const updatedAt = msToIso(a.last_modification_timestamp);
  if (updatedAt !== undefined) agent.updatedAt = updatedAt;
  return agent;
}

function mapCallStatus(status: string | undefined): CallStatus {
  switch (status) {
    case "registered":
      return "queued";
    case "ongoing":
      return "in-progress";
    case "ended":
      return "completed";
    case "error":
      return "failed";
    default:
      return "unknown";
  }
}

function mapCall(c: RetellCall): Call {
  const call: Call = {
    id: c.call_id,
    provider: PROVIDER,
    status: mapCallStatus(c.call_status),
    direction: c.direction === "inbound" ? "inbound" : c.direction === "outbound" ? "outbound" : "unknown",
    raw: c,
  };
  if (c.agent_id !== undefined) call.agentId = c.agent_id;
  if (c.from_number !== undefined) call.from = c.from_number;
  if (c.to_number !== undefined) call.to = c.to_number;
  const startedAt = msToIso(c.start_timestamp);
  const endedAt = msToIso(c.end_timestamp);
  if (startedAt !== undefined) call.startedAt = startedAt;
  if (endedAt !== undefined) call.endedAt = endedAt;
  if (c.recording_url !== undefined) call.recordingUrl = c.recording_url;
  if (c.transcript !== undefined) call.transcript = c.transcript;
  if (c.metadata !== undefined) call.metadata = c.metadata;
  return call;
}

function mapPhoneNumber(p: RetellPhoneNumber): PhoneNumber {
  const phone: PhoneNumber = {
    id: p.phone_number,
    provider: PROVIDER,
    number: p.phone_number,
    raw: p,
  };
  if (p.nickname !== undefined) phone.name = p.nickname;
  if (p.inbound_agent_id !== undefined) phone.agentId = p.inbound_agent_id;
  if (p.metadata !== undefined) phone.metadata = p.metadata;
  return phone;
}

function toCreateAgentBody(input: CreateAgentInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    agent_name: input.name,
    voice_id: input.voice ?? DEFAULT_VOICE,
    language: input.language ?? DEFAULT_LANGUAGE,
  };
  if (input.systemPrompt !== undefined) body.general_prompt = input.systemPrompt;
  if (input.firstMessage !== undefined) body.begin_message = input.firstMessage;
  if (input.metadata !== undefined) body.metadata = input.metadata;
  return body;
}

function toUpdateAgentBody(input: UpdateAgentInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.agent_name = input.name;
  if (input.voice !== undefined) body.voice_id = input.voice;
  if (input.language !== undefined) body.language = input.language;
  if (input.systemPrompt !== undefined) body.general_prompt = input.systemPrompt;
  if (input.firstMessage !== undefined) body.begin_message = input.firstMessage;
  if (input.metadata !== undefined) body.metadata = input.metadata;
  return body;
}

/* ------------------------------- factory ---------------------------------- */

export const createRetellProvider: ProviderFactory = (ctx: ProviderContext): VoiceProvider => {
  const { http } = ctx;

  async function listAgents(params?: ListParams): Promise<Page<Agent>> {
    parseInput(listParamsSchema, params ?? {}, PROVIDER);
    const rows = await http.get<RetellAgent[]>("/list-agents");
    return makePage({
      data: rows.map(mapAgent),
      hasMore: false,
      nextCursor: null,
      fetchNext: () => listAgents(),
    });
  }

  async function listCalls(params?: ListParams): Promise<Page<Call>> {
    const p = parseInput(listParamsSchema, params ?? {}, PROVIDER);
    const limit = p.limit ?? DEFAULT_LIMIT;
    const body: Record<string, unknown> = { limit, sort_order: "descending" };
    if (p.cursor !== undefined) body.pagination_key = p.cursor;
    const rows = await http.post<RetellCall[]>("/v2/list-calls", { body });
    const data = rows.map(mapCall);
    const last = rows[rows.length - 1];
    const hasMore = rows.length >= limit && last !== undefined;
    return makePage({
      data,
      hasMore,
      nextCursor: hasMore && last ? last.call_id : null,
      fetchNext: (cursor) => listCalls({ ...p, cursor }),
    });
  }

  async function listPhoneNumbers(params?: ListParams): Promise<Page<PhoneNumber>> {
    parseInput(listParamsSchema, params ?? {}, PROVIDER);
    const rows = await http.get<RetellPhoneNumber[]>("/list-phone-numbers");
    return makePage({
      data: rows.map(mapPhoneNumber),
      hasMore: false,
      nextCursor: null,
      fetchNext: () => listPhoneNumbers(),
    });
  }

  return {
    name: PROVIDER,
    agents: {
      async create(input: CreateAgentInput): Promise<Agent> {
        const valid = parseInput(createAgentInputSchema, input, PROVIDER);
        const row = await http.post<RetellAgent>("/create-agent", {
          body: toCreateAgentBody(valid),
        });
        return mapAgent(row);
      },
      list: listAgents,
      async get(id: string): Promise<Agent> {
        const row = await http.get<RetellAgent>(`/get-agent/${encodeURIComponent(id)}`);
        return mapAgent(row);
      },
      async update(id: string, input: UpdateAgentInput): Promise<Agent> {
        const valid = parseInput(updateAgentInputSchema, input, PROVIDER);
        const row = await http.patch<RetellAgent>(`/update-agent/${encodeURIComponent(id)}`, {
          body: toUpdateAgentBody(valid),
        });
        return mapAgent(row);
      },
      async remove(id: string): Promise<void> {
        await http.delete<unknown>(`/delete-agent/${encodeURIComponent(id)}`);
      },
    },
    calls: {
      async create(input: CreateCallInput): Promise<Call> {
        const valid = parseInput(createCallInputSchema, input, PROVIDER);
        const body: Record<string, unknown> = { override_agent_id: valid.agentId };
        if (valid.from !== undefined) body.from_number = valid.from;
        if (valid.to !== undefined) body.to_number = valid.to;
        if (valid.metadata !== undefined) body.metadata = valid.metadata;
        const row = await http.post<RetellCall>("/v2/create-phone-call", { body });
        return mapCall(row);
      },
      list: listCalls,
      async get(id: string): Promise<Call> {
        const row = await http.get<RetellCall>(`/v2/get-call/${encodeURIComponent(id)}`);
        return mapCall(row);
      },
    },
    phoneNumbers: {
      list: listPhoneNumbers,
      async get(id: string): Promise<PhoneNumber> {
        const row = await http.get<RetellPhoneNumber>(
          `/get-phone-number/${encodeURIComponent(id)}`,
        );
        return mapPhoneNumber(row);
      },
      async create(input: CreatePhoneNumberInput): Promise<PhoneNumber> {
        const valid = parseInput(createPhoneNumberInputSchema, input, PROVIDER);
        const body: Record<string, unknown> = {};
        if (valid.number !== undefined) body.phone_number = valid.number;
        if (valid.name !== undefined) body.nickname = valid.name;
        if (valid.agentId !== undefined) body.inbound_agent_id = valid.agentId;
        if (valid.metadata !== undefined) body.metadata = valid.metadata;
        const row = await http.post<RetellPhoneNumber>("/create-phone-number", { body });
        return mapPhoneNumber(row);
      },
    },
    // Provider-specific extra: Retell knowledge bases (no Vapi equivalent).
    extras: {
      knowledgeBases: {
        async list(): Promise<RetellKnowledgeBase[]> {
          return http.get<RetellKnowledgeBase[]>("/list-knowledge-bases");
        },
        async get(id: string): Promise<RetellKnowledgeBase> {
          return http.get<RetellKnowledgeBase>(
            `/get-knowledge-base/${encodeURIComponent(id)}`,
          );
        },
      },
    },
  };
};
