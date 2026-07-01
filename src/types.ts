/**
 * Unified types shared across every provider, plus the zod schemas used to
 * validate client configuration and method inputs.
 */

import { z } from "zod";
import type { HttpClient } from "./http.js";

/* -------------------------------------------------------------------------- */
/* Config + input schemas                                                     */
/* -------------------------------------------------------------------------- */

export const voiceClientConfigSchema = z.object({
  /** Registered provider name, e.g. "vapi" or "retell". */
  provider: z.string().min(1, "provider is required"),
  /** Secret API key for the chosen provider. */
  apiKey: z.string().min(1, "apiKey is required"),
  /** Override the provider base URL (useful for proxies / self-hosting). */
  baseUrl: z.string().url().optional(),
  /** Max automatic retries for 429 / 5xx responses. Default 2. */
  maxRetries: z.number().int().min(0).max(10).optional(),
  /** Abort any request that takes longer than this many ms. Default: no timeout. */
  timeoutMs: z.number().int().positive().optional(),
  /** Inject a custom fetch implementation (defaults to global fetch). */
  fetch: z.custom<typeof fetch>((v) => typeof v === "function").optional(),
});

export type VoiceClientConfig = z.infer<typeof voiceClientConfigSchema>;

export const createAgentInputSchema = z.object({
  name: z.string().min(1, "name is required"),
  systemPrompt: z.string().optional(),
  firstMessage: z.string().optional(),
  voice: z.string().optional(),
  model: z.string().optional(),
  language: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;

export const updateAgentInputSchema = createAgentInputSchema.partial();
export type UpdateAgentInput = z.infer<typeof updateAgentInputSchema>;

export const createCallInputSchema = z.object({
  /** The agent that should handle the call. */
  agentId: z.string().min(1, "agentId is required"),
  /** Destination number in E.164 (outbound calls). */
  to: z.string().optional(),
  /** Caller id / origin number. */
  from: z.string().optional(),
  /** Provider phone-number id to place the call from. */
  phoneNumberId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateCallInput = z.infer<typeof createCallInputSchema>;

export const createPhoneNumberInputSchema = z.object({
  /** The number itself, in E.164 (when importing an existing number). */
  number: z.string().optional(),
  name: z.string().optional(),
  /** Agent to attach to inbound calls on this number. */
  agentId: z.string().optional(),
  /** Underlying telephony provider, e.g. "twilio" or "vonage". */
  telephonyProvider: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreatePhoneNumberInput = z.infer<typeof createPhoneNumberInputSchema>;

export const listParamsSchema = z.object({
  /** Max items to return in this page. */
  limit: z.number().int().min(1).max(1000).optional(),
  /** Opaque cursor returned by a previous page. */
  cursor: z.string().optional(),
});

export type ListParams = z.infer<typeof listParamsSchema>;

/* -------------------------------------------------------------------------- */
/* Unified resource shapes                                                    */
/* -------------------------------------------------------------------------- */

export interface Agent {
  id: string;
  provider: string;
  name: string;
  systemPrompt?: string;
  firstMessage?: string;
  voice?: string;
  model?: string;
  language?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  /** The untouched provider payload. */
  raw: unknown;
}

export type CallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "failed"
  | "canceled"
  | "unknown";

export type CallDirection = "inbound" | "outbound" | "unknown";

export interface Call {
  id: string;
  provider: string;
  agentId?: string;
  status: CallStatus;
  direction?: CallDirection;
  from?: string;
  to?: string;
  startedAt?: string;
  endedAt?: string;
  recordingUrl?: string;
  transcript?: string;
  metadata?: Record<string, unknown>;
  raw: unknown;
}

export interface PhoneNumber {
  id: string;
  provider: string;
  number: string;
  name?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  raw: unknown;
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

export interface Page<T> {
  /** Items in the current page. */
  data: T[];
  /** True when more pages exist. */
  hasMore: boolean;
  /** Cursor to fetch the next page, or null when exhausted. */
  nextCursor: string | null;
  /**
   * Lazily iterate every item across all pages, transparently fetching the
   * next page as needed.
   */
  iterateAll(): AsyncGenerator<T, void, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Provider contract                                                          */
/* -------------------------------------------------------------------------- */

export interface AgentResource {
  create(input: CreateAgentInput): Promise<Agent>;
  list(params?: ListParams): Promise<Page<Agent>>;
  get(id: string): Promise<Agent>;
  update(id: string, input: UpdateAgentInput): Promise<Agent>;
  remove(id: string): Promise<void>;
}

export interface CallResource {
  create(input: CreateCallInput): Promise<Call>;
  list(params?: ListParams): Promise<Page<Call>>;
  get(id: string): Promise<Call>;
}

export interface PhoneNumberResource {
  list(params?: ListParams): Promise<Page<PhoneNumber>>;
  get(id: string): Promise<PhoneNumber>;
  create(input: CreatePhoneNumberInput): Promise<PhoneNumber>;
}

/**
 * The contract every provider adapter implements. Core resources are unified;
 * adapters may attach provider-specific extras under their own namespace.
 */
export interface VoiceProvider {
  readonly name: string;
  readonly agents: AgentResource;
  readonly calls: CallResource;
  readonly phoneNumbers: PhoneNumberResource;
  /** Optional provider-specific extras (knowledge bases, tools, files...). */
  readonly extras?: Record<string, unknown>;
}

/** Everything a provider factory receives to build an adapter. */
export interface ProviderContext {
  http: HttpClient;
  apiKey: string;
  baseUrl: string;
}

/** Factory that builds a provider adapter from a context. */
export type ProviderFactory = (ctx: ProviderContext) => VoiceProvider;

/** The fully assembled, typed client returned by `createVoiceClient`. */
export interface VoiceClient {
  readonly provider: string;
  readonly agents: AgentResource;
  readonly calls: CallResource;
  readonly phoneNumbers: PhoneNumberResource;
  /** Escape hatch to provider-specific extras, if the adapter exposes any. */
  readonly extras?: Record<string, unknown>;
}
