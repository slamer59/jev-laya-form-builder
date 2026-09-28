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
  "customZod",
  "errorMessage",
];

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_THRESHOLD);

/**
 * The document's own vocabulary. The JSON Schema in a file, a hash or
 * localStorage is generated from Zod (`shared/schema.ts` + `shared/import.ts`);
 * these are the keys that carry what JSON Schema has no place for — the
 * builder-only settings, and the uiSchema's two.
 */
export const X_THRESHOLD = "x-threshold";
export const X_PREFIX = "x-prefix";
export const X_SUFFIX = "x-suffix";
export const X_ACCEPT = "x-accept";
export const X_MAX_SIZE_MB = "x-maxSizeMb";
export const X_MULTIPLE = "x-multiple";
/** Custom Zod code that has no data form, kept verbatim as text. */
export const X_ZOD = "x-zod";
/** ajv-errors' keyword for hand-written messages. */
export const KEY_ERROR_MESSAGE = "errorMessage";
export const UI_WIDGET = "ui:widget";
export const UI_ORDER = "ui:order";

/** Keys that are optional in `FieldSpec`: only these can be absent from the canonical form. */
const OPTIONAL_KEYS: Record<string, true> = {
  description: true,
  format: true,
  options: true,
  min: true,
  max: true,
  prefix: true,
  suffix: true,
  accept: true,
  maxSizeMb: true,
  multiple: true,
  customZod: true,
  errorMessage: true,
};

/**
 * Keeps only the known keys, in a fixed order, and drops what carries no
 * information: undefined, and the default of an optional setting — `multiple:
 * false` (one file), an empty hint/prefix/suffix/custom code, an empty option
 * list, an empty message map. A document therefore stores only what differs,
 * and reading it back gives the same canonical field.
 */
export function normalizeField(f: FieldSpec): FieldSpec {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) {
    const v = f[k];
    if (v === undefined) continue;
    if (OPTIONAL_KEYS[k]) {
      const empty =
        v === false ||
        (typeof v === "string" && !v) ||
        (Array.isArray(v) && !v.length) ||
        (typeof v === "object" && v !== null && !Object.keys(v).length);
      if (empty) continue;
    }
    out[k] = v;
  }
  return out as FieldSpec;
}

export function normalizeForm(s: SavedForm): SavedForm {
  return { purpose: s.purpose, fields: s.fields.map(normalizeField), threshold: clamp01(s.threshold), overrides: { ...s.overrides } };
}
