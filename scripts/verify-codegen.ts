/**
 * Generates the Code tab's output for every preset — plus one spec that uses every
 * component in the catalogue — writes the `.tsx` files under `src/__generated__/`
 * (gitignored, excluded from the main typecheck) and compiles them with `tsc`
 * against this repo's own shadcn components, which live at the same `@/components/ui/*`
 * paths as a standard shadcn project.
 *
 * Usage: bun run verify:codegen [--clean]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CATALOG, looksSensitive, ruleFor } from "../shared/catalog";
import { generatedFormCode, installCode, type CodegenInput } from "../shared/codegen";
import type { FieldSpec, Pick } from "../shared/types";
import { PRESETS } from "../src/presets";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "src/__generated__");

if (process.argv.includes("--clean")) {
  rmSync(outDir, { recursive: true, force: true });
  console.log(`Removed ${path.relative(root, outDir)}`);
  process.exit(0);
}

/** Rules-only picks, exactly what the app falls back to without an API key. */
const rulesPicks = (fields: FieldSpec[]): Record<string, Pick> =>
  Object.fromEntries(
    fields.map((f) => [f.id, { component: ruleFor(f), source: "rules" as const, sensitive: looksSensitive(f) ? 1 : 0 }]),
  );

/** One field per catalogue entry, so every renderer template ends up in a generated file. */
const allComponents: FieldSpec[] = CATALOG.map((entry, i) => {
  const kind = entry.accepts[0];
  return {
    id: `c${i}`,
    name: entry.id.replace(/-/g, "_"),
    label: `${entry.name} field`,
    kind,
    required: i % 2 === 0,
    ...(kind === "enum" || kind === "multi" ? { options: ["Option A", "Option B", "Option C"] } : {}),
    ...(kind === "number" ? { min: 0, max: 100 } : {}),
    ...(entry.id === "otp" ? { max: 6 } : {}),
    ...(i % 3 === 0 ? { description: "Hint from the builder" } : {}),
    ...(kind === "string" && i % 4 === 0 ? { max: 40 } : {}),
  };
});

const targets: [string, CodegenInput][] = [
  ...Object.entries(PRESETS).map(
    ([name, spec]): [string, CodegenInput] => [name, { purpose: spec.purpose, fields: spec.fields, picks: rulesPicks(spec.fields) }],
  ),
  [
    "AllComponents",
    {
      purpose: "Every catalogue component at once (generated for verification)",
      fields: allComponents,
      picks: Object.fromEntries(allComponents.map((f, i) => [f.id, { component: CATALOG[i].id, source: "override" as const }])),
    },
  ],
];

mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
        types: ["vite/client"],
        // "@/*" resolves to src/*, the same alias the generated file would use in a shadcn project.
        paths: { "@/*": ["../*"] },
      },
      include: ["./*.tsx"],
    },
    null,
    2,
  )}\n`,
);

for (const [name, input] of targets) {
  const file = path.join(outDir, `${name.replace(/[^a-zA-Z0-9]+/g, "-")}.tsx`);
  writeFileSync(file, generatedFormCode(input));
  console.log(`generated ${path.relative(root, file)}`);
  console.log(
    installCode(input)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );
}

console.log("\ntsc -p src/__generated__/tsconfig.json");
const tsc = spawnSync("bunx", ["tsc", "-p", path.join(outDir, "tsconfig.json")], { cwd: root, stdio: "inherit" });
if (tsc.status !== 0) {
  console.error("\nGenerated code does not compile.");
  process.exit(tsc.status ?? 1);
}
console.log(`\nAll ${targets.length} generated forms compile.`);
