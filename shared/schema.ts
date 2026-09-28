import { z, type GlobalMeta } from "zod";
import { KEY_ERROR_MESSAGE, X_ACCEPT, X_MAX_SIZE_MB, X_MULTIPLE, X_PREFIX, X_SUFFIX, X_THRESHOLD, X_ZOD } from "./form-json";
import type { FieldSpec } from "./types";

/** The time field's pattern, shared by validation, the generated code and the Zod reader. */
export const TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d$";

/**
 * The message a keyword gets when the builder regenerates it from the label and
 * settings. `fieldToZod`, `zodCodeForField` and the importer all read this, so a
 * hand-written message is only kept when it actually differs (it then lives in
 * `errorMessage`, the ajv-errors keyword).
 */
export function defaultMessage(f: FieldSpec, keyword: string): string {
  const required = `${f.label} is required`;
  switch (keyword) {
    case "minLength":
      return f.min ? `At least ${f.min} characters` : required;
    case "maxLength":
      return f.kind === "file" ? `Each file must be at most ${f.maxSizeMb} MB` : `At most ${f.max} characters`;
    case "minimum":
      return f.kind === "range" ? `Must be between ${f.min ?? 0} and ${f.max ?? 100}` : `Must be at least ${f.min}`;
    case "maximum":
      return `Must be at most ${f.max}`;
    case "minItems":
      return f.kind === "file" ? "Add at least one file" : "Pick at least one";
    case "pattern":
      return "Enter a time like 09:30";
    case "format":
      return f.format === "email" ? "Enter a valid email" : "Enter a valid URL";
    default:
      return required; // "type", "enum" and "const" all mean "you did not fill this in"
  }
}

/** The message to use for a keyword: the hand-written one, or the regenerated default. */
export const messageFor = (f: FieldSpec, keyword: string) => f.errorMessage?.[keyword] ?? defaultMessage(f, keyword);

/** Field specs → Zod schema. The same schema validates the live preview. */
export function fieldToZod(f: FieldSpec): z.ZodType {
  const req = messageFor(f, "type");
  switch (f.kind) {
    case "string": {
      if (f.format) {
        const s = f.format === "email" ? z.email(messageFor(f, "format")) : z.url(messageFor(f, "format"));
        return f.required ? s : s.or(z.literal(""));
      }
      let s = z.string();
      const minLen = f.required ? Math.max(1, f.min ?? 1) : f.min;
      if (minLen) s = s.min(minLen, messageFor(f, "minLength"));
      if (f.max != null) s = s.max(f.max, messageFor(f, "maxLength"));
      return f.required ? s : s.or(z.literal("")); // optional text may be left empty
    }
    case "number": {
      let n = z.number({ error: req });
      if (f.min != null) n = n.min(f.min, messageFor(f, "minimum"));
      if (f.max != null) n = n.max(f.max, messageFor(f, "maximum"));
      return f.required ? n : n.optional();
    }
    case "boolean":
      return f.required ? z.boolean().refine((v) => v, messageFor(f, "const")) : z.boolean();
    case "enum": {
      const opts = f.options?.length ? f.options : [""];
      const e = z.enum(opts as [string, ...string[]], { error: messageFor(f, "enum") });
      return f.required ? e : e.optional();
    }
    case "multi": {
      const opts = f.options?.length ? f.options : [""];
      const a = z.array(z.enum(opts as [string, ...string[]]));
      return f.required ? a.min(1, messageFor(f, "minItems")) : a;
    }
    case "date": {
      const d = z.date({ error: req });
      return f.required ? d : d.optional();
    }
    case "time": {
      const t = z.string().regex(new RegExp(TIME_PATTERN), messageFor(f, "pattern"));
      return f.required ? t : t.or(z.literal(""));
    }
    case "date-range": {
      const r = z.object({ from: z.date({ error: "Pick a start date" }), to: z.date({ error: "Pick an end date" }) });
      return f.required ? r : r.optional();
    }
    case "range": {
      const min = f.min ?? 0;
      const max = f.max ?? 100;
      const t = z
        .tuple([z.number({ error: req }), z.number({ error: req })])
        .refine(([a, b]) => a >= min && b <= max && a <= b, messageFor(f, "minimum"));
      return f.required ? t : t.optional();
    }
    case "file": {
      const maxBytes = f.maxSizeMb ? f.maxSizeMb * 1024 * 1024 : null;
      const one = maxBytes ? z.file({ error: req }).max(maxBytes, messageFor(f, "maxLength")) : z.file({ error: req });
      if (!f.multiple) return f.required ? one : one.optional();
      const many = z.array(one);
      return f.required ? many.min(1, messageFor(f, "minItems")) : many.optional();
    }
  }
}

/**
 * The builder-only settings JSON Schema has no place for, attached as metadata:
 * `z.toJSONSchema` copies it into the document as `x-` extensions (see
 * `shared/import.ts`). `title` and `description` are ordinary JSON Schema keywords.
 */
export function fieldMeta(f: FieldSpec): GlobalMeta {
  const meta: GlobalMeta = { title: f.label };
  if (f.description) meta.description = f.description;
  if (f.prefix) meta[X_PREFIX] = f.prefix;
  if (f.suffix) meta[X_SUFFIX] = f.suffix;
  if (f.accept) meta[X_ACCEPT] = f.accept;
  if (f.maxSizeMb != null) meta[X_MAX_SIZE_MB] = f.maxSizeMb;
  if (f.multiple) meta[X_MULTIPLE] = true;
  if (f.customZod) meta[X_ZOD] = f.customZod;
  if (f.errorMessage && Object.keys(f.errorMessage).length) meta[KEY_ERROR_MESSAGE] = f.errorMessage;
  return meta;
}

