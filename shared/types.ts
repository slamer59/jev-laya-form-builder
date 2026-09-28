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
export type PickSource = "jev" | "only-option" | "rules" | "low-confidence" | "override";

export type Pick = {
  component: string;
  source: PickSource;
  /** Jev's confidence in its choice, when Jev was asked. */
  confidence?: number;
  /** Jev's probability for every candidate, when Jev was asked. */
  probabilities?: Record<string, number>;
  /** What Jev picked when the pick fell back because confidence was low. */
  jevChoice?: string;
  /** Probability (0–1) that the field holds sensitive data, for text fields. */
  sensitive?: number;
};

export type PickRequest = FormSpec & { threshold?: number };

export type PickResponse = {
  mode: "jev" | "rules";
  model?: string;
  latencyMs: number;
  usage?: { input_tokens: number; output_tokens: number };
  picks: Record<string, Pick>; // keyed by field id
  error?: string;
};
