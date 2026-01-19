/**
 * VoiceBridge — one SDK for voice AI agents.
 * Public surface.
 */

// Core entry point.
export { createVoiceClient } from "./client.js";

// Provider registry (for custom providers).
export {
  registerProvider,
  getProviderFactory,
  hasProvider,
  listProviders,
  unregisterProvider,
} from "./providers/registry.js";

// Built-in adapter factories + base URLs (advanced / custom wiring).
export { createVapiProvider, VAPI_BASE_URL } from "./providers/vapi.js";
export { createRetellProvider, RETELL_BASE_URL } from "./providers/retell.js";

// HTTP utilities (useful when authoring a custom provider).
export { HttpClient, makePage, parseInput } from "./http.js";
export type { HttpClientOptions, RequestOptions, QueryValue } from "./http.js";

// Errors.
export {
  VoiceBridgeError,
  AuthError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ProviderError,
  errorFromStatus,
} from "./errors.js";
export type { VoiceBridgeErrorOptions } from "./errors.js";

// Zod schemas (for runtime validation / reuse).
export {
  voiceClientConfigSchema,
  createAgentInputSchema,
  updateAgentInputSchema,
  createCallInputSchema,
  createPhoneNumberInputSchema,
  listParamsSchema,
} from "./types.js";

// Types.
export type {
  VoiceClient,
  VoiceClientConfig,
  VoiceProvider,
  ProviderContext,
  ProviderFactory,
  AgentResource,
  CallResource,
  PhoneNumberResource,
  Agent,
  Call,
  CallStatus,
  CallDirection,
  PhoneNumber,
  Page,
  ListParams,
  CreateAgentInput,
  UpdateAgentInput,
  CreateCallInput,
  CreatePhoneNumberInput,
} from "./types.js";
