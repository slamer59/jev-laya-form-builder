import assert from "node:assert/strict";
import { formDocument, formToJson, parseFormFile, parseImport, parseJsonSchema, parseZod, readFormDocument } from "./import";
import { candidatesFor } from "./catalog";
import { buildSchema, zodCodeForField } from "./schema";
import { normalizeForm, type SavedForm } from "./form-json";
import { PRESETS } from "../src/presets";
import { decodeState, encodeState, stateFromHash } from "../src/persist";
import type { FieldSpec } from "./types";

/**
 * Unit-style checks for the paste-to-form converters, the `{ schema, uiSchema }`
 * document and the share codec. Run with `bun run test:import`.
 */

const tests: { name: string; fn: () => void }[] = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

/** Field ids are runtime-only, so comparisons ignore them. */
const stripIds = (fields: FieldSpec[]) => fields.map(({ id, ...rest }) => rest);

/* ---------------------------------------------------------------- JSON Schema */

const JSON_SCHEMA = {
  title: "Job application",
  description: "Apply for the role",
  type: "object",
  required: ["full_name", "email", "role", "years_experience", "skills", "start_date"],
  properties: {
    full_name: { type: "string", title: "Full name", minLength: 2, maxLength: 80, description: "As on your ID" },
    email: { type: "string", format: "email" },
    website: { type: "string", format: "uri" },
    role: { type: "string", enum: ["Frontend", "Backend"] },
    seniority: { enum: ["junior", "senior"] },
    years_experience: { type: "integer", minimum: 0, maximum: 50 },
    rating: { type: "number", exclusiveMinimum: 0 },
    open_to_remote: { type: "boolean" },
    skills: { type: "array", items: { type: "string", enum: ["React", "Go"] } },
    start_date: { type: "string", format: "date" },
    last_seen: { type: "string", format: "date-time" },
    nickname: { type: ["string", "null"] },
    address: { type: "object", properties: { street: { type: "string" } } },
    avatar: { $ref: "#/$defs/url" },
    tags: { type: "array", items: { type: "string" } },
    uuid: { type: "string", format: "uuid" },
  },
};

test("JSON Schema: maps type, format, enum, items.enum, bounds and required", () => {
  const r = parseJsonSchema(JSON.stringify(JSON_SCHEMA));
  assert.equal(r.ok, true);
  assert.equal(r.format, "json-schema");
  assert.equal(r.purpose, "Apply for the role");
  assert.deepEqual(r.fields, [
    { id: "imp_1", name: "full_name", label: "Full name", kind: "string", required: true, description: "As on your ID", min: 2, max: 80 },
    { id: "imp_2", name: "email", label: "Email", kind: "string", required: true, format: "email" },
    { id: "imp_3", name: "website", label: "Website", kind: "string", required: false, format: "url" },
    { id: "imp_4", name: "role", label: "Role", kind: "enum", required: true, options: ["Frontend", "Backend"] },
    { id: "imp_5", name: "seniority", label: "Seniority", kind: "enum", required: false, options: ["junior", "senior"] },
    { id: "imp_6", name: "years_experience", label: "Years experience", kind: "number", required: true, min: 0, max: 50 },
    { id: "imp_7", name: "rating", label: "Rating", kind: "number", required: false, min: 0 },
    { id: "imp_8", name: "open_to_remote", label: "Open to remote", kind: "boolean", required: false },
    { id: "imp_9", name: "skills", label: "Skills", kind: "multi", required: true, options: ["React", "Go"] },
    { id: "imp_10", name: "start_date", label: "Start date", kind: "date", required: true },
    { id: "imp_11", name: "last_seen", label: "Last seen", kind: "date", required: false },
    { id: "imp_12", name: "nickname", label: "Nickname", kind: "string", required: false },
    { id: "imp_13", name: "address", label: "Address", kind: "string", required: false },
    { id: "imp_14", name: "avatar", label: "Avatar", kind: "string", required: false },
    { id: "imp_15", name: "tags", label: "Tags", kind: "string", required: false },
    { id: "imp_16", name: "uuid", label: "Uuid", kind: "string", required: false },
  ]);
});

