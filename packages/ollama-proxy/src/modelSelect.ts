import type { BridgeClient, BridgeModel } from './bridgeClient.js';

export interface ModelCache {
  models: BridgeModel[];
  fetchedAt: number;
}

let cache: ModelCache | undefined;
const TTL_MS = 30_000;

export async function selectModelId(client: BridgeClient, requested?: string): Promise<{ id?: string; usedId?: string; models: BridgeModel[] }>{
  const now = Date.now();
  if (!cache || now - cache.fetchedAt > TTL_MS) {
    cache = { models: await client.listModels(), fetchedAt: now };
  }
  const models = cache.models;
  if (!requested) return { id: undefined, usedId: models[0]?.id, models };

  // Exact match by id
  const exact = models.find((m) => m.id === requested);
  if (exact) return { id: exact.id, usedId: exact.id, models };

  // Try by family or vendor
  const lower = requested.toLowerCase();
  const byFamily = models.find((m) => (m.family?.toLowerCase() ?? '') === lower);
  if (byFamily) return { id: undefined, usedId: byFamily.id, models };
  const byVendor = models.find((m) => (m.vendor?.toLowerCase() ?? '') === lower);
  if (byVendor) return { id: undefined, usedId: byVendor.id, models };

  // Fallback: no selector (bridge will pick first)
  return { id: undefined, usedId: models[0]?.id ?? requested, models };
}
