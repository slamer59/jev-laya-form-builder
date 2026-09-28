import { candidatesFor } from "./catalog";
import { DEFAULT_THRESHOLD, clamp01, normalizeField, normalizeForm, type SavedForm } from "./form-json";
import type { FieldSpec } from "./types";

/**
 * Paste-to-form conversion, and the builder's own file format.
 *
 * The persisted format is plain JSON Schema draft 2020-12 plus an RJSF-style
 * uiSchema — the same shape in a downloaded file, in the URL hash and in
 * localStorage:
 *
 *   { "schema": { "type": "object", "properties": { … } }, "uiSchema": { … } }
 *
 *   purpose        → schema.description
 *   label / hint   → properties[name].title / .description
 *   required       → schema.required[]
 *   kind           → type / format / enum / items.enum (see `propertyFor`)
 *   overrides      → uiSchema[name]["ui:widget"] = catalogue id
 *   field order    → uiSchema["ui:order"]
 *   threshold      → schema["x-threshold"]
 *
 * Reading is lenient: any JSON Schema object works, and everything the builder
 * cannot express becomes a text field with an entry in `warnings`.
 */

export type FormDocument = { schema: Record<string, unknown>; uiSchema: Record<string, unknown> };

export type ImportFormat = "builder-file" | "json-schema" | "zod";

export type ImportResult = {
  ok: boolean;
  format: ImportFormat;
  purpose: string;
  fields: FieldSpec[];
  /** Builder files only, and only when the file carries it. */
  threshold?: number;
  overrides?: Record<string, string>;
  warnings: string[];
};

type Json = Record<string, unknown>;

const SCHEMA_URI = "https://json-schema.org/draft/2020-12/schema";
const X_THRESHOLD = "x-threshold";
const UI_WIDGET = "ui:widget";
const UI_ORDER = "ui:order";

