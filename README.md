# Jev Form Builder

Describe a form as data — field names, value types, options, limits — and let a **System 1 decision model** pick the best [shadcn/ui](https://ui.shadcn.com) input component for every field. The same field spec produces the Zod schema, the live preview and the generated code.

The model can be the hosted **[TypeSafe Jev](https://typesafe.ai)** API or **[Laya](https://pypi.org/project/laya/)** running locally, through the same SDK and the same wire protocol.

## Features

### Build

- **Form builder UI** — add, edit, reorder and remove fields; set label, key, value type, required, hint, email/URL format, options and min/max.
- **Presets** — Job application, Product feedback and Account sign-up, to get going in one click.
- **Live, validated preview** — a real `react-hook-form` + Zod form you can fill in and submit; submitted values are shown as JSON.
- **Manual overrides** — change any field’s component from the preview; “↺ Let Jev decide” gives control back.

### Decide

- **AI component picking** — for each field, the model chooses among the components that can hold its value type (e.g. *Slider* vs *Number input* for a rating), reading the whole form as context.
- **Secret detection** — every text field also gets a yes/no question: “should this be masked while typing?” (passwords, card numbers…).
- **Confidence gate** — a threshold slider decides when to trust the model; below it, the pick falls back to a rule-based default and the badge shows what the model leaned towards. The number is the probability of the chosen option on every backend, so the slider means the same thing with Jev and Laya.
- **Decisions tab** — per field, the probability for every candidate component and where the pick came from (`Jev`, `Rule`, `Only option`, `Jev unsure`, `Your choice`).

### Backends

- **Backend switch** — the header picks who answers: hosted **Jev**, **Laya** on your machine, or **rules only**. `/api/status` probes what is reachable (Jev needs a key, Laya needs `/health`), the selector defaults to the best of the three, and the choice is part of the cache key.
- **Local mode with Laya** — one script runs Laya on your machine with `uvx`; nothing to install, no API key, no network calls after the first model download.
- **Evaluation** — `bun run eval` runs the three presets through every available backend and prints accuracy, average confidence, latency and per-field mismatches.
- **Never breaks** — no API key, a failed call or a low-confidence answer all fall back to plain rules. Latency, model name and token usage are shown in the header.
- **Cheap and stable** — picks are cached per field spec, so editing one field only re-asks about that field; requests are debounced.

### Export

- **Code tab** — three sub-tabs, each with copy-to-clipboard: a complete self-contained `<GeneratedForm />` (react-hook-form + zodResolver + the picked shadcn components, downloadable as `.tsx`), the Zod schema, and the exact `npx shadcn@latest add …` / `npm install …` commands that file needs.
- **Verified output** — `bun run verify:codegen` compiles the generated file for every preset, and `bun run shadcn:sync` installs any shadcn component the catalogue needs.

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
| `verify:codegen`   | Generate the Code tab for every preset into `src/__generated__/` and compile it with `tsc` |
| `shadcn:sync`      | Read `shared/catalog.ts` and `shadcn add` any missing component (`--dry-run` to preview) |

## How it works

**1. The catalogue is data.** Each component’s `when` text is the description the model reads for that option (`shared/catalog.ts`).

```ts
{ id: "slider", accepts: ["number"], when: "A value chosen along a bounded scale, such as a rating…" },
{ id: "number", accepts: ["number"], when: "An exact number the user types in, such as a quantity…" },
```

**2. Code filters, the model chooses.** Hard rules stay in code: only components that accept the value type are candidates. Then one isolated question per field, all in a single request, with the whole form as state (`server/pick.ts`).

```ts
questions[`c_${f.id}`] = choice(
  { task: "Choose the best input component for this form field…", field: describe(f) },
  Object.fromEntries(candidates.map((c) => [c.id, c.when])),
);
if (f.kind === "string")
  questions[`s_${f.id}`] = noul({ statement: "This form field asks for a secret that should be masked…", field: describe(f) });

const res = await client.systemOne({ state: { form_purpose, fields }, questions });
```

**3. Confidence gate.** Act on the pick when the model is sure, otherwise use `ruleFor(field)`. Laya reports the margin between the top two options in `confidence` and the probability of the chosen option in `answer_confidence`; Jev only has `confidence`. `server/pick.ts` reads `answer_confidence` when present, so `Pick.confidence` is always a probability.

**4. Backends are a runtime choice.** `server/backends.ts` owns the three clients: Jev (needs `TYPESAFE_API_KEY`), Laya (same SDK, `baseURL` from `LAYA_URL`, default `http://localhost:8000`, placeholder key) and rules. `POST /api/pick` takes an optional `backend`; `GET /api/status` reports which are reachable, and the header selector defaults to the best one. The pick cache key includes the backend, so switching never serves the other backend’s answers.

**5. One spec, everything else derived.** `FieldSpec[]` → Zod schema → `react-hook-form` resolver → renderer per component id (`shared/schema.ts`, `src/catalog-render.tsx`).

**6. The same spec exports a real file.** `shared/codegen.ts` turns the current picks into a self-contained `<GeneratedForm />` — imports, schema, defaults and one `<FormField>` per field — plus the shadcn/npm install commands it needs. Its templates mirror `src/catalog-render.tsx`. `bun run verify:codegen` writes every preset to `src/__generated__/` and compiles the output against this repo’s own shadcn components, so the exported file is known to typecheck.

**7. The key stays on the server.** The Vite app only calls `POST /api/pick` on the small Hono server.

**8. The eval uses the same code path.** `bun run eval` runs `scripts/eval.ts`, which imports `pickComponents` in-process (no API server needed), runs the presets through rules, Laya and Jev, and compares the picks against `shared/expected.ts`.

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
  schema.ts       FieldSpec → Zod schema (runtime and source code)
  codegen.ts      Picks → <GeneratedForm /> source + shadcn/npm install commands
  types.ts        FieldSpec, Pick, Backend, request/response types
  expected.ts     Right answer per preset field, for the eval
scripts/
  eval.ts         Scores each backend against shared/expected.ts
  verify-codegen.ts    Generate every preset and tsc the result (verify:codegen)
  shadcn-sync.ts       `shadcn add` whatever the catalogue is missing (shadcn:sync)
src/
  App.tsx         Builder, tabs, threshold, backend selector, status header
  presets.ts      Example forms
  catalog-render.tsx   Component id → shadcn renderer
  components/     FieldEditor, FormPreview, PickBadge, BackendPicker, CodeTab, shadcn ui/
```

## Notes on Laya

`laya-serve` speaks the same `POST /v1/systemone` protocol as Jev, so the same SDK talks to both; only the base URL, the API key and the timeout differ (`server/backends.ts`).

- The base Laya checkpoints are not fine-tuned for this task, so expect weaker and less confident picks than Jev; more fields will land on the rule default.
- Laya’s `confidence` behaves like a margin between options (near 0 when two options are close), while `answer_confidence` is the probability of the chosen option. The gate reads `answer_confidence` when present, so both backends gate on a probability.
- On CPU a full preset is a single request of roughly 15 seconds (10 fields, CPU-only, English checkpoint), so the Laya client overrides the SDK’s 10-second default timeout with 120 seconds. Jev keeps the default.
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

- **Model-driven layout** — the model also decides each field’s width (full, half, third) and where sections start; the preview becomes a responsive grid with section headings.
- **More components and value types** — toggle group, stepper, star rating, input with prefix/suffix; new types for time, date range, number range and file upload.
- **Import, save and share** — forms saved as JSON Schema + an RJSF-style `uiSchema`, shareable by link, autosaved locally; import from JSON Schema or a Zod snippet.

## Stack

React 19 · Vite · Tailwind CSS 4 · shadcn/ui (Radix) · react-hook-form · Zod 4 · Hono · `@typesafe-ai/sdk` · Laya
