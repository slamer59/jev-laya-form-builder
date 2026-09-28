import type { FieldSpec, Kind } from "./types";

/**
 * The component catalogue, as plain data. The server sends `when` to Jev as the
 * description of each option; the client maps `id` to an actual shadcn component
 * (see src/catalog-render.tsx). Add a component here + a renderer there, and Jev
 * can start choosing it.
 */
export type CatalogEntry = {
  id: string;
  name: string;
  accepts: Kind[];
  when: string;
};

export const CATALOG: CatalogEntry[] = [
  // text
  { id: "input", name: "Input", accepts: ["string"], when: "Short single-line text such as a name, title, username, email address or URL" },
  { id: "input-affix", name: "Input with prefix/suffix", accepts: ["string"], when: "Short text with a fixed prefix or suffix shown inside the box, such as a website address with https://, a price with a currency symbol, or an amount with a unit" },
  { id: "textarea", name: "Textarea", accepts: ["string"], when: "Long free-form text written in sentences or paragraphs, such as a bio, message, description, feedback or cover letter" },
  { id: "otp", name: "Input OTP", accepts: ["string"], when: "A short fixed-length verification code, PIN or one-time password typed digit by digit" },
  // number
  { id: "number", name: "Number input", accepts: ["number"], when: "An exact number the user types in, such as a quantity, age, price or count" },
  { id: "stepper", name: "Stepper", accepts: ["number"], when: "A small whole number nudged with minus and plus buttons, such as a number of guests, tickets, seats or copies in a range of about 0 to 30" },
  { id: "rating", name: "Star rating", accepts: ["number"], when: "A score given as one to five stars, such as a star rating for a product, service or experience" },
  { id: "slider", name: "Slider", accepts: ["number"], when: "A value chosen along a bounded scale, such as a rating, satisfaction score, percentage or level" },
  // boolean
  { id: "switch", name: "Switch", accepts: ["boolean"], when: "A preference or setting the user turns on or off, such as notifications or remote work" },
  { id: "checkbox", name: "Checkbox", accepts: ["boolean"], when: "An agreement, consent or confirmation the user ticks, such as accepting terms" },
  // enum
  { id: "toggle-group", name: "Toggle group", accepts: ["enum"], when: "A choice between two or three short options shown as side-by-side segmented buttons, such as Yes/No/Maybe or Small/Medium/Large" },
  { id: "radio", name: "Radio group", accepts: ["enum"], when: "A pick from a handful of options that should all be visible at once" },
  { id: "select", name: "Select", accepts: ["enum"], when: "A pick from a medium list of options shown in a dropdown" },
  { id: "combobox", name: "Combobox", accepts: ["enum"], when: "A pick from a long list the user wants to search by typing, such as a country, language or timezone" },
  // multi
  { id: "checkbox-group", name: "Checkbox group", accepts: ["multi"], when: "Several choices from a short list, shown as a vertical list of checkboxes" },
  { id: "chips", name: "Toggle chips", accepts: ["multi"], when: "Several tags or topics picked from a longer list, shown as compact toggle chips" },
  // date
  { id: "date-picker", name: "Date picker", accepts: ["date"], when: "A near-term date picked on a calendar, such as an appointment, deadline or start date" },
  { id: "date-input", name: "Date input", accepts: ["date"], when: "A date far in the past that is faster to type than to navigate to, such as a date of birth" },
  // time
  { id: "time", name: "Time input", accepts: ["time"], when: "A time of day, such as an appointment slot, opening hour, alarm or preferred time to be contacted" },
  // date-range
  { id: "date-range-picker", name: "Date range picker", accepts: ["date-range"], when: "A start and end date picked together on one calendar, such as a stay, rental period or reporting period" },
  // range
  { id: "range-slider", name: "Range slider", accepts: ["range"], when: "A lower and upper bound picked together on a two-handled slider, such as a price range, age range or budget range" },
  // file
  { id: "file-dropzone", name: "File drop zone", accepts: ["file"], when: "One or more files the user drags and drops onto an area, such as a resume, screenshots, photos or documents" },
  { id: "file-button", name: "File button", accepts: ["file"], when: "A single file chosen through a compact button, such as a logo, avatar or short attachment" },
];

export const catalogById = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

export const candidatesFor = (kind: Kind) => CATALOG.filter((c) => c.accepts.includes(kind));

const has = (f: FieldSpec, re: RegExp) => re.test(`${f.name} ${f.label} ${f.description ?? ""}`.toLowerCase());

/** Plain rules. Used when there is no API key, and as the fallback when Jev isn't confident. */
export function ruleFor(f: FieldSpec): string {
  switch (f.kind) {
    case "string":
      if (f.prefix || f.suffix) return "input-affix";
      if (has(f, /\b(otp|pin|verification|one[- ]time)\b|_code\b|\bcode\b/)) return "otp";
      if (has(f, /bio|about|description|message|comment|feedback|notes|letter|story|explain|details/)) return "textarea";
      return "input";
    case "number":
      if (has(f, /rating|stars?\b/) && (f.max ?? 5) <= 5) return "rating";
      // A small bounded whole-number range (guests, tickets, days…) is faster to nudge than to type.
      if (f.min != null && f.min >= 0 && f.max != null && f.max - f.min <= 30 && has(f, /guest|people|person|quantity|qty|count|tickets?|copies|seats?|number of|adults|children|days|months/))
        return "stepper";
      if (has(f, /rating|rate|score|satisf|percent|level|priority|likely|scale/)) return "slider";
      return "number";
    case "boolean":
      return has(f, /agree|accept|terms|consent|confirm|acknowledge/) ? "checkbox" : "switch";
    case "enum": {
      const n = f.options?.length ?? 0;
      if (n > 10 || has(f, /country|language|timezone|currency|city/)) return "combobox";
      // Two or three single-word options read best as segmented buttons.
      if (n >= 2 && n <= 3 && f.options?.every((o) => o.length <= 12 && !o.includes(" "))) return "toggle-group";
      return n <= 4 ? "radio" : "select";
    }
    case "multi":
      return (f.options?.length ?? 0) <= 5 ? "checkbox-group" : "chips";
    case "date":
      return has(f, /birth|dob|born/) ? "date-input" : "date-picker";
    case "time":
      return "time";
    case "date-range":
      return "date-range-picker";
    case "range":
      return "range-slider";
    case "file":
      return f.multiple || has(f, /image|photo|picture|screenshot|avatar|logo|drag/) ? "file-dropzone" : "file-button";
  }
}

export const looksSensitive = (f: FieldSpec) => f.kind === "string" && has(f, /password|secret|token|passphrase|ssn|iban|card number/);