test("JSON Schema: every unsupported bit becomes a text field plus a warning", () => {
  const r = parseJsonSchema(JSON.stringify(JSON_SCHEMA));
  assert.deepEqual(r.warnings, [
    "Zod cannot compile this schema: Reference not found: #/$defs/url",
    "rating: exclusiveMinimum is treated as the minimum.",
    "last_seen: date-time is treated as a date (the time is dropped).",
    'address: type "object" is not supported — used a text field.',
    "address: nested or composed schemas ($ref/oneOf/anyOf/allOf) are not resolved.",
    'avatar: no "type" and no "enum" — used a text field.',
    "avatar: nested or composed schemas ($ref/oneOf/anyOf/allOf) are not resolved.",
    "tags: a list without a fixed set of options — used a text field.",
    'uuid: format "uuid" is not supported — plain text.',
  ]);
});

test("JSON Schema: broken input is reported, not thrown", () => {
  const bad = parseJsonSchema("{ not json");
  assert.equal(bad.ok, false);
  assert.match(bad.warnings[0], /^Not valid JSON/);
  const noProps = parseJsonSchema('{"type":"object"}');
  assert.equal(noProps.ok, false);
  assert.match(noProps.warnings[0], /No "properties" found/);
  const emptyProps = parseJsonSchema('{"type":"object","properties":{}}');
  assert.equal(emptyProps.ok, false);
  assert.deepEqual(emptyProps.warnings, ['The "properties" map is empty.']);
});

/* ------------------------------------------------------- the builder document */

test("Builder document: purpose, order, required, bounds, overrides and threshold live in schema/uiSchema", () => {
  const state: SavedForm = {
    purpose: "Sign up for the beta",
    fields: [
      { id: "f1", name: "email", label: "Email", kind: "string", required: true, format: "email" },
      { id: "f2", name: "plan", label: "Plan", kind: "enum", required: true, options: ["Free", "Pro"] },
      { id: "f3", name: "seats", label: "Seats", kind: "number", required: false, min: 1, max: 20 },
      { id: "f4", name: "notes", label: "Notes", kind: "string", required: false, min: 2, max: 200, description: "Anything else?" },
      { id: "f5", name: "topics", label: "Topics", kind: "multi", required: true, options: ["api", "ui"] },
      { id: "f6", name: "start", label: "Start", kind: "date", required: false },
      { id: "f7", name: "vip", label: "VIP", kind: "boolean", required: false },
    ],
    threshold: 0.65,
    overrides: { f2: "select", f7: "checkbox" },
  };
  const doc = formDocument(state);
  assert.deepEqual(Object.keys(doc.schema).sort(), ["$schema", "additionalProperties", "description", "properties", "required", "type", "x-threshold"]);
  assert.equal(doc.schema.description, "Sign up for the beta");
  assert.equal(doc.schema["x-threshold"], 0.65);
  assert.deepEqual(doc.schema.required, ["email", "plan", "topics"]);
  assert.deepEqual(doc.schema.properties, {
    email: { type: "string", format: "email", title: "Email" },
    plan: { type: "string", enum: ["Free", "Pro"], title: "Plan" },
    seats: { title: "Seats", type: "number", minimum: 1, maximum: 20 },
    // Zod writes "may be left empty" as a union with the empty string.
    notes: {
      anyOf: [
        { type: "string", minLength: 2, maxLength: 200 },
        { type: "string", const: "" },
      ],
      title: "Notes",
      description: "Anything else?",
    },
    topics: { minItems: 1, type: "array", items: { type: "string", enum: ["api", "ui"] }, title: "Topics" },
    start: { title: "Start", type: "string", format: "date" },
    vip: { type: "boolean", title: "VIP" },
  });
  assert.deepEqual(doc.uiSchema, {
    "ui:order": ["email", "plan", "seats", "notes", "topics", "start", "vip"],
    plan: { "ui:widget": "select" },
    vip: { "ui:widget": "checkbox" },
  });
  // The file never carries runtime ids.
  assert.ok(!JSON.stringify(doc).includes('"id"'));
});

