/** What kind of value a field holds. This decides which components are even allowed. */
export type Kind = "string" | "number" | "boolean" | "enum" | "multi" | "date" | "time" | "date-range" | "range" | "file";

export const KINDS: { value: Kind; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "enum", label: "One of a list" },
  { value: "multi", label: "Several of a list" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "date-range", label: "Date range" },
  { value: "range", label: "Number range" },
  { value: "file", label: "File upload" },
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
  min?: number; // number/range: value, string: length
  max?: number;
  prefix?: string; // string only: text inside the input before the value ("https://", "$")
  suffix?: string; // string only: text after the value ("kg", "min")
  accept?: string; // file only: comma-separated MIME types or extensions (".pdf,image/*")
  maxSizeMb?: number; // file only: largest file the user may upload
  multiple?: boolean; // file only: allow several files
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

/** How many grid columns a field spans in the preview (6-column grid). */
export type Width = "full" | "half" | "third";

/** Generic section titles. The model picks one from this fixed list (it cannot write text). */
export const SECTION_TITLES = ["Identity", "Contact", "Details", "Preferences", "Legal / consent", "Other"] as const;
export type SectionTitle = (typeof SECTION_TITLES)[number];

/** Where one field goes: its column width, and whether it opens a new section. */
export type FieldLayout = {
  width: Width;
  /** The model's probability for every width, when a model was asked. */
  widthProbabilities?: Record<string, number>;
  /** What the model leaned towards when the width fell back to a rule. */
  modelWidth?: Width;
  /** True when the field opens a new logical section. The first field always does. */
  startsSection: boolean;
  /** The model's probability of "yes" for the section-break question (0–1). */
  sectionProbability?: number;
  /** Title of the section this field opens, when it opens one. */
  sectionTitle?: SectionTitle;
  /** The model's probability for every title, when it was asked about this section. */
  sectionTitleProbabilities?: Record<string, number>;
  /** The model's confidence in the width choice, when a model was asked. */
  confidence?: number;
  source: PickSource;
};

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
  /** Model-driven layout: column width and section break for this field. */
  layout?: FieldLayout;
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
