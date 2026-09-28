import { existsSync } from "node:fs";
import { ruleFor } from "../shared/catalog";
import { expectedFor } from "../shared/expected";
import { PRESETS } from "../src/presets";
import type { Backend, Pick, PickResponse } from "../shared/types";

// .env must load before the server modules read TYPESAFE_API_KEY, so they are imported below.
if (existsSync(".env")) process.loadEnvFile(".env");
const { pickComponents, clearPickCache } = await import("../server/pick");
const { availability, bestOf } = await import("../server/backends");

/** The app's default confidence gate, applied to the results afterwards for the "gated" column. */
const GATE = 0.5;
/** How sure the model must be for a masked/not-masked answer to count as a yes. */
const SENSITIVE_AT = 0.5;

type Stats = {
  backend: Backend;
  correct: number;
  total: number;
  gatedCorrect: number;
  maskedCorrect: number;
  maskedTotal: number;
  confSum: number;
  confCount: number;
  latencyMs: number;
  requests: number;
  model?: string;
  error?: string;
  mismatches: string[];
};

/** One row per preset request; the cache is cleared so every backend starts from nothing. */
async function runBackend(backend: Backend): Promise<Stats> {
  clearPickCache();
  const s: Stats = {
    backend,
    correct: 0,
    total: 0,
    gatedCorrect: 0,
    maskedCorrect: 0,
    maskedTotal: 0,
    confSum: 0,
    confCount: 0,
    latencyMs: 0,
    requests: 0,
    mismatches: [],
  };

  for (const [preset, form] of Object.entries(PRESETS)) {
    const expected = expectedFor(preset, form);
    let res: PickResponse;
    try {
      // threshold 0 keeps the model's raw pick, so backends stay comparable; the gate is applied below.
      res = await pickComponents({ ...form, backend, threshold: 0 });
    } catch (e) {
      s.error = `${preset}: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }
    s.model ??= res.model;
    if (res.error) s.error = res.error;
    s.latencyMs += res.latencyMs;
    s.requests++;

    for (const f of form.fields) {
      const pick: Pick | undefined = res.picks[f.id];
      if (!pick) continue;
      const want = expected[f.name];
      s.total++;
      if (want.components.includes(pick.component)) s.correct++;
      if (pick.confidence != null) {
        s.confSum += pick.confidence;
        s.confCount++;
      }
      // What the app would actually render with the default gate on.
      const gated = (pick.confidence ?? 0) >= GATE ? pick.component : ruleFor(f);
      if (want.components.includes(gated)) s.gatedCorrect++;

      const notes: string[] = [];
      if (want.masked !== undefined) {
        s.maskedTotal++;
        const masked = (pick.sensitive ?? 0) >= SENSITIVE_AT;
        if (masked === want.masked) s.maskedCorrect++;
        else notes.push(`masked=${masked}, want ${want.masked}`);
      }
      if (!want.components.includes(pick.component)) {
        const conf = pick.confidence != null ? ` conf ${pick.confidence.toFixed(2)}` : "";
        const gate = gated !== pick.component ? `, gate → ${gated}` : "";
        s.mismatches.push(
          `${preset} · ${f.name}: expected ${want.components.join("/")}, got ${pick.component}${conf}${gate}${notes.length ? ` [${notes.join("; ")}]` : ""}`,
        );
      } else if (notes.length) {
        s.mismatches.push(`${preset} · ${f.name}: ${pick.component} ok, but ${notes.join("; ")}`);
      }
    }
  }
  return s;
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "—");
const pad = (s: string, w: number) => s.padEnd(w);

const available = await availability();
const order = (["rules", "laya", "jev"] as Backend[]).filter((b) => available[b]);

console.log(
  `Backends — jev: ${available.jev ? "key set" : "no TYPESAFE_API_KEY"}, laya: ${available.laya ? "healthy" : "not answering"}, rules: always`,
);
console.log(`Running ${Object.keys(PRESETS).length} presets through: ${order.join(", ")} (default ${bestOf(available)})\n`);

const rows = [];
for (const backend of order) rows.push(await runBackend(backend));

console.log(
  `${pad("backend", 9)}${pad("model", 16)}${pad("components", 12)}${pad("gated@0.5", 12)}${pad("masked", 12)}${pad("avg conf", 10)}avg latency`,
);
for (const s of rows) {
  console.log(
    `${pad(s.backend, 9)}${pad(s.model ?? "—", 16)}${pad(`${s.correct}/${s.total} ${pct(s.correct, s.total)}`, 12)}` +
      `${pad(`${s.gatedCorrect}/${s.total} ${pct(s.gatedCorrect, s.total)}`, 12)}` +
      `${pad(s.maskedTotal ? `${s.maskedCorrect}/${s.maskedTotal} ${pct(s.maskedCorrect, s.maskedTotal)}` : "—", 12)}` +
      `${pad(s.confCount ? (s.confSum / s.confCount).toFixed(2) : "—", 10)}` +
      `${s.requests ? `${Math.round(s.latencyMs / s.requests)} ms` : "—"}`,
  );
}

console.log("\nPer-field mismatches");
for (const s of rows) {
  console.log(`\n${s.backend}${s.error ? ` — ERROR ${s.error}` : ""}`);
  if (!s.mismatches.length) console.log("  none");
  for (const m of s.mismatches) console.log(`  ${m}`);
}

console.log(
  `\n"components" is the model's own pick; "gated@0.5" is what the app renders with the default gate.` +
    `\nConfidence is the chosen option's probability (Laya's "answer_confidence"), so both backends are comparable.`,
);

if (rows.some((s) => s.error)) process.exitCode = 1;