test("Builder file: the reader honours ui:order, ui:widget and x-threshold", () => {
  const file = JSON.stringify({
    schema: {
      type: "object",
      description: "Contact us",
      "x-threshold": 0.8,
      required: ["message"],
      properties: {
        message: { title: "Message", type: "string" },
        email: { title: "Email", type: "string", format: "email" },
        plan: { title: "Plan", type: "string", enum: ["Free", "Pro"] },
      },
    },
    uiSchema: { "ui:order": ["email", "message", "plan", "ghost"], email: { "ui:widget": "textarea" }, ghost: { "ui:widget": "slider" } },
  });
  const r = parseFormFile(file);
  assert.equal(r.format, "builder-file");
  assert.equal(r.ok, true);
  assert.equal(r.purpose, "Contact us");
  assert.deepEqual(
    r.fields.map((f) => f.name),
    ["email", "message", "plan"],
  );
  assert.deepEqual(r.overrides, { imp_1: "textarea" }); // keyed by the regenerated id of `email`
  assert.equal(r.threshold, 0.8);
  assert.deepEqual(r.warnings, ['ui:order lists "ghost", which is not a field.', 'ui:widget is set for "ghost", which is not a field.']);

  const wrongKind = parseFormFile(JSON.stringify({ schema: { type: "object", properties: { ok: { type: "boolean" } } }, uiSchema: { ok: { "ui:widget": "slider" } } }));
  assert.deepEqual(wrongKind.warnings, ['"ok": ui:widget "slider" cannot hold a boolean value — ignored.']);
  assert.deepEqual(wrongKind.overrides, {});
});

test("Builder file: refused when it is not a document", () => {
  const r = parseFormFile('{"type":"object","properties":{"a":{"type":"string"}}}');
  assert.equal(r.ok, false);
  assert.match(r.warnings[0], /Not a builder file/);
  assert.equal(readFormDocument({ fields: [] }), null);
  assert.equal(readFormDocument(null), null);
});

/* --------------------------------------------------------------- round-trips */

test("Round-trip: every preset survives export → import with the same fields", () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    const target = preset.fields[0];
    const widget = candidatesFor(target.kind).at(-1)?.id;
    assert.ok(widget, name);
    const state: SavedForm = { purpose: preset.purpose, fields: preset.fields, threshold: 0.35, overrides: { [target.id]: widget } };
    const json = formToJson(state);
    const r = parseImport(json);
    assert.equal(r.format, "builder-file", name);
    assert.equal(r.ok, true, name);
    assert.equal(r.purpose, preset.purpose, name);
    assert.deepEqual(stripIds(r.fields), stripIds(preset.fields), name);
    assert.equal(r.threshold, 0.35, name);
    assert.deepEqual(r.overrides, { [r.fields[0].id]: widget }, name);
    assert.deepEqual(r.warnings, [], name);
    // Serialising what came back gives the very same file.
    const again = formToJson({ purpose: r.purpose, fields: r.fields, threshold: r.threshold ?? 0, overrides: r.overrides ?? {} });
    assert.equal(again, json, name);
    assert.deepEqual(readFormDocument(JSON.parse(json)), { purpose: r.purpose, fields: r.fields, threshold: 0.35, overrides: r.overrides }, name);
  }
});