const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** `full_name` / `fullName` → `Full name`, the label used when the schema has no title. */
function prettify(key: string): string {
  const words = key
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/* ------------------------------------------------------------------ writing */

/** One field → its JSON Schema property. KINDS: add new kinds here (time, date-range, range, file). */
function propertyFor(f: FieldSpec): Json {
  const p: Json = { title: f.label };
  if (f.description) p.description = f.description;
  switch (f.kind) {
    case "string":
      p.type = "string";
      if (f.format === "email") p.format = "email";
      else if (f.format === "url") p.format = "uri";
      if (f.min != null) p.minLength = f.min;
      if (f.max != null) p.maxLength = f.max;
      break;
    case "number":
      // The builder has no integer kind: whole-number bounds mean whole values.
      p.type = Number.isInteger(f.min) && Number.isInteger(f.max) ? "integer" : "number";
      if (f.min != null) p.minimum = f.min;
      if (f.max != null) p.maximum = f.max;
      break;
    case "boolean":
      p.type = "boolean";
      break;
    case "enum":
      p.type = "string";
      p.enum = f.options ?? [];
      break;
    case "multi":
      p.type = "array";
      p.items = { type: "string", enum: f.options ?? [] };
      if (f.required) p.minItems = 1;
      break;
    case "date":
      p.type = "string";
      p.format = "date";
      break;
  }
  return p;
}

/** Builder state → the canonical document. Ids stay out of it; they are runtime-only. */
export function formDocument(s: SavedForm): FormDocument {
  const form = normalizeForm(s);
  const properties: Json = {};
  const required: string[] = [];
  const uiSchema: Json = {};
  for (const f of form.fields) {
    properties[f.name] = propertyFor(f);
    if (f.required) required.push(f.name);
    if (form.overrides[f.id]) uiSchema[f.name] = { [UI_WIDGET]: form.overrides[f.id] };
  }
  const schema: Json = { $schema: SCHEMA_URI, type: "object", properties };
  if (form.purpose) schema.description = form.purpose;
  if (required.length) schema.required = required;
  schema[X_THRESHOLD] = form.threshold;
  uiSchema[UI_ORDER] = form.fields.map((f) => f.name);
  return { schema, uiSchema };
}

export const formToJson = (s: SavedForm) => JSON.stringify(formDocument(s), null, 2);

/* ------------------------------------------------------------------ reading */

type ReadSchema = {
  ok: boolean;
  purpose: string;
  fields: FieldSpec[];
  threshold?: number;
  overrides: Record<string, string>;
  warnings: string[];
};

function readSchema(schema: Json, uiSchema: Json): ReadSchema {
  const warnings: string[] = [];
  const out: ReadSchema = { ok: false, purpose: "", fields: [], overrides: {}, warnings };
  if (!isObj(schema.properties)) {
    warnings.push('No "properties" found. Paste an object schema, e.g. {"type":"object","properties":{…}}.');
    return out;
  }
  const props = schema.properties;
  const requiredNames = Array.isArray(schema.required) ? schema.required.filter((n): n is string => typeof n === "string") : [];
  out.fields = Object.entries(props).map(([name, prop], i) => normalizeField(mapProperty(name, isObj(prop) ? prop : {}, requiredNames.includes(name), i, warnings)));
  for (const name of requiredNames) if (!(name in props)) warnings.push(`"required" lists "${name}", which is not in properties.`);
  // Ids follow the order the fields are shown in, so a restored form looks like the original.
  out.fields = applyOrder(out.fields, uiSchema[UI_ORDER], warnings).map((f, i) => ({ ...f, id: `imp_${i + 1}` }));
  out.overrides = readOverrides(uiSchema, out.fields, warnings);
  if (!out.fields.length) warnings.push('The "properties" map is empty.');
  out.purpose = typeof schema.description === "string" ? schema.description : typeof schema.title === "string" ? schema.title : "";
  const threshold = finite(schema[X_THRESHOLD]);
  if (threshold !== undefined) out.threshold = clamp01(threshold);
  out.ok = out.fields.length > 0;
  return out;
}

/** One JSON Schema property → a field. KINDS: add new kinds here (time, date-range, range, file). */
function mapProperty(name: string, s: Json, required: boolean, i: number, warnings: string[]): FieldSpec {
  // `"type": ["string", "null"]` means the value can be absent.
  const nullable = Array.isArray(s.type) && s.type.includes("null");
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  const f: FieldSpec = {
    id: `imp_${i + 1}`,
    name,
    label: typeof s.title === "string" && s.title.trim() ? s.title.trim() : prettify(name),
    kind: "string",
    required: required && !nullable,
  };
  if (typeof s.description === "string" && s.description) f.description = s.description;

  // `enum` wins over `type`: JSON Schema writes either, or both.
  if (Array.isArray(s.enum)) {
    if (!s.enum.length) {
      warnings.push(`${name}: the enum is empty — used a text field.`);
      return f;
    }
    f.kind = "enum";
    f.options = s.enum.map(asText);
    if (!s.enum.every((v) => typeof v === "string")) warnings.push(`${name}: non-text enum values were turned into text.`);
    return f;
  }
  if (s.const !== undefined) {
    f.kind = "enum";
    f.options = [asText(s.const)];
    return f;
  }

  switch (type) {
    case "string": {
      const format = typeof s.format === "string" ? s.format : undefined;
      if (format === "date" || format === "date-time") {
        f.kind = "date";
        if (format === "date-time") warnings.push(`${name}: date-time is treated as a date (the time is dropped).`);
        if (finite(s.minLength) !== undefined || finite(s.maxLength) !== undefined) warnings.push(`${name}: minLength/maxLength are ignored on a date field.`);
      } else {
        if (format === "email") f.format = "email";
        else if (format === "uri" || format === "url") f.format = "url";
        else if (format) warnings.push(`${name}: format "${format}" is not supported — plain text.`);
        f.min = finite(s.minLength);
        f.max = finite(s.maxLength);
      }
      break;
    }
    case "number":
    case "integer": {
      f.kind = "number";
      f.min = finite(s.minimum);
      f.max = finite(s.maximum);
      if (f.min === undefined && finite(s.exclusiveMinimum) !== undefined) {
        f.min = finite(s.exclusiveMinimum);
        warnings.push(`${name}: exclusiveMinimum is treated as the minimum.`);
      }
      if (f.max === undefined && finite(s.exclusiveMaximum) !== undefined) {
        f.max = finite(s.exclusiveMaximum);
        warnings.push(`${name}: exclusiveMaximum is treated as the maximum.`);
      }
      break;
    }
    case "boolean":
      f.kind = "boolean";
      break;
    case "array": {
      const items = isObj(s.items) ? s.items : {};
      if (Array.isArray(items.enum) && items.enum.length) {
        f.kind = "multi";
        f.options = items.enum.map(asText);
        if (!items.enum.every((v) => typeof v === "string")) warnings.push(`${name}: non-text options were turned into text.`);
        // "at least one when required" is how the builder writes it; anything else is lost.
        const minItems = finite(s.minItems);
        if ((minItems !== undefined || finite(s.maxItems) !== undefined) && !(minItems === 1 && f.required)) {
          warnings.push(`${name}: minItems/maxItems cannot be expressed in the builder — ignored.`);
        }
      } else {
        warnings.push(`${name}: a list without a fixed set of options — used a text field.`);
      }
      break;
    }
    case undefined:
      warnings.push(`${name}: no "type" and no "enum" — used a text field.`);
      break;
    default:
      warnings.push(`${name}: type "${String(type)}" is not supported — used a text field.`);
  }

  if (s.$ref || s.oneOf || s.anyOf || s.allOf || s.not || isObj(s.properties)) {
    warnings.push(`${name}: nested or composed schemas ($ref/oneOf/anyOf/allOf) are not resolved.`);
  }
  return f;
}

/** `ui:order` decides the field order; names missing from it keep their schema order. */
function applyOrder(fields: FieldSpec[], order: unknown, warnings: string[]): FieldSpec[] {
  if (!Array.isArray(order)) return fields;
  const rest: Record<string, FieldSpec> = Object.fromEntries(fields.map((f) => [f.name, f]));
  const ordered: FieldSpec[] = [];
  for (const name of order) {
    if (typeof name !== "string") continue;
    const f = rest[name];
    if (!f) {
      warnings.push(`ui:order lists "${name}", which is not a field.`);
      continue;
    }
    ordered.push(f);
    delete rest[name];
  }
  return [...ordered, ...Object.values(rest)];
}

/** `ui:widget` per field → the builder's override map, keyed by the regenerated field ids. */
function readOverrides(uiSchema: Json, fields: FieldSpec[], warnings: string[]): Record<string, string> {
  const byName: Record<string, FieldSpec> = Object.fromEntries(fields.map((f) => [f.name, f]));
  const out: Record<string, string> = {};
  for (const [name, entry] of Object.entries(uiSchema)) {
    if (name === UI_ORDER) continue;
    const widget = isObj(entry) && typeof entry[UI_WIDGET] === "string" ? entry[UI_WIDGET] : undefined;
    if (!widget) continue;
    const f = byName[name];
    if (!f) {
      warnings.push(`ui:widget is set for "${name}", which is not a field.`);
      continue;
    }
    if (!candidatesFor(f.kind).some((c) => c.id === widget)) {
      warnings.push(`"${name}": ui:widget "${widget}" cannot hold a ${f.kind} value — ignored.`);
      continue;
    }
    out[f.id] = widget;
  }
  return out;
}

/* ------------------------------------------------------------------ Zod source */

const ZOD_HINT = "Paste Zod source containing a z.object({ … }) literal.";

const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

function unescapeLiteral(lit: string): string {
  return lit
    .slice(1, -1)
    .replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, esc: string) =>
      esc.length > 1 ? String.fromCharCode(parseInt(esc.slice(1), 16)) : (SIMPLE_ESCAPES[esc] ?? esc),
    );
}