export type FormMeta = { purpose?: string; threshold?: number };

/**
 * The one schema behind everything: the live preview validates with it, and
 * `shared/import.ts` writes it out with `z.toJSONSchema`. The document is
 * therefore generated, never hand-written — the builder's own settings travel
 * as metadata (`fieldMeta` here, purpose and threshold on the object).
 */
export function buildSchema(fields: FieldSpec[], form: FormMeta = {}) {
  const object = z.object(Object.fromEntries(fields.map((f) => [f.name, fieldToZod(f).meta(fieldMeta(f))])));
  const meta: GlobalMeta = {};
  if (form.purpose) meta.description = form.purpose;
  if (form.threshold != null) meta[X_THRESHOLD] = form.threshold;
  return Object.keys(meta).length ? object.meta(meta) : object;
}

export function defaultValueFor(f: FieldSpec, component: string): unknown {
  switch (f.kind) {
    case "string":
    case "time":
      return "";
    case "number":
      return component === "slider" || component === "stepper" ? (f.min ?? 0) : undefined;
    case "boolean":
      return false;
    case "multi":
      return [];
    case "file":
      return f.multiple ? [] : undefined;
    case "range":
      return [f.min ?? 0, f.max ?? 100];
    default:
      return undefined;
  }
}

/** A string list as TypeScript source, wrapped when it would get too long for one line. */
export const codeList = (xs: readonly string[], indent = "  "): string => {
  const items = xs.map((x) => JSON.stringify(x));
  const oneLine = `[${items.join(", ")}]`;
  if (oneLine.length <= 100) return oneLine;
  return `[\n${items.map((item) => `${indent}${item},`).join("\n")}\n]`;
};

/**
 * One field → the Zod expression that validates it, as source code. Shared by the
 * Schema and Component tabs. Constraints come first, then any custom code kept
 * verbatim (`customZod`), then the "may be left empty" wrapper — so a hand-written
 * `.refine()` sees the field's own value, not the empty-string union.
 */
export function zodCodeForField(f: FieldSpec): string {
  return zodConstraints(f) + (f.customZod ?? "") + zodEmptyWrapper(f);
}

/** The message for a keyword, as a TS string literal, for the generated code. */
const msgCode = (f: FieldSpec, keyword: string) => JSON.stringify(messageFor(f, keyword));

function zodConstraints(f: FieldSpec): string {
  switch (f.kind) {
    case "string": {
      if (f.format) return f.format === "email" ? `z.email(${msgCode(f, "format")})` : `z.url(${msgCode(f, "format")})`;
      let s = "z.string()";
      if (f.required) s += `.min(${Math.max(1, f.min ?? 1)}, ${msgCode(f, "minLength")})`;
      else if (f.min) s += `.min(${f.min}, ${msgCode(f, "minLength")})`;
      if (f.max != null) s += `.max(${f.max}, ${msgCode(f, "maxLength")})`;
      return s;
    }
    case "number": {
      let s = `z.number({ error: ${msgCode(f, "type")} })`;
      if (f.min != null) s += `.min(${f.min}, ${msgCode(f, "minimum")})`;
      if (f.max != null) s += `.max(${f.max}, ${msgCode(f, "maximum")})`;
      return s;
    }
    case "boolean":
      return f.required ? `z.boolean().refine((v) => v, ${msgCode(f, "const")})` : "z.boolean()";
    case "enum": {
      const opts = f.options ?? [];
      // `z.enum([])` does not compile, so an option-less list falls back to a plain string.
      return opts.length ? `z.enum(${codeList(opts)}, { error: ${msgCode(f, "enum")} })` : `z.string({ error: ${msgCode(f, "type")} })`;
    }
    case "multi": {
      const opts = f.options ?? [];
      const a = opts.length ? `z.array(z.enum(${codeList(opts)}))` : "z.array(z.string())";
      return f.required ? `${a}.min(1, ${msgCode(f, "minItems")})` : a;
    }
    case "date":
      return `z.date({ error: ${msgCode(f, "type")} })`;
    case "time":
      return `z.string().regex(/${TIME_PATTERN}/, ${msgCode(f, "pattern")})`;
    case "date-range":
      return `z.object({ from: z.date({ error: "Pick a start date" }), to: z.date({ error: "Pick an end date" }) })`;
    case "range": {
      const min = f.min ?? 0;
      const max = f.max ?? 100;
      return `z.tuple([z.number(), z.number()]).refine(([a, b]) => a >= ${min} && b <= ${max} && a <= b, ${msgCode(f, "minimum")})`;
    }
    case "file": {
      const maxBytes = f.maxSizeMb ? f.maxSizeMb * 1024 * 1024 : null;
      let one = `z.file({ error: ${msgCode(f, "type")} })`;
      if (maxBytes) one += `.max(${maxBytes}, ${msgCode(f, "maxLength")})`;
      if (!f.multiple) return one;
      return f.required ? `z.array(${one}).min(1, ${msgCode(f, "minItems")})` : `z.array(${one})`;
    }
  }
}

/** How the generated expression says "the user may leave this empty". */
function zodEmptyWrapper(f: FieldSpec): string {
  if (f.required) return "";
  return f.kind === "string" || f.kind === "time" ? '.or(z.literal(""))' : ".optional()";
}

/** Field specs → Zod source code, for the Code tab. */
export function schemaToCode(fields: FieldSpec[]): string {

  const body = fields
    .map((f) => {
      const desc = f.description ? `.describe(${JSON.stringify(f.description)})` : "";
      return `  ${f.name}: ${zodCodeForField(f)}${desc},`;
    })
    .join("\n");
  return `import { z } from "zod";\n\nexport const formSchema = z.object({\n${body}\n});\n\nexport type FormValues = z.infer<typeof formSchema>;\n`;
}
