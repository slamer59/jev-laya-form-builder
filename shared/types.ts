/** What kind of value a field holds. This decides which components are even allowed. */
export type Kind = "string" | "number" | "boolean" | "enum" | "multi" | "date";

export const KINDS: { value: Kind; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "enum", label: "One of a list" },
  { value: "multi", label: "Several of a list" },
  { value: "date", label: "Date" },
];

/** One field in the form. This is the builder's single source of truth. */
export type FieldSpec = {
  id: string;
  name: string; // key in submitted data
  label: string;
  kind: Kind;
  required: boolean;
  description?: string; // hint shown to the user and sent to Jev
  format?: "email" | "url"; // string only
  options?: string[]; // enum and multi
  min?: number; // number: value, string: length
  max?: number;
};

export type FormSpec = {
  purpose: string;
  fields: FieldSpec[];
};

/** Where a component pick came from. */
export type PickSource = "jev" | "laya" | "only-option" | "rules" | "low-confidence" | "override";

/** Who answers the questions: hosted Jev, local Laya (same protocol), or no model at all. */
export type Backend = "jev" | "laya" | "rules";

export const BACKENDS: { value: Backend; label: string }[] = [
  { value: "jev", label: "Jev (hosted)" },
  { value: "laya", label: "Laya (local)" },
  { value: "rules", label: "Rules only" },
];

export type Pick = {
  component: string;
  source: PickSource;
  /**
   * Probability (0–1) of the chosen component, when a model was asked. Laya reports it as
   * `answer_confidence` (Jev only has `confidence`), so this is a real probability on both.
   */
  confidence?: number;
  /** The model's probability for every candidate, when a model was asked. */
  probabilities?: Record<string, number>;
  /** What the model picked when the pick fell back because confidence was low. */
  modelChoice?: string;
  /** Probability (0–1) that the field holds sensitive data, for text fields. */
  sensitive?: number;
};

export type PickRequest = FormSpec & { threshold?: number; backend?: Backend };

export type PickResponse = {
  /** Which backend actually answered: the requested one when available, else the best one. */
  mode: Backend;
  model?: string;
  latencyMs: number;
  usage?: { input_tokens: number; output_tokens: number };
  picks: Record<string, Pick>; // keyed by field id
  error?: string;
};
