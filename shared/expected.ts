import type { FormSpec } from "./types";

/**
 * What the right answer is, per preset and field name, for `bun run eval`.
 *
 * Kept out of `src/presets.ts` so the eval can be edited without touching the app. `components`
 * lists acceptable component ids, best first: more than one only where the catalogue genuinely
 * allows either reading. `masked` is the expected answer to the "should this be masked while
 * typing?" question; omit it to skip that check.
 */
export type ExpectedPick = {
  components: string[];
  masked?: boolean;
};

export const EXPECTED: Record<string, Record<string, ExpectedPick>> = {
  "Job application": {
    full_name: { components: ["input"], masked: false },
    email: { components: ["input"], masked: false },
    role: { components: ["radio"] }, // 4 options, all visible
    country: { components: ["combobox"] }, // long list, worth searching
    years_experience: { components: ["number"] },
    skills: { components: ["chips"] }, // 8 tags, compact toggles
    start_date: { components: ["date-picker"] },
    cover_letter: { components: ["textarea"], masked: false },
    open_to_remote: { components: ["switch"] }, // a preference, not a consent
    accept_terms: { components: ["checkbox"] }, // consent to tick
    resume: { components: ["file-button", "file-dropzone"] }, // one document; a button or a drop area both fit
    portfolio_url: { components: ["input-affix"], masked: false }, // a fixed https:// in front
    notice_period_days: { components: ["stepper", "number"] }, // small bounded day count
  },
  "Product feedback": {
    satisfaction: { components: ["slider"] }, // 1–10 scale
    recommend: { components: ["toggle-group", "radio"] }, // 3 short options, read best as segmented buttons
    features_used: { components: ["checkbox-group"] }, // 4 options
    feedback: { components: ["textarea"], masked: false },
    contact_me: { components: ["switch"] },
    overall_rating: { components: ["rating", "slider"] }, // 1–5, so stars (a 1–10 scale stays a slider)
    usage_period: { components: ["date-range-picker"] }, // a start and an end together
  },
  "Account sign-up": {
    username: { components: ["input"], masked: false },
    password: { components: ["input"], masked: true },
    verification_code: { components: ["otp"], masked: false }, // a code typed digit by digit, shown
    date_of_birth: { components: ["date-input"] }, // far in the past, faster to type
    native_language: { components: ["combobox"] },
    daily_goal_minutes: { components: ["number", "slider"] }, // bounded minutes; both readings hold
    newsletter: { components: ["switch"] },
    study_time: { components: ["time"] }, // a clock time, nothing else holds one
    weekly_goal_range: { components: ["range-slider"] }, // a low and a high target together
  },
};

/** Expected picks for one preset, keyed by field name rather than by the preset's generated ids. */
export const expectedFor = (preset: string, form: FormSpec): Record<string, ExpectedPick> => {
  const known = EXPECTED[preset];
  if (!known) throw new Error(`no expectations for preset "${preset}" — add them to shared/expected.ts`);
  const byName: Record<string, ExpectedPick> = {};
  for (const f of form.fields) {
    const e = known[f.name];
    if (!e) throw new Error(`no expectation for "${preset}" field "${f.name}" — add it to shared/expected.ts`);
    byName[f.name] = e;
  }
  return byName;
};
