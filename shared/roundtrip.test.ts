import assert from "node:assert/strict";
import { inspect } from "node:util";
import fc from "fast-check";
import { candidatesFor } from "./catalog";
import { formToJson, parseImport } from "./import";
import { normalizeForm, type SavedForm } from "./form-json";
import type { FieldSpec, Kind } from "./types";

/**
 * Property-based round-trip: any form the builder can hold must survive
 * `FieldSpec[] → { schema, uiSchema } → JSON → reader → FieldSpec[]` unchanged.
 * Ids are runtime-only and are regenerated, so they are compared by position.
 *
 * Run with `bun run test:import`.
 */

const stripIds = (fields: FieldSpec[]) => fields.map(({ id, ...rest }) => rest);

/** Text a user could type, including the characters that break naive encoders. */
const anyText = fc.string({ minLength: 1, maxLength: 24 });
const nonBlankText = anyText.filter((s) => s.trim().length > 0);
/** Custom Zod code is stored as text: quotes, backslashes, newlines and unicode all count. */
const customZod = fc.oneof(
  fc.constant('.refine((v) => v.endsWith("@acme.com"), "Company email only")'),
  fc.constant('.transform((v) => v.trim()).refine((v) => v.length > 2, "Too short")'),
  fc.constant('.refine((v) => v !== "«»\\n\\\\", "Quotes, newlines and unicode: ★ 東京")'),
  fc.string({ minLength: 1, maxLength: 40 }).map((s) => `.refine((v) => v !== ${JSON.stringify(s)})`),
);
const messages = fc
  .dictionary(
    fc.constantFrom("type", "format", "minLength", "maxLength", "minimum", "maximum", "minItems", "enum", "const", "pattern"),
    nonBlankText,
    { maxKeys: 2 },
  )
  .filter((m) => Object.keys(m).length > 0)
  // fast-check's dictionary has a null prototype; a real FieldSpec does not.
  .map((m) => ({ ...m }));
const kindArb = fc.constantFrom<Kind>("string", "number", "boolean", "enum", "multi", "date", "time", "date-range", "range", "file");

/** A field whose settings are the ones the builder actually writes for its kind. */
const fieldArb: fc.Arbitrary<FieldSpec> = fc
  .record({
    name: fc.stringMatching(/^[a-z][a-z0-9_]{0,9}$/),
    label: nonBlankText,
    kind: kindArb,
    required: fc.boolean(),
    hint: fc.option(nonBlankText, { nil: undefined }),
    custom: fc.option(customZod, { nil: undefined }),
    messages: fc.option(messages, { nil: undefined }),
  })
  .chain((base) => {
    const common = { id: `gen_${base.name}`, name: base.name, label: base.label, kind: base.kind, required: base.required };
    const extra: fc.Arbitrary<Partial<FieldSpec>> = (() => {
      switch (base.kind) {
        case "string":
          return fc.record({
            format: fc.constantFrom<"email" | "url" | undefined>("email", "url", undefined),
            min: fc.option(fc.integer({ min: 1, max: 40 }), { nil: undefined }),
            max: fc.option(fc.integer({ min: 41, max: 200 }), { nil: undefined }),
            prefix: fc.option(nonBlankText, { nil: undefined }),
            suffix: fc.option(nonBlankText, { nil: undefined }),
          });
        case "number":
          return fc.record({ min: fc.option(fc.integer({ min: -100, max: 100 }), { nil: undefined }), max: fc.option(fc.integer({ min: 101, max: 500 }), { nil: undefined }) });
        case "enum":
        case "multi":
          return fc.record({ options: fc.uniqueArray(nonBlankText, { minLength: 1, maxLength: 5 }) });
        case "range":
          return fc.record({ min: fc.option(fc.integer({ min: -50, max: 50 }), { nil: undefined }), max: fc.option(fc.integer({ min: 51, max: 500 }), { nil: undefined }) });
        case "file":
          return fc.record({
            accept: fc.option(fc.constantFrom(".pdf", "image/*", ".pdf,.docx,image/png"), { nil: undefined }),
            maxSizeMb: fc.option(fc.oneof(fc.integer({ min: 1, max: 50 }), fc.constantFrom(0.5, 0.25, 1.5)), { nil: undefined }),
            multiple: fc.boolean(),
          });
        default:
          return fc.constant<Partial<FieldSpec>>({});
      }
    })();
    return extra.map((e) => {
      const field: FieldSpec = { ...common, ...e };
      if (base.hint) field.description = base.hint;
      if (base.custom) field.customZod = base.custom;
      if (base.messages) field.errorMessage = base.messages;
      // A formatted string has no length limits: the builder's schema ignores them.
      if (field.format) {
        delete field.min;
        delete field.max;
      }
      // A required string is implicitly at least one character, so `.min(1)` is not written.
      if (base.kind === "string" && field.required && field.min === 1) delete field.min;
      // The builder stores no undefined-valued keys, so a generated field must not carry them.
      for (const key of Object.keys(field) as (keyof FieldSpec)[]) if (field[key] === undefined) delete field[key];
      return field;
    });
  });

