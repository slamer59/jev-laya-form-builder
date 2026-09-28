import { createHash } from "node:crypto";
import { choice, noul, type ChoiceResponse, type Question, type SystemOneResult } from "@typesafe-ai/sdk";
import { candidatesFor, looksSensitive, ruleFor } from "../shared/catalog";
import { SECTION_TITLES, type Backend, type FieldLayout, type FieldSpec, type Pick, type PickRequest, type PickResponse, type SectionTitle, type Width } from "../shared/types";
import { clients, resolveBackend } from "./backends";
import { WIDTHS, applyLayoutThreshold, ruleLayout, ruleSectionTitle, ruleStartsSection, titleCriteria, widthCriteria } from "../shared/layout";

/**
 * The layout answers for one field, kept raw so the layout can be re-derived for
 * wherever the field sits now: section breaks depend on the neighbours.
 */
type LayoutAnswers = {
  /** The width answer. It describes the field itself, so reordering keeps it. */
  width?: { choice: Width; confidence: number; probabilities: Record<string, number> };
  /** The section-break answer, and the name of the field it was asked after. */
  sectionYes?: number;
  askedAfter?: string | null;
  /** The heading answer, asked in the same context as the break. */
  heading?: { choice: SectionTitle; confidence: number; probabilities: Record<string, number> };
};

/** A cached field: the component answers, plus the layout answers the layout is derived from. */
type CacheEntry = { pick: Omit<Pick, "layout">; layoutAnswers: LayoutAnswers; model?: string };

/** Picks are cached per (backend + form purpose + field), so editing one field only re-asks for that field. */
const cache = new Map<string, CacheEntry>();
const keyFor = (backend: Backend, purpose: string, f: FieldSpec) =>
  createHash("sha1").update(JSON.stringify([backend, purpose, { ...f, id: undefined }])).digest("hex");

/** For tests and the eval script: forget every cached pick. */
export const clearPickCache = () => cache.clear();

/**
 * Laya answers a choice with the margin between the top two options in `confidence` (≈0 when the
 * options are close) and the probability of the chosen option in `answer_confidence`. Jev only has
 * `confidence`, which already is that probability. Prefer `answer_confidence` so the stored value,
 * the gate and the badge all speak probabilities.
 */
const answerProbability = (a: ChoiceResponse) => (a as ChoiceResponse & { answer_confidence?: number }).answer_confidence ?? a.confidence;

/** Describe a field to the model without internal ids. */
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
  ...(f.prefix && { prefix: f.prefix }),
  ...(f.suffix && { suffix: f.suffix }),
  ...(f.accept && { accept: f.accept }),
  ...(f.maxSizeMb != null && { max_size_mb: f.maxSizeMb }),
  ...(f.multiple != null && { multiple: f.multiple }),
});

/** Layout questions point at a field by name and label; the whole form is already in the request state. */
const identify = (f: FieldSpec) => ({ name: f.name, label: f.label });

function rulesPick(f: FieldSpec, layout: FieldLayout): Pick {
  const only = candidatesFor(f.kind).length === 1;
  return {
    component: ruleFor(f),
    source: only ? "only-option" : "rules",
    layout,
    ...(f.kind === "string" && { sensitive: looksSensitive(f) ? 1 : 0 }),
  };
}

/** A yes/no answer counts only when the model is at least `threshold` sure of the winning side. */
function trusted(prob: number, threshold: number) {
  return Math.max(prob, 1 - prob) >= threshold;
}

/** Pull the layout answers out of a response: validated, reduced to plain values, ready to cache. */
function readLayoutAnswers(
  answers: SystemOneResult<Record<string, Question>>["answers"],
  id: string,
  askedAfter: string | null,
): LayoutAnswers {
  const width = answers[`w_${id}`];
  const w = width?.type === "choice" && WIDTHS.includes(width.choice as Width) ? width : undefined;
  const heading = answers[`t_${id}`];
  const h = heading?.type === "choice" && SECTION_TITLES.includes(heading.choice as SectionTitle) ? heading : undefined;
  const break_ = answers[`n_${id}`];
  return {
    ...(w && { width: { choice: w.choice as Width, confidence: w.confidence, probabilities: { ...w.probabilities } } }),
    ...(break_?.type === "noul" && { sectionYes: break_.noul }),
    ...(h && { heading: { choice: h.choice as SectionTitle, confidence: h.confidence, probabilities: { ...h.probabilities } } }),
    askedAfter,
  };
}

/**
 * Derive one field's layout from its answers and where it sits *now*. The rules are
 * the fallback whenever the model is unsure or its answer was given for other neighbours.
 */
function layoutFrom(answers: LayoutAnswers, fields: FieldSpec[], i: number, threshold: number, source: Backend): FieldLayout {
  const f = fields[i];
  const fallback = ruleLayout(fields, i);
  // A break question is asked about the form as it was, so moving the field makes that answer stale.
  const sameContext = answers.askedAfter === (i > 0 ? fields[i - 1].name : null);
  const yes = sameContext ? answers.sectionYes : undefined;
  const heading = sameContext ? answers.heading : undefined;
  const { width: w } = answers;
  // The first field always opens a section, whatever was answered about an earlier position.
  const startsSection = i === 0 || (yes != null && trusted(yes, threshold) ? yes >= 0.5 : fallback.startsSection);
  return {
    width: w?.choice ?? fallback.width,
    ...(w && { widthProbabilities: { ...w.probabilities }, confidence: w.confidence }),
    startsSection,
    ...(yes != null && { sectionProbability: yes }),
    ...(startsSection && { sectionTitle: (heading && heading.confidence >= threshold ? heading.choice : undefined) ?? ruleSectionTitle(f) }),
    ...(startsSection && heading && { sectionTitleProbabilities: { ...heading.probabilities } }),
    source: w ? source : fallback.source,
  };
}

