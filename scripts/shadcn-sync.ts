/**
 * Keeps `src/components/ui/` in step with the component catalogue: maps every
 * `shared/catalog.ts` id to its shadcn registry names and runs
 * `bunx shadcn@latest add …` for the ones whose files are missing.
 *
 * Renderers are NOT generated: a new catalogue entry still needs a template in
 * `src/catalog-render.tsx` (live preview) and in `shared/codegen.ts` (export).
 *
 * Usage: bun run shadcn:sync [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CATALOG } from "../shared/catalog";
import { SHADCN_ITEMS, shadcnItems } from "../shared/codegen";
import type { FieldSpec, Pick } from "../shared/types";

const root = path.resolve(import.meta.dirname, "..");
const uiDir = path.join(root, "src/components/ui");
const registryToFile = (item: string) => path.join(uiDir, `${item}.tsx`);

const dryRun = process.argv.includes("--dry-run");
const ids = CATALOG.map((c) => c.id);

const unknown = ids.filter((id) => !SHADCN_ITEMS[id]);
if (unknown.length) console.warn(`No shadcn mapping for: ${unknown.join(", ")} — add it to SHADCN_ITEMS in shared/codegen.ts.`);

// One field per catalogue id, so shadcnItems() reports the registry names this catalogue needs.
const specs: FieldSpec[] = CATALOG.map((entry, i) => ({
  id: `f${i}`,
  name: entry.id.replace(/-/g, "_"),
  label: entry.name,
  kind: entry.accepts[0],
  required: false,
  ...(entry.accepts[0] === "enum" || entry.accepts[0] === "multi" ? { options: ["One", "Two"] } : {}),
}));
const picks: Record<string, Pick> = Object.fromEntries(specs.map((f, i) => [f.id, { component: ids[i], source: "override" as const }]));

const missing = shadcnItems({ purpose: "", fields: specs, picks }).filter((item) => !existsSync(registryToFile(item)));

if (!missing.length) {
  console.log("src/components/ui/ already has every component in the catalogue.");
  process.exit(0);
}

console.log(`Missing from src/components/ui/: ${missing.join(", ")}`);
if (dryRun) {
  console.log(`Would run: bunx shadcn@latest add ${missing.join(" ")}`);
  process.exit(0);
}

const add = spawnSync("bunx", ["shadcn@latest", "add", ...missing, "--yes"], { cwd: root, stdio: "inherit" });
if (add.status !== 0) process.exit(add.status ?? 1);

// The registry's `cn` import alias is not rewritten to this project's alias by the CLI,
// and the CLI adds a bogus `cn` package to match. Fix both up here.
const patched = readdirSync(uiDir)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => path.join(uiDir, name))
  .filter((file) => readFileSync(file, "utf8").includes('from "cn"'));
for (const file of patched) writeFileSync(file, readFileSync(file, "utf8").replaceAll('from "cn"', 'from "@/lib/utils"'));
if (patched.length) console.log(`Rewrote the \`cn\` import in: ${patched.map((f) => path.basename(f)).join(", ")}`);

const pkgPath = path.join(root, "package.json");
if (JSON.parse(readFileSync(pkgPath, "utf8")).dependencies?.cn) {
  const removed = spawnSync("bun", ["remove", "cn"], { cwd: root, stdio: "inherit" });
  if (removed.status === 0) console.log("Removed the stray `cn` dependency the CLI added.");
}

console.log("\nFiles are installed, but renderers are written by hand. For each component above, add:");
console.log("  - live preview:  a renderer in src/catalog-render.tsx");
console.log("  - code export:   a template in shared/codegen.ts (and a SHADCN_ITEMS entry)");
console.log(`  - catalogue ids waiting on one: ${ids.filter((id) => (SHADCN_ITEMS[id] ?? []).some((item) => missing.includes(item))).join(", ")}`);
