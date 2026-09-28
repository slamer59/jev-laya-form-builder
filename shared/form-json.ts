import type { FieldSpec } from "./types";

/**
 * The builder state in memory: one `FieldSpec` per field. Ids are runtime-only
 * (React keys, pick cache and overrides all key off them), so they are never
 * written to a file, a hash or localStorage — see `shared/import.ts` for the
 * JSON Schema + uiSchema document that is.
 */
export type SavedForm = {
  purpose: string;
  fields: FieldSpec[];
  threshold: number;
  overrides: Record<string, string>;
};

export const DEFAULT_THRESHOLD = 0.5;

/** Canonical key order, so a file exported by the builder round-trips byte for byte. */
const FIELD_KEYS: (keyof FieldSpec)[] = [
  "id",
  "name",
  "label",
  "kind",
  "required",
  "description",
  "format",
  "options",
  "min",
  "max",
  "prefix",
  "suffix",
  "accept",
  "maxSizeMb",
  "multiple",
];

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_THRESHOLD);

/** Keeps only the known keys, in a fixed order, and drops the undefined ones. */
export function normalizeField(f: FieldSpec): FieldSpec {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) if (f[k] !== undefined) out[k] = f[k];
  return out as FieldSpec;
}

export function normalizeForm(s: SavedForm): SavedForm {
  return { purpose: s.purpose, fields: s.fields.map(normalizeField), threshold: clamp01(s.threshold), overrides: { ...s.overrides } };
}
