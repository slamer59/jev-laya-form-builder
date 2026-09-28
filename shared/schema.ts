import { z } from "zod";
import type { FieldSpec } from "./types";

/** Field specs → Zod schema. The same schema validates the live preview. */
export function fieldToZod(f: FieldSpec): z.ZodType {
  const req = `${f.label} is required`;
  switch (f.kind) {
    case "string": {
      if (f.format) {
        const s = f.format === "email" ? z.email("Enter a valid email") : z.url("Enter a valid URL");
        return f.required ? s : s.or(z.literal(""));
      }
      let s = z.string();
      const minLen = f.required ? Math.max(1, f.min ?? 1) : f.min;
      if (minLen) s = s.min(minLen, f.min ? `At least ${f.min} characters` : req);
      if (f.max != null) s = s.max(f.max, `At most ${f.max} characters`);
      return f.required ? s : s.or(z.literal("")); // optional text may be left empty
    }
    case "number": {
      let n = z.number({ error: req });
      if (f.min != null) n = n.min(f.min, `Must be at least ${f.min}`);
      if (f.max != null) n = n.max(f.max, `Must be at most ${f.max}`);
      return f.required ? n : n.optional();
    }
    case "boolean":
      return f.required ? z.boolean().refine((v) => v, req) : z.boolean();
    case "enum": {
      const opts = f.options?.length ? f.options : [""];
      const e = z.enum(opts as [string, ...string[]], { error: req });
      return f.required ? e : e.optional();
    }
    case "multi": {
      const opts = f.options?.length ? f.options : [""];
      const a = z.array(z.enum(opts as [string, ...string[]]));
      return f.required ? a.min(1, `Pick at least one`) : a;
    }
    case "date": {
      const d = z.date({ error: req });
      return f.required ? d : d.optional();
    }
    case "time": {
      const t = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time like 09:30");
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
        .refine(([a, b]) => a >= min && b <= max && a <= b, `Must be between ${min} and ${max}`);
      return f.required ? t : t.optional();
    }
    case "file": {
      const maxBytes = f.maxSizeMb ? f.maxSizeMb * 1024 * 1024 : null;
      const one = maxBytes ? z.file({ error: req }).max(maxBytes, `Each file must be at most ${f.maxSizeMb} MB`) : z.file({ error: req });
      if (!f.multiple) return f.required ? one : one.optional();
      const many = z.array(one);
      return f.required ? many.min(1, "Add at least one file") : many.optional();
    }
  }
}

export const buildSchema = (fields: FieldSpec[]) => z.object(Object.fromEntries(fields.map((f) => [f.name, fieldToZod(f)])));

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

/** One field → the Zod expression that validates it, as source code. Shared by the Schema and Component tabs. */
export function zodCodeForField(f: FieldSpec): string {
  const req = JSON.stringify(`${f.label} is required`);
  switch (f.kind) {
    case "string": {
      let s = f.format === "email" ? `z.email()` : f.format === "url" ? `z.url()` : `z.string()`;
      if (!f.format && f.required) s += `.min(${Math.max(1, f.min ?? 1)}, ${req})`;
      else if (!f.format && f.min) s += `.min(${f.min})`;
      if (!f.format && f.max != null) s += `.max(${f.max})`;
      return f.required ? s : `${s}.or(z.literal(""))`;
    }
    case "number": {
      let s = `z.number()`;
      if (f.min != null) s += `.min(${f.min})`;
      if (f.max != null) s += `.max(${f.max})`;
      return f.required ? s : `${s}.optional()`;
    }
    case "boolean":
      return f.required ? `z.boolean().refine((v) => v, ${req})` : `z.boolean()`;
    case "enum": {
      const opts = f.options ?? [];
      // `z.enum([])` does not compile, so an option-less list falls back to a plain string.
      if (!opts.length) return `z.string()${f.required ? "" : ".optional()"}`;
      return `z.enum(${codeList(opts)})${f.required ? "" : ".optional()"}`;
    }
    case "multi": {
      const opts = f.options ?? [];
      const a = opts.length ? `z.array(z.enum(${codeList(opts)}))` : `z.array(z.string())`;
      return `${a}${f.required ? `.min(1)` : ""}`;
    }
    case "date":
      return `z.date()${f.required ? "" : ".optional()"}`;
    case "time":
      return `z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/)${f.required ? "" : '.or(z.literal(""))'}`;
    case "date-range":
      return `z.object({ from: z.date(), to: z.date() })${f.required ? "" : ".optional()"}`;
    case "range": {
      const min = f.min ?? 0;
      const max = f.max ?? 100;
      return `z.tuple([z.number(), z.number()]).refine(([a, b]) => a >= ${min} && b <= ${max} && a <= b, ${req})${f.required ? "" : ".optional()"}`;
    }
    case "file": {
      const maxBytes = f.maxSizeMb ? f.maxSizeMb * 1024 * 1024 : null;
      const one = maxBytes ? `z.file({ error: ${req} }).max(${maxBytes})` : `z.file({ error: ${req} })`;
      if (f.multiple) return `z.array(${one})${f.required ? `.min(1, ${JSON.stringify("Add at least one file")})` : ".optional()"}`;
      return f.required ? one : `${one}.optional()`;
    }
  }
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