test("Round-trip: the new kinds and their settings survive export → import", () => {
  const fields: FieldSpec[] = [
    { id: "a", name: "meeting_time", label: "Meeting time", kind: "time", required: true },
    { id: "b", name: "stay", label: "Stay", kind: "date-range", required: false, description: "Arrival and departure" },
    { id: "c", name: "budget", label: "Budget", kind: "range", required: true, min: 50, max: 500 },
    { id: "d", name: "photos", label: "Photos", kind: "file", required: false, accept: "image/*", maxSizeMb: 2, multiple: true },
    { id: "e", name: "resume", label: "Resume", kind: "file", required: true, accept: ".pdf,.docx", maxSizeMb: 5 },
    { id: "f", name: "site", label: "Site", kind: "string", required: false, prefix: "https://", suffix: ".dev" },
  ];
  const json = formToJson({ purpose: "New kinds", fields, threshold: 0.5, overrides: {} });
  const r = parseImport(json);
  assert.equal(r.format, "builder-file");
  assert.equal(r.ok, true);
  assert.deepEqual(stripIds(r.fields), stripIds(fields));
  assert.deepEqual(r.warnings, []);
  // The document is stable: what came back serialises to the same file.
  assert.equal(formToJson({ purpose: r.purpose, fields: r.fields, threshold: r.threshold ?? 0, overrides: r.overrides ?? {} }), json);
  // And it really is plain JSON Schema, with the shapes Zod cannot express filled in.
  const doc = formDocument({ purpose: "New kinds", fields, threshold: 0.5, overrides: {} });
  const props = doc.schema.properties as Record<string, unknown>;
  assert.deepEqual(props.meeting_time, { title: "Meeting time", type: "string", format: "time" });
  assert.deepEqual(props.stay, {
    title: "Stay",
    description: "Arrival and departure",
    type: "object",
    properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } },
    required: ["from", "to"],
    additionalProperties: false,
  });
  assert.deepEqual(props.budget, {
    title: "Budget",
    type: "array",
    prefixItems: [{ type: "number", minimum: 50 }, { type: "number", maximum: 500 }],
    items: false,
    minItems: 2,
    maxItems: 2,
  });
  assert.deepEqual(props.photos, {
    title: "Photos",
    "x-accept": "image/*",
    "x-maxSizeMb": 2,
    "x-multiple": true,
    type: "array",
    items: { type: "string", format: "binary", contentEncoding: "binary" },
  });
  assert.deepEqual(props.resume, {
    title: "Resume",
    type: "string",
    format: "binary",
    contentEncoding: "binary",
    "x-accept": ".pdf,.docx",
    "x-maxSizeMb": 5,
  });
  assert.deepEqual(props.site, {
    title: "Site",
    anyOf: [{ type: "string" }, { type: "string", const: "" }],
    "x-prefix": "https://",
    "x-suffix": ".dev",
  });
});

test("Round-trip: a second pass through the reader changes nothing", () => {
  const state: SavedForm = { purpose: "Twice", fields: PRESETS["Account sign-up"].fields, threshold: 0.2, overrides: {} };
  const once = parseImport(formToJson(state));
  const twice = parseImport(formToJson({ purpose: once.purpose, fields: once.fields, threshold: once.threshold ?? 0, overrides: once.overrides ?? {} }));
  assert.deepEqual(stripIds(twice.fields), stripIds(once.fields));
  assert.equal(twice.threshold, 0.2);
});

test("Auto-detect picks the right reader", () => {
  const state: SavedForm = { purpose: "Detect me", fields: PRESETS["Product feedback"].fields, threshold: 0.5, overrides: {} };
  assert.equal(parseImport(formToJson(state)).format, "builder-file");
  assert.equal(parseImport(JSON.stringify(JSON_SCHEMA)).format, "json-schema");
  assert.equal(parseImport(ZOD).format, "zod");
  assert.equal(parseImport(JSON.stringify(JSON_SCHEMA)).purpose, "Apply for the role");
  assert.equal(parseImport("").ok, false);
  assert.equal(parseImport("{}").ok, false);
  assert.equal(parseImport("{ not json").ok, false);
});

/* ------------------------------------------------- the shapes Zod cannot write */

