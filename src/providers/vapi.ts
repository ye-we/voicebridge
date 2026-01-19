/**
 * Vapi adapter — maps the Vapi REST API (https://api.vapi.ai) onto the
 * unified VoiceBridge resource shapes.
 *
 * Vapi uses Bearer auth and returns plain arrays for list endpoints, with
 * `createdAtLt` for cursor-style pagination.
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
  CallDirection,
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

export const VAPI_BASE_URL = "https://api.vapi.ai";
const PROVIDER = "vapi";
const DEFAULT_LIMIT = 100;

/* -------------------------------- raw shapes ------------------------------- */

interface VapiMessage {
  role?: string;
  content?: string;
}

interface VapiAssistant {
  id: string;
  name?: string;
  firstMessage?: string;
  model?: { provider?: string; model?: string; messages?: VapiMessage[] };
  voice?: { provider?: string; voiceId?: string };
  transcriber?: { language?: string };
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

interface VapiCall {
  id: string;
  assistantId?: string;
  phoneNumberId?: string;
  type?: string;
  status?: string;
  customer?: { number?: string };
  phoneNumber?: { number?: string };
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  recordingUrl?: string;
  transcript?: string;
  artifact?: { recordingUrl?: string; transcript?: string };
  metadata?: Record<string, unknown>;
}

interface VapiPhoneNumber {
  id: string;
  number?: string;
  name?: string;
  assistantId?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

/* -------------------------------- mappers --------------------------------- */

function mapAgent(a: VapiAssistant): Agent {
  const systemPrompt = a.model?.messages?.find((m) => m.role === "system")?.content;
  const agent: Agent = {
    id: a.id,
    provider: PROVIDER,
    name: a.name ?? "",
    raw: a,
  };
  if (systemPrompt !== undefined) agent.systemPrompt = systemPrompt;
  if (a.firstMessage !== undefined) agent.firstMessage = a.firstMessage;
  if (a.voice?.voiceId !== undefined) agent.voice = a.voice.voiceId;
  if (a.model?.model !== undefined) agent.model = a.model.model;
  if (a.transcriber?.language !== undefined) agent.language = a.transcriber.language;
  if (a.metadata !== undefined) agent.metadata = a.metadata;
  if (a.createdAt !== undefined) agent.createdAt = a.createdAt;
  if (a.updatedAt !== undefined) agent.updatedAt = a.updatedAt;
  return agent;
}

function mapCallStatus(status: string | undefined): CallStatus {
  switch (status) {
    case "queued":
    case "scheduled":
      return "queued";
    case "ringing":
      return "ringing";
    case "in-progress":
    case "forwarding":
      return "in-progress";
    case "ended":
      return "completed";
    default:
      return "unknown";
  }
}

function mapCallDirection(type: string | undefined): CallDirection {
  if (type === "inboundPhoneCall") return "inbound";
  if (type === "outboundPhoneCall" || type === "webCall") return "outbound";
  return "unknown";
}

function mapCall(c: VapiCall): Call {
  const recordingUrl = c.recordingUrl ?? c.artifact?.recordingUrl;
  const transcript = c.transcript ?? c.artifact?.transcript;
  const call: Call = {
    id: c.id,
    provider: PROVIDER,
    status: mapCallStatus(c.status),
    direction: mapCallDirection(c.type),
    raw: c,
  };
  if (c.assistantId !== undefined) call.agentId = c.assistantId;
  if (c.phoneNumber?.number !== undefined) call.from = c.phoneNumber.number;
  if (c.customer?.number !== undefined) call.to = c.customer.number;
  if (c.startedAt !== undefined) call.startedAt = c.startedAt;
  if (c.endedAt !== undefined) call.endedAt = c.endedAt;
  if (recordingUrl !== undefined) call.recordingUrl = recordingUrl;
  if (transcript !== undefined) call.transcript = transcript;
  if (c.metadata !== undefined) call.metadata = c.metadata;
  return call;
}

function mapPhoneNumber(p: VapiPhoneNumber): PhoneNumber {
  const phone: PhoneNumber = {
    id: p.id,
    provider: PROVIDER,
    number: p.number ?? "",
    raw: p,
  };
  if (p.name !== undefined) phone.name = p.name;
  if (p.assistantId !== undefined) phone.agentId = p.assistantId;
  if (p.metadata !== undefined) phone.metadata = p.metadata;
  return phone;
}

function toCreateAssistantBody(input: CreateAgentInput): Record<string, unknown> {
  const body: Record<string, unknown> = { name: input.name };
  if (input.firstMessage !== undefined) body.firstMessage = input.firstMessage;
  if (input.model !== undefined || input.systemPrompt !== undefined) {
    body.model = {
      provider: "openai",
      model: input.model ?? "gpt-4o-mini",
      ...(input.systemPrompt !== undefined
        ? { messages: [{ role: "system", content: input.systemPrompt }] }
        : {}),
    };
  }
  if (input.voice !== undefined) {
    body.voice = { provider: "vapi", voiceId: input.voice };
  }
  if (input.language !== undefined) {
    body.transcriber = { language: input.language };
  }
  if (input.metadata !== undefined) body.metadata = input.metadata;
  return body;
}

function toUpdateAssistantBody(input: UpdateAgentInput): Record<string, unknown> {
  return toCreateAssistantBody({ name: input.name ?? "", ...input });
}

/* ------------------------------- factory ---------------------------------- */

export const createVapiProvider: ProviderFactory = (ctx: ProviderContext): VoiceProvider => {
  const { http } = ctx;

  async function listAgents(params?: ListParams): Promise<Page<Agent>> {
    const p = parseInput(listParamsSchema, params ?? {}, PROVIDER);
    const limit = p.limit ?? DEFAULT_LIMIT;
    const rows = await http.get<VapiAssistant[]>("/assistant", {
      query: { limit, createdAtLt: p.cursor },
    });
    const data = rows.map(mapAgent);
    const last = rows[rows.length - 1];
    const hasMore = rows.length >= limit && last?.createdAt !== undefined;
    return makePage({
      data,
      hasMore,
      nextCursor: hasMore && last?.createdAt ? last.createdAt : null,
      fetchNext: (cursor) => listAgents({ ...p, cursor }),
    });
  }

  async function listCalls(params?: ListParams): Promise<Page<Call>> {
    const p = parseInput(listParamsSchema, params ?? {}, PROVIDER);
    const limit = p.limit ?? DEFAULT_LIMIT;
    const rows = await http.get<VapiCall[]>("/call", {
      query: { limit, createdAtLt: p.cursor },
    });
    const data = rows.map(mapCall);
    const last = rows[rows.length - 1];
    // Vapi paginates calls by `createdAtLt`; use the last row's createdAt as cursor.
    const cursorVal = last?.createdAt ?? null;
    const hasMore = rows.length >= limit && cursorVal !== null;
    return makePage({
      data,
      hasMore,
      nextCursor: hasMore ? cursorVal : null,
      fetchNext: (cursor) => listCalls({ ...p, cursor }),
    });
  }

  async function listPhoneNumbers(params?: ListParams): Promise<Page<PhoneNumber>> {
    const p = parseInput(listParamsSchema, params ?? {}, PROVIDER);
    const limit = p.limit ?? DEFAULT_LIMIT;
    const rows = await http.get<VapiPhoneNumber[]>("/phone-number", {
      query: { limit, createdAtLt: p.cursor },
    });
    const data = rows.map(mapPhoneNumber);
    const last = rows[rows.length - 1];
    const hasMore = rows.length >= limit && last !== undefined;
    return makePage({
      data,
      hasMore,
      nextCursor: hasMore && last ? last.id : null,
      fetchNext: (cursor) => listPhoneNumbers({ ...p, cursor }),
    });
  }

  return {
    name: PROVIDER,
    agents: {
      async create(input: CreateAgentInput): Promise<Agent> {
        const valid = parseInput(createAgentInputSchema, input, PROVIDER);
        const row = await http.post<VapiAssistant>("/assistant", {
          body: toCreateAssistantBody(valid),
        });
        return mapAgent(row);
      },
      list: listAgents,
      async get(id: string): Promise<Agent> {
        const row = await http.get<VapiAssistant>(`/assistant/${encodeURIComponent(id)}`);
        return mapAgent(row);
      },
      async update(id: string, input: UpdateAgentInput): Promise<Agent> {
        const valid = parseInput(updateAgentInputSchema, input, PROVIDER);
        const row = await http.patch<VapiAssistant>(`/assistant/${encodeURIComponent(id)}`, {
          body: toUpdateAssistantBody(valid),
        });
        return mapAgent(row);
      },
      async remove(id: string): Promise<void> {
        await http.delete<unknown>(`/assistant/${encodeURIComponent(id)}`);
      },
    },
    calls: {
      async create(input: CreateCallInput): Promise<Call> {
        const valid = parseInput(createCallInputSchema, input, PROVIDER);
        const body: Record<string, unknown> = { assistantId: valid.agentId };
        if (valid.phoneNumberId !== undefined) body.phoneNumberId = valid.phoneNumberId;
        if (valid.to !== undefined) body.customer = { number: valid.to };
        if (valid.metadata !== undefined) body.metadata = valid.metadata;
        const row = await http.post<VapiCall>("/call", { body });
        return mapCall(row);
      },
      list: listCalls,
      async get(id: string): Promise<Call> {
        const row = await http.get<VapiCall>(`/call/${encodeURIComponent(id)}`);
        return mapCall(row);
      },
    },
    phoneNumbers: {
      list: listPhoneNumbers,
      async get(id: string): Promise<PhoneNumber> {
        const row = await http.get<VapiPhoneNumber>(`/phone-number/${encodeURIComponent(id)}`);
        return mapPhoneNumber(row);
      },
      async create(input: CreatePhoneNumberInput): Promise<PhoneNumber> {
        const valid = parseInput(createPhoneNumberInputSchema, input, PROVIDER);
        const body: Record<string, unknown> = {};
        if (valid.number !== undefined) body.number = valid.number;
        if (valid.name !== undefined) body.name = valid.name;
        if (valid.agentId !== undefined) body.assistantId = valid.agentId;
        if (valid.telephonyProvider !== undefined) body.provider = valid.telephonyProvider;
        if (valid.metadata !== undefined) body.metadata = valid.metadata;
        const row = await http.post<VapiPhoneNumber>("/phone-number", { body });
        return mapPhoneNumber(row);
      },
    },
  };
};