export async function pickComponents(req: PickRequest): Promise<PickResponse> {
  const started = performance.now();
  const threshold = req.threshold ?? 0.5;
  const picks: Record<string, Pick> = {};
  const backend = await resolveBackend(req.backend);
  const client = backend === "rules" ? null : clients[backend];

  if (!client) {
    for (const [i, f] of req.fields.entries()) picks[f.id] = rulesPick(f, ruleLayout(req.fields, i));
    return { mode: "rules", asked: 0, cached: 0, picks, latencyMs: Math.round(performance.now() - started) };
  }

  // 1. Code filters: only components that can hold this kind of value are candidates.
  // 2. The model decides the component, the width and the section break, one isolated question per field, all in one request.
  const questions: Record<string, Question> = {};
  const pending: number[] = [];
  /** Models behind the cache hits, so a response made of cached picks still names what answered. */
  const cachedModels: string[] = [];
  let cachedHits = 0;
  for (const [i, f] of req.fields.entries()) {
    const hit = req.noCache ? undefined : cache.get(keyFor(backend, req.purpose, f));
    if (hit) {
      cachedHits++;
      if (hit.model) cachedModels.push(hit.model);
      picks[f.id] = applyThreshold(hit, req.fields, i, threshold, backend);
      continue;
    }
    pending.push(i);
    const candidates = candidatesFor(f.kind);
    if (candidates.length > 1) {
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
    // The layout questions already have the whole form as state, so they only point at the field by name and label.
    questions[`w_${f.id}`] = choice(
      {
        task: "How wide should this form field be, on a six-column grid?",
        field: identify(f),
      },
      widthCriteria(),
    );
    // The first field always opens a section, so only the others are asked.
    if (i > 0) {
      questions[`n_${f.id}`] = noul({
        statement: "This form field starts a new logical section of the form, introduced by its own heading.",
        field: identify(f),
      });
    }
    // Titles must travel in the same request as the break question, so which fields get one is predicted from the rules.
    if (ruleStartsSection(req.fields, i)) {
      questions[`t_${f.id}`] = choice(
        {
          task: "Which heading fits the section this form field opens?",
          field: identify(f),
        },
        titleCriteria(),
      );
    }
  }

  let model: string | undefined;
  let usage: PickResponse["usage"];
  let error: string | undefined;

  if (pending.length) {
    try {
      const res = await client.systemOne({
        // Every question sees the whole form, so the model knows the context (a "rating" in a feedback form…).
        state: {
          form_purpose: req.purpose,
          fields: req.fields.map(describe),
        },
        questions,
      });
      model = res.model;
      usage = res.usage;
      for (const i of pending) {
        const f = req.fields[i];
        const c = res.answers[`c_${f.id}`];
        const s = res.answers[`s_${f.id}`];
        const pick: Omit<Pick, "layout"> =
          c && c.type === "choice"
            ? {
                component: c.choice,
                source: backend,
                confidence: answerProbability(c),
                probabilities: { ...c.probabilities },
              }
            : { component: ruleFor(f), source: "only-option" };
        if (s && s.type === "noul") pick.sensitive = s.noul;
        const entry: CacheEntry = {
          pick,
          layoutAnswers: readLayoutAnswers(res.answers, f.id, i > 0 ? req.fields[i - 1].name : null),
          model,
        };
        cache.set(keyFor(backend, req.purpose, f), entry);
        picks[f.id] = applyThreshold(entry, req.fields, i, threshold, backend);
      }
    } catch (e) {
      // Never break the form because the model call failed: fall back to rules and report it.
      error = e instanceof Error ? e.message : String(e);
      for (const i of pending) picks[req.fields[i].id] = rulesPick(req.fields[i], ruleLayout(req.fields, i));
    }
  }

  return {
    mode: backend,
    model: model ?? cachedModels[0],
    usage,
    asked: pending.length,
    cached: cachedHits,
    picks,
    error,
    latencyMs: Math.round(performance.now() - started),
  };
}

/**
 * 3. Confidence gate: act on the model's pick when it is sure, otherwise use the rule-based default.
 * The layout is re-derived here too, so a cached field is always laid out for its current position.
 */
function applyThreshold(entry: CacheEntry, fields: FieldSpec[], i: number, threshold: number, backend: Backend): Pick {
  const f = fields[i];
  const gated: Pick = {
    ...entry.pick,
    layout: applyLayoutThreshold(layoutFrom(entry.layoutAnswers, fields, i, threshold, backend), f, threshold),
  };
  if ((gated.source !== "jev" && gated.source !== "laya") || (gated.confidence ?? 0) >= threshold) return gated;
  return { ...gated, component: ruleFor(f), source: "low-confidence", modelChoice: gated.component };
}
