import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Backend } from "../shared/types";

/**
 * The three backends the server can answer with, and how to reach them.
 *
 * - `jev`   hosted TypeSafe API, needs a real `TYPESAFE_API_KEY`.
 * - `laya`  `laya-serve` on this machine, same `/v1/systemone` protocol via the same SDK.
 * - `rules` no model at all, `shared/catalog.ts` decisions only.
 */
export type ModelBackend = Exclude<Backend, "rules">;

/** Laya's address. `dev:laya` sets `LAYA_URL`; plain `dev` leaves the localhost default. */
export const LAYA_URL = (process.env.LAYA_URL?.trim() || "http://localhost:8000").replace(/\/+$/, "");

/** Placeholder values that ship in example `.env` files and are not real keys. */
const PLACEHOLDER_KEYS: Record<string, true> = { your_key_here: true, "your-key": true, yourkey: true, changeme: true, local: true };

const apiKey = process.env.TYPESAFE_API_KEY?.trim();
const usableKey = apiKey && !PLACEHOLDER_KEYS[apiKey.toLowerCase()] ? apiKey : undefined;

/** Laya ignores the key but the SDK requires one, so any placeholder will do. */
export const clients: Record<ModelBackend, TypeSafeClient | null> = {
  jev: usableKey ? new TypeSafeClient({ apiKey: usableKey }) : null,
  laya: new TypeSafeClient({ apiKey: "local", baseURL: LAYA_URL, timeout: 120_000 }),
};

/** Laya's `/health` is cheap; cache the answer briefly so `/api/status` and picks stay fast. */
let health: { at: number; ok: boolean } | null = null;
const HEALTH_TTL_MS = 5_000;

export async function layaAvailable(force = false): Promise<boolean> {
  if (!force && health && Date.now() - health.at < HEALTH_TTL_MS) return health.ok;
  let ok = false;
  try {
    ok = (await fetch(`${LAYA_URL}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    ok = false; // not running, wrong port, or too slow to care about
  }
  health = { at: Date.now(), ok };
  return ok;
}

export type Availability = Record<Backend, boolean>;

/** What the header selector can offer right now. */
export async function availability(): Promise<Availability> {
  return { jev: !!clients.jev, laya: await layaAvailable(), rules: true };
}

/** Best backend to use when the request does not name one: Jev, then Laya, then rules. */
export function bestOf(a: Availability): Backend {
  return a.jev ? "jev" : a.laya ? "laya" : "rules";
}

/** Resolve the backend for a request: use the requested one when it is available, else the best. */
export async function resolveBackend(requested?: Backend): Promise<Backend> {
  const a = await availability();
  return requested && a[requested] ? requested : bestOf(a);
}
