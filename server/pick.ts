import { createHash } from "node:crypto";
import { choice, noul, TypeSafeClient, type Question } from "@typesafe-ai/sdk";
import { candidatesFor, looksSensitive, ruleFor } from "../shared/catalog";
import type { FieldSpec, Pick, PickRequest, PickResponse } from "../shared/types";

const apiKey = process.env.TYPESAFE_API_KEY?.trim();
const client = apiKey ? new TypeSafeClient({ apiKey }) : null;
export const jevEnabled = !!client;

/** Picks are cached per (form purpose + field), so editing one field only re-asks for that field. */
const cache = new Map<string, Pick>();
const keyFor = (purpose: string, f: FieldSpec) =>
  createHash("sha1").update(JSON.stringify([purpose, { ...f, id: undefined }])).digest("hex");

/** Describe a field to Jev without internal ids. */
const describe = (f: FieldSpec) => ({
  name: f.name,
  label: f.label,
  value_type: f.kind,
  required: f.required,
  ...(f.description && { hint: f.description }),
  ...(f.format && { format: f.format }),
  ...(f.options && { options: f.options }),
  ...(f.min != null && { min: f.min }),
  ...(f.max != null && { max: f.max }),
});

function rulesPick(f: FieldSpec): Pick {
  const only = candidatesFor(f.kind).length === 1;
  return {
    component: ruleFor(f),
    source: only ? "only-option" : "rules",
    ...(f.kind === "string" && { sensitive: looksSensitive(f) ? 1 : 0 }),
  };
}

export async function pickComponents(req: PickRequest): Promise<PickResponse> {
  const started = performance.now();
  const threshold = req.threshold ?? 0.5;
  const picks: Record<string, Pick> = {};

  if (!client) {
    for (const f of req.fields) picks[f.id] = rulesPick(f);
    return { mode: "rules", picks, latencyMs: Math.round(performance.now() - started) };
  }

  // 1. Code filters: only components that can hold this kind of value are candidates.
  // 2. Jev decides among the candidates, one isolated question per field, all in one request.
  const questions: Record<string, Question> = {};
  const pending: FieldSpec[] = [];
  for (const f of req.fields) {
    const cached = cache.get(keyFor(req.purpose, f));
    if (cached) {
      picks[f.id] = applyThreshold(cached, f, threshold);
      continue;
    }
    const candidates = candidatesFor(f.kind);
    const asksChoice = candidates.length > 1;
    if (!asksChoice && f.kind !== "string") {
      picks[f.id] = rulesPick(f);
      continue;
    }
    pending.push(f);
    if (asksChoice) {
      questions[`c_${f.id}`] = choice(
        {
          task: "Choose the best input component for this form field, for the person filling in the form.",
          field: describe(f),
        },
        Object.fromEntries(candidates.map((c) => [c.id, c.when])),
      );
    }
    if (f.kind === "string") {
      questions[`s_${f.id}`] = noul({
        statement: "This form field asks for a secret that should be masked while typing, such as a password or card number.",
        field: describe(f),
      });
    }
  }

  let model: string | undefined;
  let usage: PickResponse["usage"];
  let error: string | undefined;

  if (pending.length) {
    try {
      const res = await client.systemOne({
        // Every question sees the whole form, so Jev knows the context (a "rating" in a feedback form…).
        state: {
          form_purpose: req.purpose,
          fields: req.fields.map(describe),
        },
        questions,
      });
      model = res.model;
      usage = res.usage;
      for (const f of pending) {
        const c = res.answers[`c_${f.id}`];
        const s = res.answers[`s_${f.id}`];
        const raw: Pick =
          c && c.type === "choice"
            ? { component: c.choice, source: "jev", confidence: c.confidence, probabilities: { ...c.probabilities } }
            : { component: ruleFor(f), source: "only-option" };
        if (s && s.type === "noul") raw.sensitive = s.noul;
        cache.set(keyFor(req.purpose, f), raw);
        picks[f.id] = applyThreshold(raw, f, threshold);
      }
    } catch (e) {
      // Never break the form because the model call failed: fall back to rules and report it.
      error = e instanceof Error ? e.message : String(e);
      for (const f of pending) picks[f.id] = rulesPick(f);
    }
  }

  return { mode: "jev", model, usage, error, picks, latencyMs: Math.round(performance.now() - started) };
}

/** 3. Confidence gate: act on Jev's pick when it is sure, otherwise use the rule-based default. */
function applyThreshold(p: Pick, f: FieldSpec, threshold: number): Pick {
  if (p.source !== "jev" || (p.confidence ?? 0) >= threshold) return p;
  return { ...p, component: ruleFor(f), source: "low-confidence", jevChoice: p.component };
}
