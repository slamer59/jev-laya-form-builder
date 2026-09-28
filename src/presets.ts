import type { FormSpec } from "@shared/types";

const COUNTRIES = [
  "Argentina", "Australia", "Austria", "Belgium", "Brazil", "Canada", "Chile", "China", "Denmark", "Egypt",
  "Finland", "France", "Germany", "Greece", "India", "Indonesia", "Ireland", "Italy", "Japan", "Kenya",
  "Mexico", "Morocco", "Netherlands", "New Zealand", "Nigeria", "Norway", "Poland", "Portugal", "Senegal",
  "Singapore", "South Africa", "South Korea", "Spain", "Sweden", "Switzerland", "United Kingdom", "United States",
];

const LANGUAGES = ["English", "French", "German", "Spanish", "Italian", "Portuguese", "Dutch", "Polish", "Japanese", "Korean", "Mandarin", "Arabic"];

let n = 0;
const id = () => `f${++n}`;

export const PRESETS: Record<string, FormSpec> = {
  "Job application": {
    purpose: "Job application for a software engineering role at a startup",
    fields: [
      { id: id(), name: "full_name", label: "Full name", kind: "string", required: true },
      { id: id(), name: "email", label: "Email", kind: "string", format: "email", required: true },
      { id: id(), name: "role", label: "Role", kind: "enum", required: true, options: ["Frontend", "Backend", "Full-stack", "Design"] },
      { id: id(), name: "country", label: "Country of residence", kind: "enum", required: true, options: COUNTRIES },
      { id: id(), name: "years_experience", label: "Years of experience", kind: "number", required: true, min: 0, max: 50 },
      { id: id(), name: "skills", label: "Skills", kind: "multi", required: true, options: ["React", "TypeScript", "Node.js", "Go", "Rust", "Python", "SQL", "Figma"] },
      { id: id(), name: "start_date", label: "Earliest start date", kind: "date", required: true },
      { id: id(), name: "cover_letter", label: "Why do you want to join?", kind: "string", required: true, min: 50, description: "A few paragraphs about your motivation" },
      { id: id(), name: "open_to_remote", label: "Open to remote work", kind: "boolean", required: false },
      { id: id(), name: "accept_terms", label: "I accept the privacy policy", kind: "boolean", required: true },
    ],
  },
  "Product feedback": {
    purpose: "Short feedback survey after a customer uses our product",
    fields: [
      { id: id(), name: "satisfaction", label: "How satisfied are you?", kind: "number", required: true, min: 1, max: 10 },
      { id: id(), name: "recommend", label: "Would you recommend us?", kind: "enum", required: true, options: ["Yes", "Maybe", "No"] },
      { id: id(), name: "features_used", label: "Features you used", kind: "multi", required: false, options: ["Dashboard", "Reports", "Integrations", "API"] },
      { id: id(), name: "feedback", label: "What could we do better?", kind: "string", required: false },
      { id: id(), name: "contact_me", label: "You can contact me about this feedback", kind: "boolean", required: false },
    ],
  },
  "Account sign-up": {
    purpose: "Create an account for a language-learning app",
    fields: [
      { id: id(), name: "username", label: "Username", kind: "string", required: true, min: 3, max: 20 },
      { id: id(), name: "password", label: "Password", kind: "string", required: true, min: 8 },
      { id: id(), name: "verification_code", label: "Code we sent to your phone", kind: "string", required: true, min: 6, max: 6 },
      { id: id(), name: "date_of_birth", label: "Date of birth", kind: "date", required: true },
      { id: id(), name: "native_language", label: "Native language", kind: "enum", required: true, options: LANGUAGES },
      { id: id(), name: "daily_goal_minutes", label: "Daily goal (minutes)", kind: "number", required: true, min: 5, max: 60 },
      { id: id(), name: "newsletter", label: "Weekly tips by email", kind: "boolean", required: false },
    ],
  },
};

export const newFieldId = id;
