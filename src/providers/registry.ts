/**
 * Provider registry.
 *
 * Built-in adapters (vapi, retell) register themselves at module load. Users
 * can plug in their own with `registerProvider(name, factory)` without
 * touching SDK core.
 */

import { ValidationError } from "../errors.js";
import type { ProviderFactory } from "../types.js";
import { createVapiProvider } from "./vapi.js";
import { createRetellProvider } from "./retell.js";

const registry = new Map<string, ProviderFactory>();

/** Register (or override) a provider factory under `name`. */
export function registerProvider(name: string, factory: ProviderFactory): void {
  const key = normalizeName(name);
  if (key.length === 0) {
    throw new ValidationError("Provider name must be a non-empty string");
  }
  registry.set(key, factory);
}

/** Retrieve a previously registered factory, or undefined. */
export function getProviderFactory(name: string): ProviderFactory | undefined {
  return registry.get(normalizeName(name));
}

/** True when a provider is registered under `name`. */
export function hasProvider(name: string): boolean {
  return registry.has(normalizeName(name));
}

/** List the names of all registered providers. */
export function listProviders(): string[] {
  return [...registry.keys()].sort();
}

/** Remove a provider. Returns true if it existed. Mainly for tests. */
export function unregisterProvider(name: string): boolean {
  return registry.delete(normalizeName(name));
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// Register the built-in providers.
registerProvider("vapi", createVapiProvider);
registerProvider("retell", createRetellProvider);
