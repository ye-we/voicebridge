/**
 * VoiceBridge — basic usage.
 *
 * Run with:  npx tsx examples/basic.ts
 * (set VOICE_PROVIDER and the matching API key env var first)
 *
 * The whole point: the code below does not change when you switch providers.
 * Flip VOICE_PROVIDER from "vapi" to "retell" and everything still works.
 */

import { createVoiceClient, RateLimitError, NotFoundError } from "../src/index.js";

const provider = process.env.VOICE_PROVIDER ?? "vapi";
const apiKey = process.env.VOICE_API_KEY ?? "";

async function main(): Promise<void> {
  const client = createVoiceClient({ provider, apiKey });

  // 1. Create an agent — same shape for every provider.
  const agent = await client.agents.create({
    name: "Front Desk",
    systemPrompt: "You are a friendly receptionist. Keep answers short.",
    firstMessage: "Hi! How can I help you today?",
    voice: "burt",
    language: "en-US",
  });
  console.log(`Created agent ${agent.id} on ${agent.provider}`);

  // 2. List agents and iterate across ALL pages lazily.
  const page = await client.agents.list({ limit: 20 });
  let count = 0;
  for await (const a of page.iterateAll()) {
    count += 1;
    if (count <= 5) console.log(`  - ${a.name} (${a.id})`);
  }
  console.log(`Total agents: ${count}`);

  // 3. Place an outbound call with that agent.
  try {
    const call = await client.calls.create({ agentId: agent.id, to: "+15551234567" });
    console.log(`Call ${call.id} status=${call.status} direction=${call.direction}`);
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.warn(`Rate limited — retry after ${err.retryAfter ?? "?"}s`);
    } else {
      throw err;
    }
  }

  // 4. Look up a phone number, handling not-found cleanly.
  try {
    const number = await client.phoneNumbers.get("does-not-exist");
    console.log(`Number ${number.number} -> agent ${number.agentId ?? "none"}`);
  } catch (err) {
    if (err instanceof NotFoundError) {
      console.log("That phone number does not exist (handled).");
    } else {
      throw err;
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