test("The written document fixes every shape Zod cannot express", () => {
  const fields: FieldSpec[] = [
    { id: "a", name: "start", label: "Start", kind: "date", required: false },
    { id: "b", name: "stay", label: "Stay", kind: "date-range", required: true },
    { id: "c", name: "agree", label: "Agree", kind: "boolean", required: true },
    { id: "d", name: "when", label: "When", kind: "time", required: false },
    { id: "e", name: "budget", label: "Budget", kind: "range", required: true, min: 50, max: 500 },
    { id: "f", name: "resume", label: "Resume", kind: "file", required: true, accept: ".pdf", maxSizeMb: 5 },
    { id: "g", name: "email", label: "Email", kind: "string", required: true, format: "email" },
    { id: "h", name: "bio", label: "Bio", kind: "string", required: false },
  ];
  const state: SavedForm = { purpose: "Shapes", fields, threshold: 0.5, overrides: {} };
  const props = formDocument(state).schema.properties as Record<string, unknown>;
  // (a) z.date() has no JSON Schema form at all.
  assert.deepEqual(props.start, { title: "Start", type: "string", format: "date" });
  // (b) both ends of a date range are dates.
  assert.deepEqual(props.stay, {
    title: "Stay",
    type: "object",
    properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } },
    required: ["from", "to"],
    additionalProperties: false,
  });
  // (c) "must be ticked" survives, as const: true.
  assert.deepEqual(props.agree, { title: "Agree", type: "boolean", const: true });
  // (d) the time regex becomes format: time (the optional branch stays the empty-string union).
  assert.deepEqual(props.when, { title: "When", anyOf: [{ type: "string", format: "time" }, { type: "string", const: "" }] });
  // (e) a number range keeps its bounds on each end of the tuple.
  assert.deepEqual(props.budget, {
    title: "Budget",
    type: "array",
    prefixItems: [{ type: "number", minimum: 50 }, { type: "number", maximum: 500 }],
    items: false,
    minItems: 2,
    maxItems: 2,
  });
  // (f) the file's size and accept list are x- keys, not a byte maxLength.
  assert.deepEqual(props.resume, { title: "Resume", type: "string", format: "binary", contentEncoding: "binary", "x-accept": ".pdf", "x-maxSizeMb": 5 });
  // (g) the email regex is noise; format: email carries the meaning.
  assert.deepEqual(props.email, { title: "Email", type: "string", format: "email" });
  // (h) a text field that may be left empty is a union with the empty string, and comes back optional.
  assert.deepEqual(props.bio, { title: "Bio", anyOf: [{ type: "string" }, { type: "string", const: "" }] });
  const back = parseImport(formToJson(state));
  assert.deepEqual(stripIds(back.fields), stripIds(fields));
  assert.deepEqual(back.warnings, []);
});

test("Custom Zod code and hand-written messages are kept verbatim, and never run", () => {
  const r = parseZod(`z.object({
  work_email: z.string().email("Work address, please").refine((v) => v.endsWith("@acme.com"), "Company email only"),
  employee_id: z.string().min(4, "Employee ID, please").max(10),
  note: z.string().transform((v) => v.trim()).optional(),
})`);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.fields[0].customZod, '.refine((v) => v.endsWith("@acme.com"), "Company email only")');
  assert.deepEqual(r.fields[0].errorMessage, { format: "Work address, please" });
  assert.deepEqual(r.fields[1].errorMessage, { minLength: "Employee ID, please" });
  // `.max(10)` has no message of its own, so nothing was stored for it.
  assert.deepEqual(Object.keys(r.fields[1].errorMessage ?? {}), ["minLength"]);
  assert.equal(r.fields[2].customZod, ".transform((v) => v.trim())");

  // The document carries both as text…
  const state: SavedForm = { purpose: "Custom", fields: r.fields, threshold: 0.5, overrides: {} };
  const doc = formDocument(state).schema.properties as Record<string, unknown>;
  assert.deepEqual(doc.work_email, {
    type: "string",
    format: "email",
    title: "Work email",
    "x-zod": r.fields[0].customZod,
    errorMessage: { format: "Work address, please" },
  });
  assert.deepEqual(doc.note, { anyOf: [{ type: "string" }, { type: "string", const: "" }], title: "Note", "x-zod": ".transform((v) => v.trim())" });

  // …the reader gives the same fields back…
  const back = parseImport(formToJson(state));
  assert.deepEqual(stripIds(back.fields), stripIds(r.fields));
  assert.deepEqual(back.warnings, []);

  // …and the generated code re-emits it verbatim, after the constraints and before "may be empty".
  const emailCode = zodCodeForField(r.fields[0]);
  assert.ok(emailCode.startsWith('z.email("Work address, please")'), emailCode);
  assert.ok(emailCode.includes('.refine((v) => v.endsWith("@acme.com"), "Company email only")'), emailCode);
  assert.equal(
    zodCodeForField({ id: "x", name: "n", label: "N", kind: "string", required: false, customZod: ".refine((v) => v.length > 2)" }),
    'z.string().refine((v) => v.length > 2).or(z.literal(""))',
  );

  // The preview never runs it: a value that breaks the custom rule still parses.
  const schema = buildSchema([
    { id: "x", name: "work_email", label: "Work email", kind: "string", required: true, format: "email", customZod: '.refine((v) => v.endsWith("@acme.com"), "Company email only")' },
  ]);
  assert.equal(schema.safeParse({ work_email: "someone@gmail.com" }).success, true);
});

