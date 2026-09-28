# Design log

## 2026-09-28 — Hooking functions into forms

**Question:** in a form builder where people can add their own code, how do we hook a function into a form?

**Principle:** the saved form contains only data. Code is either referenced by name or run somewhere it can do no harm. Never `eval` code that arrives in a form file or a share link.

### Layer 1 — Named hooks (default)

The form stores a reference plus arguments; the function lives in the codebase.

```jsonc
// in the schema
"email": { "type": "string", "format": "email",
  "x-hooks": { "validate": { "use": "companyEmail", "args": { "domain": "acme.com" } } } }
```

```ts
// form-hooks.ts, written by developers and reviewed like any other code
export const hooks = defineHooks({
  companyEmail: {
    kind: "validate",
    args: z.object({ domain: z.string() }),          // the builder renders a settings form from this
    run: (value: string, { domain }) => value.endsWith(`@${domain}`) || `Use your @${domain} address`,
  },
  loadCities: { kind: "options", args: z.object({ country: z.string() }), run: async ({ country }) => fetchCities(country) },
});
```

- **Safe:** a share link can only choose among functions that already exist; it cannot add code.
- **Typed:** each hook's `args` schema gives the builder a settings panel for free, and the JSON stays valid.
- **Exports cleanly:** the generated `<GeneratedForm />` does `import { hooks } from "./form-hooks"`.

This is the pattern behind RJSF's custom widgets and validators and JSON Forms' renderers.

### Layer 2 — Expressions (for people who don't write code)

Conditions and calculated values are stored as data and run by a small interpreter (JSONLogic, CEL or JSONata):

```jsonc
"x-visibleIf": { "==": [{ "var": "role" }, "Backend"] },
"x-compute":   { "*": [{ "var": "quantity" }, { "var": "unit_price" }] }
```

Nothing is executed as code, so a crafted link cannot do anything. This covers most needs: show a field when another has some value, totals, one date after another.

### Layer 3 — Real user code in a sandbox (only if really needed)

If end users must type JavaScript into the builder:

- **Store it as text** (`x-code`) and never `eval` it in the page.
- **Run it isolated:** QuickJS compiled to WebAssembly (`quickjs-emscripten`) in the browser, or `isolated-vm` / Deno on a server. No DOM, no network, no cookies; time and memory limits.
- **Pure-function contract:** it receives the field values and returns errors or a value, e.g. `(values) => string | null`, with no side effects.

### Hook points in a form

| Hook point | Contract | Example |
|---|---|---|
| `validate` (field or form) | `(value, values) => true \| message` | company email, end date after start date |
| `visibleIf` / `enabledIf` | `(values) => boolean` | show "Other…" when "Other" is picked |
| `compute` | `(values) => value` | total = quantity × price |
| `options` | `async (args, values) => string[]` | cities for the chosen country |
| `transform` (on submit) | `(values) => values` | trim, normalise a phone number |

### Plan for this repo

- Add named hooks and expressions: a `hooks` setting per field (named reference + args), and `x-visibleIf` / `x-compute` as JSONLogic.
- Where they show up:
  - the builder, with a settings panel generated from each hook's `args`
  - the live preview, which runs named hooks and expressions
  - the saved JSON Schema
  - the exported code, which imports `form-hooks.ts`
- Keep the sandbox (layer 3) for later, if end users really need to write JavaScript.
- Imported Zod `.refine()` code: if it matches a hook by name it becomes a real hook; otherwise it stays as text (`x-zod`) and is only emitted in the exported code, never run in the app.

**Status:** superseded by the next entry (hooks as a REST API).

## 2026-09-28 — Hooks as a REST API with a catalogue

**Decision:** hooks live in a registry on the server and are exposed through a REST API. The UI lists the available hooks and the user picks one, the same way the app already picks components from a catalogue. This refines layer 1 above.

### Registry

Each hook declares its name, kind, the field types it applies to, a `when` description and an args schema:

```ts
// server/hooks.ts
export const HOOKS = defineHooks({
  companyEmail: {
    kind: "validate", accepts: ["string"], pure: true,
    when: "Only accept addresses from a given company domain",
    args: z.object({ domain: z.string() }),
    run: (value, _values, { domain }) => value.endsWith(`@${domain}`) || `Use your @${domain} address`,
  },
  usernameAvailable: {
    kind: "validate", accepts: ["string"],
    when: "Check the username is not taken",
    args: z.object({}),
    run: async (value) => !(await db.users.exists(value)) || "Already taken",
  },
  citiesFor: {
    kind: "options", accepts: ["enum"],
    when: "Cities of the country picked in another field",
    args: z.object({ countryField: z.string() }),
    run: async (_v, values, a) => cities(values[a.countryField]),
  },
});
```

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/hooks` | The catalogue: name, kind, `accepts`, `when`, `pure`, and args as JSON Schema (via `z.toJSONSchema`) |
| `POST /api/hooks/:name/run` | `{ value, values, args }` → `{ ok, message }` for `validate`, `{ options }` for `options` |

### UI

- **Choosing:** the field editor gets a "Hooks" section with a dropdown filtered to hooks whose `accepts` matches the field's type.
- **Settings:** the chosen hook's args form is generated from its args JSON Schema, reusing the JSON Schema → fields reader; args are validated.
- **Saving:** the form stores only a reference, e.g. `"x-hooks": { "validate": { "use": "companyEmail", "args": { "domain": "acme.com" } } }`.
- **Running:** the live preview calls `/run`, debounced like the picks.

### Why an API rather than a bundled file

- **Hooks that need the server:** "username taken", database lookups, options from an internal service. The browser never sees secrets.
- **One place for the list:** add a hook on the server and every builder sees it, with no rebuild.
- **Remote hooks:** an entry can point to an external URL (a webhook) instead of local code. The server calls it with a timeout and a signature, like Typeform or Stripe webhooks, so teams can add hooks without touching this repo.
- **Still safe:** a saved form only names hooks; the server decides what exists and what runs.

**Trade-off:** each check is a network round trip. Hooks marked `pure: true` (no data access, like `companyEmail`) are also sent to the browser and run locally for instant feedback; server-only hooks handle anything that needs data.

### Model suggestions

The catalogue has `when` descriptions like components, so the same `systemOne` request can ask "which hook fits this field?", as a choice among the hooks that fit plus "none". A "Username" field on a sign-up form would get `usernameAvailable` suggested, shown with a badge like component picks.

### Export

The generated `<GeneratedForm />` gets either:

- `import { hooks } from "./form-hooks"` for pure hooks copied into the user's project, or
- a small client that calls the deployed `/api/hooks/:name/run`.

The Install tab lists which one applies.

### Plan

1. **First step:** the registry, `GET /api/hooks` and `POST /api/hooks/:name/run`, the field-editor UI with generated args forms, three example hooks (`companyEmail`, `usernameAvailable` with a stub store, `citiesFor`), running them in the live preview, and saving `x-hooks` in the JSON Schema.
2. **Second step:** model suggestions, remote webhook hooks, and hooks in the exported code.

**Status:** proposed, not implemented.

## 2026-09-28 — Alternatives to a REST API for hooks

The REST API is only one way to deliver the hook catalogue and run hooks. Options considered:

| Option | How it works | Good for | Downside |
|---|---|---|---|
| **1. Bundled module** | `form-hooks.ts` is compiled into the app; a Vite plugin builds the catalogue at build time | Pure hooks, instant, no server | No secrets or database access; adding a hook needs a rebuild |
| **2. shadcn-style registry** | Hooks are published as registry items (`registry:lib`), and `npx shadcn add @you/company-email` copies the source into the project | Distributing hooks; the exported form owns its code | Code copied into each project won't pick up later fixes |
| **3. MCP server** | Hooks are MCP tools: `tools/list` gives name, description and args as JSON Schema; `tools/call` runs one | One standard protocol; AI agents and other MCP clients can use the same hooks | Browsers can't speak MCP directly, so our server still sits in between; more setup than REST |
| **4. WASM plugins** (e.g. Extism) | Hooks are compiled to WebAssembly from any language and run sandboxed in the browser or on the server | Untrusted or third-party code, any language | Heavier toolchain, and harder to debug |
| **5. Serverless functions** | Each hook is a Cloudflare Worker, Supabase Edge Function or Lambda; the registry holds URLs | Scaling, and teams owning their own hooks | Latency and cold starts; remote hooks spread across many services |
| **6. Expressions only** (JSONLogic/CEL) | No functions at all, only rules stored as data | No-code users; safest option | Can't reach data ("username taken") |

### Choice: a hybrid based on the `pure` flag

- **Pure hooks → option 2 (shadcn-style registry).** It fits what exists already: `shadcn:sync` installs components and the export writes `npx shadcn add …`. The Install tab adds `npx shadcn add @forms/company-email`, and the exported form imports code it owns, with no call back to our server.
- **Server hooks (data, secrets) → REST**, as in the previous entry. It's the simplest thing a browser can call.
- **Descriptions → MCP later, if wanted.** An MCP tool description has the same shape as our catalogue (name, description, JSON Schema input), so an MCP endpoint can be added on top of the same registry without redesigning anything.
- **Expressions (JSONLogic) stay** for visibility and calculated values (layer 2).

The registry itself doesn't change. Only how a hook is delivered depends on the `pure` flag: copied as source (pure) or called over HTTP (server).

**Status:** proposed, not implemented.

## 2026-09-28 — Writing hooks without leaving the UI

**Goal:** a user must be able to write, test, save and use a hook **without ever leaving the builder UI**: no local toolchain, no terminal, no repo checkout, no deploy step.

### Background: WASM plugins (Extism)

- WebAssembly runs sandboxed at close to native speed in browsers and on servers. Extism is a plugin framework on top of it: plugins in Rust, Go, JS/TS, C, Zig, AssemblyScript, .NET…, hosts for JS (browser, Node, Deno, Bun), Rust, Go, Python…
- One `.wasm` file runs both in the browser preview and on the server.
- The manifest sets the sandbox: `memory.max_pages` (64 KiB each), `allowed_hosts` (empty = no network), `allowed_paths` (no filesystem), read-only `config`, and a `hash` so a tampered file is refused. Some hosts also cap CPU ("fuel") or add a timeout.
- Data access is granted one capability at a time through host functions, e.g. `userExists(name) → bool`, never the database itself.
- Trade-offs: heavier toolchain, large files for JS plugins (they embed a JS engine), harder debugging, untyped JSON/bytes at the boundary.

### Can WASM be built from a web interface?

| Approach | How | Languages | Leaves the UI? |
|---|---|---|---|
| **1. Compile in the browser** | The compiler itself runs in the page | AssemblyScript (`asc` is plain JS, fast and small), C/C++ (clang as WASM, tens of MB), WAT (`wabt.js`) | No |
| **2. Prebuilt engine, code as text** | Ship one generic engine (`quickjs-emscripten`) once; the hook is stored as plain JS text and loaded into the engine's sandbox at run time | JavaScript | No, and no build step at all |
| **3. Compile on a server** | The editor sends source to a build service (container with `extism-js`, `rustc`, `tinygo`) that returns `.wasm` + hash | Any | No for the user, but needs a sandboxed build service (compiling untrusted code can run code, e.g. Rust `build.rs`) |

Rust and Go have no usable in-browser compiler, so they need approach 3.

### Choice: approach 2, with an in-UI editor

- **Editor:** a Monaco code editor in the field's hook panel. The user writes a function with a fixed, typed contract per hook kind, e.g. `export function validate({ value, values, args }) { … }` returning `true` or a message.
- **Save:** the code is stored as text in the form's JSON Schema (`x-code`), so share links and exports carry it. It is never `eval`'d in the page.
- **Run:** the live preview loads it into the QuickJS sandbox (no DOM, no network, no cookies, memory and time limits), so feedback is instant and nothing is deployed.
- **Test in place:** the panel offers "try with value …" test cases next to the editor, run in the same sandbox as you type.
- **Data access:** hooks that need data call host functions the builder exposes (e.g. `userExists`), backed by the REST registry; the user still never leaves the UI.
- **Export:** the text is emitted in the exported `<GeneratedForm />`, where it can run as a normal function in the user's project.
- **Later:** approach 1 (AssemblyScript in the browser) for typed, compiled hooks; approach 3 only if Rust or Go hooks are needed.

This fits the earlier entries: named hooks from the registry and JSONLogic expressions stay; user-written code becomes one more kind of hook, stored as data and run sandboxed.

**Status:** proposed, not implemented.