/** The quoted literal that starts at `i`, escapes included. Comments are already stripped. */
function readStringAt(src: string, i: number): string {
  const quote = src[i];
  let out = quote;
  for (let j = i + 1; j < src.length; j++) {
    out += src[j];
    if (src[j] === "\\") {
      out += src[++j] ?? "";
      continue;
    }
    if (src[j] === quote) break;
  }
  return out;
}

function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const lit = readStringAt(src, i);
      out += lit;
      i += lit.length;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Index of the `}` matching the `{` at `open`, or -1. Ignores braces inside strings. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; ) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const lit = readStringAt(src, i);
      i += lit.length;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
    i++;
  }
  return -1;
}

/** Splits an object body on commas at depth 0, and on newlines that are not a `.method(…)` continuation. */
function splitEntries(body: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  let buf = "";
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      const lit = readStringAt(body, i);
      buf += lit;
      i += lit.length;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") open.push(c);
    else if (c === "}" || c === ")" || c === "]") open.pop();
    else if (!open.length && (c === "," || c === "\n")) {
      const rest = body.slice(i + 1);
      if (c === "\n" && rest.trimStart().startsWith(".")) {
        buf += c;
        i++;
        continue;
      }
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  out.push(buf);
  return out.map((e) => e.trim()).filter(Boolean);
}

/** Index of `ch` at depth 0, or -1. */
function indexOfTopLevel(text: string, ch: string): number {
  const open: string[] = [];
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const lit = readStringAt(text, i);
      i += lit.length;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") open.push(c);
    else if (c === "}" || c === ")" || c === "]") open.pop();
    else if (!open.length && c === ch) return i;
    i++;
  }
  return -1;
}