test("Documents written before the Zod writer still load", () => {
  const legacy = {
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      description: "Legacy form",
      "x-threshold": 0.3,
      required: ["full_name", "email", "skills"],
      properties: {
        full_name: { title: "Full name", type: "string" },
        email: { title: "Email", type: "string", format: "email" },
        years: { title: "Years", type: "integer", minimum: 0, maximum: 50 },
        role: { title: "Role", type: "string", enum: ["A", "B"] },
        skills: { title: "Skills", type: "array", items: { type: "string", enum: ["x", "y"] }, minItems: 1 },
        when: { title: "When", type: "string", format: "time" },
        stay: { title: "Stay", type: "object", format: "date-range", properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } } },
        budget: { title: "Budget", type: "array", items: { type: "number", minimum: 50, maximum: 500 }, minItems: 2, maxItems: 2 },
        resume: { title: "Resume", type: "string", format: "binary", "x-accept": ".pdf", "x-maxSizeMb": 5 },
        photos: { title: "Photos", type: "string", format: "binary", "x-accept": "image/*", "x-multiple": true },
        site: { title: "Site", type: "string", "x-prefix": "https://", "x-suffix": ".dev" },
      },
    },
    uiSchema: { "ui:order": ["full_name", "email", "years", "role", "skills", "when", "stay", "budget", "resume", "photos", "site"], email: { "ui:widget": "textarea" } },
  };
  const r = parseImport(JSON.stringify(legacy));
  assert.equal(r.format, "builder-file");
  assert.equal(r.ok, true);
  assert.equal(r.threshold, 0.3);
  assert.deepEqual(
    r.fields.map((f) => [f.name, f.kind, f.required]),
    [
      ["full_name", "string", true],
      ["email", "string", true],
      ["years", "number", false],
      ["role", "enum", false],
      ["skills", "multi", true],
      ["when", "time", false],
      ["stay", "date-range", false],
      ["budget", "range", false],
      ["resume", "file", false],
      ["photos", "file", false],
      ["site", "string", false],
    ],
  );
  const byName = Object.fromEntries(r.fields.map((f) => [f.name, f]));
  assert.deepEqual([byName.years.min, byName.years.max], [0, 50]);
  assert.deepEqual(byName.role.options, ["A", "B"]);
  assert.deepEqual([byName.budget.min, byName.budget.max], [50, 500]);
  assert.deepEqual([byName.resume.accept, byName.resume.maxSizeMb], [".pdf", 5]);
  assert.deepEqual([byName.photos.accept, byName.photos.multiple], ["image/*", true]);
  assert.deepEqual([byName.site.prefix, byName.site.suffix], ["https://", ".dev"]);
  assert.equal(byName.email.format, "email");
  assert.deepEqual(r.warnings, []);
});

/* ---------------------------------------------------------------------- Zod */

const ZOD = `// As generated by the builder's Code tab
import { z } from "zod";

export const formSchema = z.object({
  full_name: z.string().min(1, "Full name is required").max(80).describe("As on your ID"),
  email: z.email(),
  website: z.string().url().optional(),
  role: z.enum(["Frontend", "Backend"]),
  years: z.coerce.number().min(0).max(50),
  rating: z.number()
    .min(1)
    .max(10),
  open_to_remote: z.boolean(),
  skills: z.array(z.enum(["React", "Go"])),
  start_date: z.date(),
  bio: z.string().or(z.literal("")),
  age: z.number().int().optional(),
  opt_in: z.union([z.string(), z.null()]),
}).describe("Apply for the role");
`;

