import { SECTION_TITLES, type FieldLayout, type FieldSpec, type SectionTitle, type Width } from "./types";

/**
 * Form layout, as data + rules. The server sends `WIDTH_OPTIONS[].when` and
 * `SECTION_TITLE_WHEN` to Jev as the criteria of two extra questions per field
 * (see server/pick.ts); the client uses the same rules as the fallback whenever
 * Jev is unavailable or unsure. UI-free on purpose, so both sides can import it.
 */
export const WIDTH_OPTIONS: { value: Width; label: string; when: string }[] = [
  {
    value: "full",
    label: "Full width",
    when: "The whole row. Long free-form answers (bio, message, cover letter, feedback, address), multi-select lists read as a group, file uploads and date ranges.",
  },
  {
    value: "half",
    label: "Half width",
    when: "Half the row, pairing with one other short field of the same kind: first and last name, city and postcode, two dropdowns, two toggles, a clock time and a stepper.",
  },
  {
    value: "third",
    label: "One third",
    when: "One third of the row, for very short values such as a small number, a one-to-five rating or a short code (age, quantity, minutes, ZIP, verification code).",
  },
];

export const WIDTHS: Width[] = WIDTH_OPTIONS.map((w) => w.value);

/** What each generic title means; the model reads this when picking one. */
export const SECTION_TITLE_WHEN: Record<SectionTitle, string> = {
  Identity: "Names, usernames, credentials, profile basics.",
  Contact: "Email, phone, postal address, country, date of birth, links.",
  Details: "The substance of the form: choices, quantities, dates, skills, free text.",
  Preferences: "Opt-ins and settings: notifications, newsletter, remote work, language, time zone.",
  "Legal / consent": "Terms, privacy policy, consent, signature, acknowledgement.",
  Other: "Fits none of the other headings.",
};

export const widthCriteria = () => Object.fromEntries(WIDTH_OPTIONS.map((w) => [w.value, w.when])) as Record<Width, string>;
export const titleCriteria = () => ({ ...SECTION_TITLE_WHEN }) as Record<SectionTitle, string>;

export const WIDTH_LABEL: Record<Width, string> = Object.fromEntries(WIDTH_OPTIONS.map((w) => [w.value, w.label])) as Record<Width, string>;

const has = (f: FieldSpec, re: RegExp) => re.test(`${f.name} ${f.label} ${f.description ?? ""}`.toLowerCase());

const LONG_TEXT = /bio|about|message|comment|feedback|cover letter|letter|note|reason|why|explain|description|summary|address|motivation|details/;
const SHORT_VALUE = /\b(zip|postal|cvv|cvc|pin|code|age|quantity|qty|count|minutes|seconds|years|month|day|size|weight)\b/;

/** Rule-based column width. Used with no API key, and when Jev is unsure. */
export function ruleWidth(f: FieldSpec): Width {
  // A drop zone and a range calendar each need the row to themselves.
  if (f.kind === "file" || f.kind === "date-range") return "full";
  if (f.kind === "time") return "half"; // a clock time pairs with one other short field
  if (f.kind === "range") return "half"; // two thumbs need room to move
  // Long free-form answers need the whole row; multi-selects are read as a group.
  if (f.kind === "string" && ((f.min ?? 0) >= 40 || has(f, LONG_TEXT))) return "full";
  if (f.kind === "multi") return "full";
  if (f.kind === "enum") return (f.options?.length ?? 0) >= 10 ? "full" : "half";
  if (f.kind === "number") {
    // Whole-number bounds mean a stepper or stars: small enough to sit next to another field.
    if (f.min != null && f.max != null && f.max - f.min <= 5) return "third";
    if (f.min != null && f.min >= 0 && f.max != null && f.max - f.min <= 30) return "half";
    return f.min != null && f.max != null && f.max - f.min <= 100 ? "third" : "half";
  }
  if (f.kind === "string" && has(f, SHORT_VALUE)) return "third";
  return "half";
}

const LEGAL = /\b(agree|accept|terms|conditions|privacy|policy|consent|gdpr|signature|acknowledge|declaration)\b/;
const PREFERENCES = /\b(prefer|preference|notification|notify|newsletter|subscribe|updates?|contact me|remote|timezone|frequency|tips|marketing)\b/;
const IDENTITY = /\b(name|username|login|handle|alias|nickname|password|credential)\b/;
const CONTACT = /\b(email|e-mail|phone|mobile|telephone|tel|address|street|city|town|state|province|region|country|zip|postal|birth|dob|website|url|linkedin|social)\b/;

/** Which generic section a field belongs to, by rules. */
export function ruleSectionTitle(f: FieldSpec): SectionTitle {
  if (has(f, LEGAL)) return "Legal / consent";
  if (has(f, PREFERENCES)) return "Preferences";
  if (has(f, IDENTITY)) return "Identity";
  if (has(f, CONTACT)) return "Contact";
  return "Details";
}

/**
 * The first field always opens a section; later fields do when their section changes.
 * A lone field between two fields of the previous section joins that section instead —
 * otherwise a single "Country" between two "Details" fields would open and close a section at once.
 */
export function ruleStartsSection(fields: FieldSpec[], i: number): boolean {
  if (i <= 0) return true;
  const title = ruleSectionTitle(fields[i]);
  if (title === ruleSectionTitle(fields[i - 1])) return false;
  return !(i + 1 < fields.length && ruleSectionTitle(fields[i + 1]) === ruleSectionTitle(fields[i - 1]));
}

/** Full rule-based layout for the field at `i`. */
export function ruleLayout(fields: FieldSpec[], i: number): FieldLayout {
  const startsSection = ruleStartsSection(fields, i);
  return {
    width: ruleWidth(fields[i]),
    startsSection,
    ...(startsSection && { sectionTitle: ruleSectionTitle(fields[i]) }),
    source: "rules",
  };
}

/**
 * Confidence gate for the layout. Each question is gated on its own confidence:
 * the width answer falls back to the rules here, while the section break and the
 * title are gated in the server on their own probabilities.
 */
export function applyLayoutThreshold(layout: FieldLayout, f: FieldSpec, threshold: number): FieldLayout {
  if ((layout.source !== "jev" && layout.source !== "laya") || (layout.confidence ?? 0) >= threshold) return layout;
  return { ...layout, width: ruleWidth(f), modelWidth: layout.width, source: "low-confidence" };
}

export const widthFor = (f: FieldSpec, layout?: FieldLayout): Width => layout?.width ?? ruleWidth(f);

export type PreviewSection = { id: string; title: string; fields: FieldSpec[] };

/** Split fields into preview sections, keyed by the id of the field that opens each one. */
export function groupSections(fields: FieldSpec[], layouts: (FieldLayout | undefined)[]): PreviewSection[] {
  const out: PreviewSection[] = [];
  fields.forEach((f, i) => {
    const layout = layouts[i];
    const starts = layout?.startsSection ?? ruleStartsSection(fields, i);
    if (!starts && out.length) {
      out[out.length - 1].fields.push(f);
      return;
    }
    out.push({ id: f.id, title: layout?.sectionTitle ?? ruleSectionTitle(f), fields: [f] });
  });
  return out;
}

export { SECTION_TITLES };