const DESCRIBE_RE = /\.\s*describe\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*\)/;

/** The first `.describe("…")` string in an expression, if any. */
function matchDescribe(expr: string): string | undefined {
  const m = DESCRIBE_RE.exec(expr);
  return m ? unescapeLiteral(m[1]) : undefined;
}

/** The string options of the first `z.enum([ … ])` in the expression, or null. */
function zodEnumOptions(expr: string): string[] | null {
  const at = expr.search(/z\s*\.\s*enum\s*\(/);
  if (at < 0) return null;
  const open = expr.indexOf("[", at);
  if (open < 0) return null;
  const options: string[] = [];
  for (let i = open + 1; i < expr.length; ) {
    const c = expr[i];
    if (c === "]") break;
    if (c === '"' || c === "'" || c === "`") {
      const lit = readStringAt(expr, i);
      options.push(unescapeLiteral(lit));
      i += lit.length;
      continue;
    }
    i++;
  }
  return options.length ? options : null;
}

/** The first numeric argument of `.min(…)` / `.max(…)`, when it is written out. */
function numericArg(expr: string, method: "min" | "max"): number | undefined {
  const m = new RegExp(`\\.\\s*${method}\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?)\\s*[,)]`).exec(expr);
  return m ? Number(m[1]) : undefined;
}

const ZOD_OPTIONAL_RE = /\.\s*optional\s*\(\s*\)|\.\s*nullable\s*\(\s*\)|\.\s*or\s*\(\s*z\s*\.\s*literal\s*\(\s*(?:""|''|``)\s*\)\s*\)/;

// The base type is what the expression *starts* with; a later `.url()` or
// `.or(z.literal(""))` only tunes it, so these must stay anchored.
// KINDS: add new kinds here (time, date-range, range, file).
const ZOD_ARRAY = /^z\s*\.\s*array\s*\(/;
const ZOD_ENUM = /^z\s*\.\s*enum\s*\(/;
const ZOD_LITERAL = /^z\s*\.\s*literal\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*\)/;
const ZOD_STRING = /^z\s*\.\s*(?:string|coerce\s*\.\s*string)\s*\(/;
const ZOD_EMAIL = /^z\s*\.\s*email\s*\(/;
const ZOD_URL = /^z\s*\.\s*url\s*\(/;
const ZOD_DATE = /^z\s*\.\s*(?:date|iso\s*\.\s*(?:date|datetime))\s*\(/;
const ZOD_NUMBER = /^z\s*\.\s*(?:number|int|coerce\s*\.\s*(?:number|int))\s*\(/;
const ZOD_BOOLEAN = /^z\s*\.\s*(?:boolean|coerce\s*\.\s*boolean)\s*\(/;

function mapZodValue(key: string, expr: string, i: number, warnings: string[]): FieldSpec {
  const min = numericArg(expr, "min");
  const max = numericArg(expr, "max");
  const f: FieldSpec = { id: `imp_${i + 1}`, name: key, label: prettify(key), kind: "string", required: !ZOD_OPTIONAL_RE.test(expr) };
  const described = matchDescribe(expr);
  if (described) f.description = described;

  if (ZOD_ARRAY.test(expr)) {
    const options = zodEnumOptions(expr);
    if (options && options.length) {
      f.kind = "multi";
      f.options = options;
    } else {
      warnings.push(`${key}: an array without a fixed z.enum([…]) — used a text field.`);
    }
    return f;
  }
  if (ZOD_ENUM.test(expr)) {
    const options = zodEnumOptions(expr);
    if (options && options.length) {
      f.kind = "enum";
      f.options = options;
    } else {
      warnings.push(`${key}: a z.enum(…) without readable string options — used a text field.`);
    }
    return f;
  }
  const literal = ZOD_LITERAL.exec(expr);
  if (literal) {
    f.kind = "enum";
    f.options = [unescapeLiteral(literal[1])];
    return f;
  }
  if (ZOD_STRING.test(expr)) {
    if (/\.\s*email\s*\(/.test(expr)) f.format = "email";
    else if (/\.\s*url\s*\(/.test(expr)) f.format = "url";
    // A required string is at least one character anyway, so `.min(1)` adds nothing.
    f.min = f.required && min === 1 ? undefined : min;
    f.max = max;
    return f;
  }
  if (ZOD_EMAIL.test(expr)) {
    f.format = "email";
    return f;
  }
  if (ZOD_URL.test(expr)) {
    f.format = "url";
    return f;
  }
  if (ZOD_DATE.test(expr)) {
    f.kind = "date";
    return f;
  }
  if (ZOD_NUMBER.test(expr)) {
    f.kind = "number";
    f.min = min;
    f.max = max;
    return f;
  }
  if (ZOD_BOOLEAN.test(expr)) {
    f.kind = "boolean";
    return f;
  }
  warnings.push(`${key}: unsupported Zod type "${expr.replace(/\s+/g, " ").slice(0, 60)}" — used a text field.`);
  return f;
}

export function parseZod(source: string): ImportResult {
  const warnings: string[] = [];
  const base = { format: "zod" as const, purpose: "", fields: [] as FieldSpec[], warnings };
  const src = stripComments(source);
  const objectAt = src.search(/z\s*\.\s*object\s*\(/);
  if (objectAt < 0) return { ...base, ok: false, warnings: [`No z.object({ … }) found. ${ZOD_HINT}`] };
  const braceAt = src.indexOf("{", src.indexOf("(", objectAt));
  if (braceAt < 0) return { ...base, ok: false, warnings: [`z.object( has no { … } body. ${ZOD_HINT}`] };
  const end = matchBrace(src, braceAt);
  if (end < 0) return { ...base, ok: false, warnings: ["Unbalanced braces in the z.object({ … }) body."] };

  const fields: FieldSpec[] = [];
  for (const entry of splitEntries(src.slice(braceAt + 1, end))) {
    const colon = indexOfTopLevel(entry, ":");
    const key = colon < 0 ? "" : entry.slice(0, colon).trim().replace(/^["'`]|["'`]$/g, "");
    if (!key) {
      warnings.push(`Skipped "${entry.replace(/\s+/g, " ").slice(0, 40)}": it is not a key: value pair.`);
      continue;
    }
    fields.push(normalizeField(mapZodValue(key, entry.slice(colon + 1).trim(), fields.length, warnings)));
  }
  if (!fields.length) warnings.push("No fields found in the object.");
  return { ...base, ok: fields.length > 0, purpose: matchDescribe(src.slice(end + 1)) ?? "", fields, warnings };
}

/* ------------------------------------------------------------------ entry points */

const emptyResult = (format: ImportFormat, message: string): ImportResult => ({ ok: false, format, purpose: "", fields: [], warnings: [message] });

/** A builder file: `{ schema, uiSchema }`. */
export function parseFormFile(source: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (e) {
    return emptyResult("builder-file", `Not valid JSON: ${(e as Error).message}`);
  }
  if (!isObj(data) || !isObj(data.schema)) return emptyResult("builder-file", 'Not a builder file: expected { "schema": { … }, "uiSchema": { … } }.');
  const r = readSchema(data.schema, isObj(data.uiSchema) ? data.uiSchema : {});
  return {
    ok: r.ok,
    format: "builder-file",
    purpose: r.purpose,
    fields: r.fields,
    threshold: r.threshold,
    overrides: r.overrides,
    warnings: r.warnings,
  };
}

/** Any JSON Schema object, with or without a uiSchema next to it. */
export function parseJsonSchema(source: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (e) {
    return emptyResult("json-schema", `Not valid JSON: ${(e as Error).message}`);
  }
  if (!isObj(data)) return emptyResult("json-schema", 'Expected a JSON object with a "properties" map.');
  const r = readSchema(data, {});
  return { ok: r.ok, format: "json-schema", purpose: r.purpose, fields: r.fields, threshold: r.threshold, overrides: r.overrides, warnings: r.warnings };
}

export function parseImport(source: string): ImportResult {
  const text = source.trim();
  if (!text) return emptyResult("json-schema", "Paste a schema or a Zod object first.");
  if (text.startsWith("{")) {
    try {
      const data: unknown = JSON.parse(text);
      if (isObj(data) && isObj(data.schema)) return parseFormFile(text);
    } catch {
      // Not JSON after all: the JSON Schema reader reports the syntax error.
    }
    return parseJsonSchema(text);
  }
  return parseZod(text);
}

/** The reader behind the hash and localStorage: a builder document → in-memory state. */
export function readFormDocument(data: unknown, warn: (message: string) => void = () => {}): SavedForm | null {
  if (!isObj(data) || !isObj(data.schema)) return null;
  const r = readSchema(data.schema, isObj(data.uiSchema) ? data.uiSchema : {});
  for (const message of r.warnings) warn(message);
  return r.ok ? { purpose: r.purpose, fields: r.fields, threshold: r.threshold ?? DEFAULT_THRESHOLD, overrides: r.overrides } : null;
}