test("Zod: parses the common subset without evaluating anything", () => {
  const r = parseZod(ZOD);
  assert.equal(r.ok, true);
  assert.equal(r.format, "zod");
  assert.equal(r.purpose, "Apply for the role");
  assert.deepEqual(r.fields, [
    { id: "imp_1", name: "full_name", label: "Full name", kind: "string", required: true, description: "As on your ID", max: 80 },
    { id: "imp_2", name: "email", label: "Email", kind: "string", required: true, format: "email" },
    { id: "imp_3", name: "website", label: "Website", kind: "string", required: false, format: "url" },
    { id: "imp_4", name: "role", label: "Role", kind: "enum", required: true, options: ["Frontend", "Backend"] },
    { id: "imp_5", name: "years", label: "Years", kind: "number", required: true, min: 0, max: 50 },
    { id: "imp_6", name: "rating", label: "Rating", kind: "number", required: true, min: 1, max: 10 },
    { id: "imp_7", name: "open_to_remote", label: "Open to remote", kind: "boolean", required: true },
    { id: "imp_8", name: "skills", label: "Skills", kind: "multi", required: true, options: ["React", "Go"] },
    { id: "imp_9", name: "start_date", label: "Start date", kind: "date", required: true },
    { id: "imp_10", name: "bio", label: "Bio", kind: "string", required: false },
    // `.int()` has no data form, so it is kept verbatim as custom code.
    { id: "imp_11", name: "age", label: "Age", kind: "number", required: false, customZod: ".int()" },
    { id: "imp_12", name: "opt_in", label: "Opt in", kind: "string", required: true },
  ]);
  assert.deepEqual(r.warnings, ['opt_in: unsupported Zod type "z.union([z.string(), z.null()])" — used a text field.']);
});

test("Zod: comments, quoted keys and comma-less entries", () => {
  const r = parseZod(`z.object({
    /* who they are */
    first_name: z.string()
    last_name: z.string(),
    "favourite colour": z.enum(['red', 'blue']),
    note: z.string().nullable(),
  })`);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.fields.map((f) => [f.name, f.kind, f.required, f.options]),
    [
      ["first_name", "string", true, undefined],
      ["last_name", "string", true, undefined],
      ["favourite colour", "enum", true, ["red", "blue"]],
      ["note", "string", false, undefined],
    ],
  );
  assert.equal(r.fields[2].label, "Favourite colour");
});

test("Zod: no z.object literal is reported, not guessed", () => {
  const r = parseZod("const schema = z.record(z.string())");
  assert.equal(r.ok, false);
  assert.match(r.warnings[0], /No z\.object/);
});

/* -------------------------------------------------------------- share codec */

test("Share codec: the hash reproduces the form, and compression helps", () => {
  const state: SavedForm = { purpose: "Shared form", fields: PRESETS["Job application"].fields, threshold: 0.4, overrides: {} };
  const encoded = encodeState(state);
  const expected = normalizeForm(state);
  assert.ok(encoded.length > 0);
  assert.ok(encoded.length < JSON.stringify(state).length, "the encoded form should be smaller than raw JSON");
  const decoded = decodeState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.purpose, expected.purpose);
  assert.equal(decoded.threshold, expected.threshold);
  assert.deepEqual(decoded.fields.map((f) => f.name), expected.fields.map((f) => f.name));
  assert.deepEqual(stripIds(decoded.fields), stripIds(expected.fields));
  const fromHash = stateFromHash(`#form=${encoded}`);
  assert.ok(fromHash);
  assert.deepEqual(stripIds(fromHash.fields), stripIds(expected.fields));
  assert.deepEqual(stateFromHash(`#x=1&form=${encoded}`)?.fields.map((f) => f.name), expected.fields.map((f) => f.name));
  assert.equal(stateFromHash("#other=1"), null);
  assert.equal(stateFromHash("#form="), null);
  assert.equal(decodeState("definitely not lz"), null);
  // A block of junk that decompresses to non-string JSON must not throw either.
  assert.equal(decodeState("N4IgDgrgTmD2BOBDAdgUwFwgC4QBYgA0IA"), null);
});

/* --------------------------------------------------------------------- runner */

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`ok   ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${t.name}\n${(e as Error).message.split("\n").slice(0, 12).join("\n")}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} checks passed`);
if (failed) process.exit(1);
