/**
 * `createVoiceClient` — the single entry point. Validates config, resolves the
 * base URL, builds the shared HTTP client, and hands it to the registered
 * provider factory to produce a fully typed, provider-agnostic client.
 */

import { ValidationError } from "./errors.js";
import { HttpClient, parseInput } from "./http.js";
import { getProviderFactory, listProviders } from "./providers/registry.js";
import { VAPI_BASE_URL } from "./providers/vapi.js";
import { RETELL_BASE_URL } from "./providers/retell.js";
import { voiceClientConfigSchema } from "./types.js";
import type { ProviderContext, VoiceClient, VoiceClientConfig } from "./types.js";

/** Default base URLs for the built-in providers. */
const DEFAULT_BASE_URLS: Record<string, string> = {
  vapi: VAPI_BASE_URL,
  retell: RETELL_BASE_URL,
};

/**
 * Create a unified voice-AI client for the given provider.
 *
 * @example
 * const client = createVoiceClient({ provider: "vapi", apiKey: process.env.VAPI_KEY! });
 * const agent = await client.agents.create({ name: "Receptionist" });
 */
export function createVoiceClient(config: VoiceClientConfig): VoiceClient {
  const cfg = parseInput(voiceClientConfigSchema, config);
  const provider = cfg.provider.trim().toLowerCase();

  const factory = getProviderFactory(provider);
  if (!factory) {
    const available = listProviders().join(", ") || "(none)";
    throw new ValidationError(
      `Unknown provider "${cfg.provider}". Registered providers: ${available}. ` +
        `Register a custom one with registerProvider() before calling createVoiceClient.`,
      { provider },
    );
  }

  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URLS[provider];
  if (!baseUrl) {
    throw new ValidationError(
      `No baseUrl configured for provider "${provider}". Pass { baseUrl } in the config.`,
      { provider },
    );
  }

  const http = new HttpClient({
    baseUrl,
    apiKey: cfg.apiKey,
    provider,
    ...(cfg.maxRetries !== undefined ? { maxRetries: cfg.maxRetries } : {}),
    ...(cfg.fetch ? { fetchImpl: cfg.fetch } : {}),
  });

  const ctx: ProviderContext = { http, apiKey: cfg.apiKey, baseUrl };
  const adapter = factory(ctx);

  const client: VoiceClient = {
    provider: adapter.name,
    agents: adapter.agents,
    calls: adapter.calls,
    phoneNumbers: adapter.phoneNumbers,
    ...(adapter.extras ? { extras: adapter.extras } : {}),
  };

  return client;
}