/** A whole form: fields, overrides that always name a component the kind accepts, purpose and gate. */
const formArb: fc.Arbitrary<SavedForm> = fc
  .uniqueArray(fieldArb, { selector: (f) => f.name, minLength: 1, maxLength: 4 })
  .chain((fields) =>
    fc.tuple(fc.constant(fields), fc.subarray(fields), fc.string({ maxLength: 40 }), fc.double({ min: 0, max: 1, noNaN: true })).map(([fs, chosen, purpose, threshold]) => ({
      purpose,
      fields: fs,
      threshold,
      overrides: Object.fromEntries(
        chosen.flatMap((f) => {
          const widget = candidatesFor(f.kind)[0]?.id;
          return widget ? [[f.id, widget] as const] : [];
        }),
      ),
    })),
  );

let failed = 0;
let lastFailure = "";
const RUNS = 500;
const SEEDS: (number | undefined)[] = [undefined, 42, 2024, 7];

try {
  for (const seed of SEEDS) {
    fc.assert(
      fc.property(formArb, (raw) => {
        // The document is canonical: default-valued settings are absent, so that is the form to expect back.
        try {
          const state = normalizeForm(raw);
          const json = formToJson(state);
          const back = parseImport(json);
          assert.equal(back.format, "builder-file");
          assert.equal(back.ok, true);
          assert.deepEqual(back.warnings, []);
          assert.equal(back.purpose, state.purpose);
          assert.equal(back.threshold, state.threshold);
          // Overrides come back keyed by the regenerated ids, in field order.
          const expectedOverrides = Object.fromEntries(
            state.fields.flatMap((f, i) => (state.overrides[f.id] ? [[`imp_${i + 1}`, state.overrides[f.id]] as const] : [])),
          );
          assert.deepEqual(back.overrides, expectedOverrides);
          // And the file is canonical: what came back serialises to exactly the same bytes.
          assert.equal(formToJson({ purpose: back.purpose, fields: back.fields, threshold: back.threshold ?? 0, overrides: back.overrides ?? {} }), json);
          assert.deepEqual(stripIds(back.fields), stripIds(state.fields));
        } catch (e) {
          // fast-check prints the counterexample; this says which assertion it broke and why.
          lastFailure = `${(e as Error).message}\n raw: ${inspect(raw, { depth: null, breakLength: 160 })}`;
          throw e;
        }
      }),
      { numRuns: RUNS, seed },
    );
  }
  console.log(`ok   ${RUNS} random forms × ${SEEDS.length} seeds survive FieldSpec → document → JSON → FieldSpec`);
} catch (e) {
  failed = 1;
  console.log("FAIL property round-trip");
  if (lastFailure) console.log(lastFailure);
  console.log((e as Error).message.slice(0, 2000));
}
if (failed) process.exit(1);
