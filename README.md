# Jev Form Builder

Describe a form as data — field names, value types, options, limits — and let a **System 1 decision model** pick the best [shadcn/ui](https://ui.shadcn.com) input component for every field. The same field spec produces the Zod schema, the live preview and the generated code.

The model can be the hosted **[TypeSafe Jev](https://typesafe.ai)** API or **[Laya](https://pypi.org/project/laya/)** running locally, through the same SDK and the same wire protocol.

## Features

### Build

- **Form builder UI** — add, edit, reorder and remove fields; set label, key, value type, required, hint, email/URL format, options and min/max.
- **Presets** — Job application, Product feedback and Account sign-up, to get going in one click.
- **Live, validated preview** — a real `react-hook-form` + Zod form you can fill in and submit; submitted values are shown as JSON.
- **Responsive layout** — the preview is a 6-column grid: full-width for long answers, half for short paired fields, a third for tiny ones, collapsing to one column on narrow screens. Section headings come from the layout picks and can be renamed in place (the rename stays client-side).
- **Manual overrides** — change any field’s component from the preview; “↺ Let Jev decide” gives control back.

### Decide

- **AI component picking** — for each field, the model chooses among the components that can hold its value type (e.g. *Slider* vs *Number input* for a rating), reading the whole form as context.
- **Secret detection** — every text field also gets a yes/no question: “should this be masked while typing?” (passwords, card numbers…).
- **Model-driven layout** — in the same request, every field is also asked how wide it should be (`full` / `half` / `third`, with descriptive criteria) and whether it starts a new logical section; fields predicted to open one are asked to pick a heading from a fixed list (Identity, Contact, Details, Preferences, Legal / consent, Other), since the model writes no prose.
- **Confidence gate** — a threshold slider decides when to trust the model; below it, the pick falls back to a rule-based default and the badge shows what the model leaned towards. The number is the probability of the chosen option on every backend, so the slider means the same thing with Jev and Laya. Each layout question is gated on its own confidence too: an unsure width keeps the model’s probabilities for display but lays the field out by the rules.
- **Decisions tab** — per field, the probability for every candidate component, the probability of each width, the “starts a section?” probability and the heading probabilities — plus where each decision came from (`Jev`, `Rule`, `Only option`, `Jev unsure`, `Your choice`).

### Backends

- **Backend switch** — the header picks who answers: hosted **Jev**, **Laya** on your machine, or **rules only**. `/api/status` probes what is reachable (Jev needs a key, Laya needs `/health`), the selector defaults to the best of the three, and the choice is part of the cache key.
- **Local mode with Laya** — one script runs Laya on your machine with `uvx`; nothing to install, no API key, no network calls after the first model download.
- **Evaluation** — `bun run eval` runs the three presets through every available backend and prints accuracy, average confidence, latency and per-field mismatches.
- **Never breaks** — no API key, a failed call or a low-confidence answer all fall back to plain rules. Latency, model name and token usage are shown in the header.
- **Cheap and stable** — picks are cached per field spec, so editing one field only re-asks about that field; requests are debounced.

### Export

- **Code tab** — three sub-tabs, each with copy-to-clipboard: a complete self-contained `<GeneratedForm />` (react-hook-form + zodResolver + the picked shadcn components, downloadable as `.tsx`), the Zod schema, and the exact `npx shadcn@latest add …` / `npm install …` commands that file needs.
- **Verified output** — `bun run verify:codegen` compiles the generated file for every preset, and `bun run shadcn:sync` installs any shadcn component the catalogue needs.

### Import and share

- **Import** — paste a JSON Schema object, a file exported by this builder, or a Zod `z.object({ … })` source snippet (parsed by hand, never evaluated). Type, format, enum, `items.enum`, bounds, required list, title and hint are mapped; `ui:widget` becomes a component override; anything the builder cannot express is listed as a warning before you apply it.
- **Save and share** — the form (purpose, fields, threshold, overrides) is kept in the URL hash, compressed and URL-safe, so the address bar is already a working link; **Copy link** puts it on the clipboard. localStorage autosaves the same document, and a plain URL with no hash restores it.
- **Export / import the document** — **Export JSON** downloads `{ "schema": …, "uiSchema": … }`: JSON Schema draft 2020-12 (`description` = purpose, `title` = label, `description` = hint, `enum`, `items.enum`, `minimum`/`maximum`, `minLength`/`maxLength`, `format: date | email | uri`, `required`, `x-threshold`) plus an RJSF-style uiSchema (`ui:order`, `ui:widget`). Importing that file back rebuilds exactly the same fields, and `bun run test:import` checks it for all three presets.

### Component catalogue

| Value type        | Components                          |
| ----------------- | ----------------------------------- |
| Text              | Input · Textarea · Input OTP        |
| Number            | Number input · Slider               |
| Yes / No          | Switch · Checkbox                   |
| One of a list     | Radio group · Select · Combobox     |
| Several of a list | Checkbox group · Toggle chips       |
| Date              | Date picker · Date input            |

## Quick start

Requires Node 20.12+ (or Bun). Local mode also needs [uv](https://docs.astral.sh/uv/).

```bash
bun install          # or npm install
```

### With hosted Jev

```bash
echo "TYPESAFE_API_KEY=your-key" > .env
bun run dev
```

Open http://localhost:5173. Without a key the app still works, using the rules only.

### With local Laya

```bash
bun run dev:laya
```

This starts, side by side:

| Process | What it does                                                                 |
| ------- | ---------------------------------------------------------------------------- |
| `laya`  | `laya-serve` via `uvx` on http://localhost:8000 (English checkpoint, CPU)     |
| `api`   | The Hono API on :3001, pointed at Laya with `LAYA_URL`                       |
| `web`   | Vite on http://localhost:5173                                                |
| `open`  | Waits for Laya to be healthy, then opens its API docs at `/docs`             |

The first run downloads PyTorch and the checkpoint (a few GB). Until Laya is up, picks come from the rules. Your `.env` is not needed or changed: the script sets `LAYA_URL` and the Laya client uses a placeholder key.

## Scripts

| Script             | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| `dev`              | API + web, using hosted Jev (or rules without a key)           |
| `dev:laya`         | Laya + API + web, fully local                                  |
| `laya`             | Laya server only, on CPU                                       |
| `laya:gpu`         | Laya server only, on CUDA, all checkpoints preloaded           |
| `eval`             | Score every available backend against `shared/expected.ts`     |
| `build`            | Typecheck and build the web app into `dist/`                   |
| `start`            | Production server: API plus the built app on :3001             |
| `typecheck`        | TypeScript check                                               |
| `test:import`      | Assert the JSON Schema ↔ `FieldSpec` mapping, the `{ schema, uiSchema }` round-trip for every preset, and the share codec |
| `verify:codegen`   | Generate the Code tab for every preset into `src/__generated__/` and compile it with `tsc` |
| `shadcn:sync`      | Read `shared/catalog.ts` and `shadcn add` any missing component (`--dry-run` to preview) |

## How it works

**1. The catalogue is data.** Each component’s `when` text is the description the model reads for that option (`shared/catalog.ts`).

```ts
{ id: "slider", accepts: ["number"], when: "A value chosen along a bounded scale, such as a rating…" },
{ id: "number", accepts: ["number"], when: "An exact number the user types in, such as a quantity…" },
```

**2. Code filters, the model chooses.** Hard rules stay in code: only components that accept the value type are candidates. Then one isolated question per decision, all in a single request, with the whole form as state (`server/pick.ts`).

```ts
questions[`c_${f.id}`] = choice(
  { task: "Choose the best input component for this form field…", field: describe(f) },
  Object.fromEntries(candidates.map((c) => [c.id, c.when])),
);
if (f.kind === "string")
  questions[`s_${f.id}`] = noul({ statement: "This form field asks for a secret that should be masked…", field: describe(f) });
// Layout, in the same request: width for every field, section break for all but the first,
// and a heading from a fixed list for the fields the rules predict will open a section.
questions[`w_${f.id}`] = choice({ task: "How wide should this form field be…", field: identify(f) }, widthCriteria());
if (i > 0)
  questions[`n_${f.id}`] = noul({ statement: "This form field starts a new logical section…", field: identify(f) });
if (ruleStartsSection(req.fields, i))
  questions[`t_${f.id}`] = choice({ task: "Which heading fits the section…", field: identify(f) }, titleCriteria());

const res = await client.systemOne({ state: { form_purpose, fields }, questions });
```

The layout rules — criteria the model reads, rule fallbacks, the confidence gate and section grouping — live in `shared/layout.ts`, so the client and the server share exactly one definition.

**3. Confidence gate.** Act on the pick when the model is sure, otherwise use `ruleFor(field)`. Laya reports the margin between the top two options in `confidence` and the probability of the chosen option in `answer_confidence`; Jev only has `confidence`. `server/pick.ts` reads `answer_confidence` when present, so `Pick.confidence` is always a probability.

**4. Backends are a runtime choice.** `server/backends.ts` owns the three clients: Jev (needs `TYPESAFE_API_KEY`), Laya (same SDK, `baseURL` from `LAYA_URL`, default `http://localhost:8000`, placeholder key) and rules. `POST /api/pick` takes an optional `backend`; `GET /api/status` reports which are reachable, and the header selector defaults to the best one. The pick cache key includes the backend, so switching never serves the other backend’s answers.

**5. One spec, everything else derived.** `FieldSpec[]` → Zod schema → `react-hook-form` resolver → renderer per component id (`shared/schema.ts`, `src/catalog-render.tsx`).

**6. The same spec exports a real file.** `shared/codegen.ts` turns the current picks into a self-contained `<GeneratedForm />` — imports, schema, defaults and one `<FormField>` per field — plus the shadcn/npm install commands it needs. Its templates mirror `src/catalog-render.tsx`. `bun run verify:codegen` writes every preset to `src/__generated__/` and compiles the output against this repo’s own shadcn components, so the exported file is known to typecheck.

**7. The key stays on the server.** The Vite app only calls `POST /api/pick` on the small Hono server.

**8. The eval uses the same code path.** `bun run eval` runs `scripts/eval.ts`, which imports `pickComponents` in-process (no API server needed), runs the presets through rules, Laya and Jev, and compares the picks against `shared/expected.ts`.

**9. The saved form is JSON Schema + uiSchema.** `shared/import.ts` maps `FieldSpec[]` both ways: purpose → `schema.description`, label and hint → `title` / `description`, `required` → `schema.required`, kind → `type` / `format` / `enum` / `items.enum`, overrides → `uiSchema[name]["ui:widget"]`, field order → `uiSchema["ui:order"]` and the threshold → `schema["x-threshold"]`. The downloaded file, the URL hash and the localStorage autosave are that one document, so a link and a file are interchangeable; `bun run test:import` proves every preset round-trips to the same fields, and any general JSON Schema can be read, with a warning for each part the builder has no equivalent for.

### Adding a component

1. Add an entry to `CATALOG` in `shared/catalog.ts` (id, accepted value types, `when` description).
2. Add a renderer for that id in `src/catalog-render.tsx`.
3. Add a JSX template and a registry mapping for it in `shared/codegen.ts`.

The model can start choosing it right away. `bun run shadcn:sync` installs any component file the catalogue needs and tells you which ids still have no renderer — the templates themselves stay hand-written.

## Project layout

```
server/
  index.ts        Hono API: /api/status, /api/pick, static files in production
  backends.ts     Jev / Laya / rules: clients, health probe, best-available choice
  pick.ts         Candidate filtering, model call, caching, confidence gate
shared/
  catalog.ts      Component catalogue + rule-based fallbacks
  layout.ts       Width/section criteria sent to the model, layout rules, grouping
  schema.ts       FieldSpec → Zod schema (runtime and source code)
  codegen.ts      Picks → <GeneratedForm /> source + shadcn/npm install commands
  types.ts        FieldSpec, Pick, Backend, request/response types
  expected.ts     Right answer per preset field, for the eval
  import.ts       JSON Schema + uiSchema ⇄ FieldSpec, Zod snippet parser, share document
  form-json.ts    In-memory SavedForm model (field ids stay runtime-only)
scripts/
  eval.ts         Scores each backend against shared/expected.ts
  verify-codegen.ts    Generate every preset and tsc the result (verify:codegen)
  shadcn-sync.ts       `shadcn add` whatever the catalogue is missing (shadcn:sync)
src/
  App.tsx         Builder, tabs, threshold, backend selector, status header
  presets.ts      Example forms
  persist.ts      URL hash + localStorage autosave, copy link, export JSON
  catalog-render.tsx   Component id → shadcn renderer
  components/     FieldEditor, FormPreview, PickBadge, BackendPicker, CodeTab, ImportDialog, LayoutDecisions, SectionHeading, shadcn ui/
```

## Notes on Laya

`laya-serve` speaks the same `POST /v1/systemone` protocol as Jev, so the same SDK talks to both; only the base URL, the API key and the timeout differ (`server/backends.ts`).

- The base Laya checkpoints are not fine-tuned for this task, so expect weaker and less confident picks than Jev; more fields will land on the rule default.
- Laya’s `confidence` behaves like a margin between options (near 0 when two options are close), while `answer_confidence` is the probability of the chosen option. The gate reads `answer_confidence` when present, so both backends gate on a probability.
- On CPU a full preset is a single request of roughly 15 seconds (10 fields, CPU-only, English checkpoint), so the Laya client overrides the SDK’s 10-second default timeout with 120 seconds. Jev keeps the default.
- The layout questions add up to three more per field (width, section break, heading), so a full preset sends roughly twice the questions and takes correspondingly longer on CPU; small forms answer in a few seconds, large ones may still fall back to the rules. The preview stays correct either way.
- Yes/no (`noul`) answers are less reliable on the English checkpoint; check the “masked” flags.
- `bun run eval` prints the whole picture per backend: component accuracy, accuracy under the default gate, masked-flag accuracy, average confidence and latency.

### Eval results

22 component decisions and 7 masked-flag decisions across the three presets. Laya was run locally on CPU with the English checkpoint.

| Backend | Component accuracy | With 0.5 gate | Masked flag | Avg confidence | Time per preset |
| ------- | ------------------ | ------------- | ----------- | -------------- | --------------- |
| Rules   | 22/22 (100%)       | —             | —           | —              | ~3 ms           |
| Laya    | 8/22 (36%)         | 14/22 (64%)   | 2/7         | 0.51           | ~5–15 s         |
| Jev     | not measured yet   |               |             |                |                 |

The rules score is flattering: they were written with these same presets in mind. The gated Laya score is mostly the rules taking over from low-confidence picks. Fine-tuning Laya on form-field decisions would be the way to close the gap.

## Roadmap

In progress on separate branches:

- **More components and value types** — toggle group, stepper, star rating, input with prefix/suffix; new types for time, date range, number range and file upload.

## Stack

React 19 · Vite · Tailwind CSS 4 · shadcn/ui (Radix) · react-hook-form · Zod 4 · Hono · `@typesafe-ai/sdk` · Laya
