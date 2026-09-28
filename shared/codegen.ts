import { codeList, zodCodeForField } from "./schema";
import { groupSections, widthFor } from "./layout";
import type { FieldSpec, Kind, Pick, Width } from "./types";

/**
 * Generates the "Component" and "Install" tabs of the Code view: a self-contained
 * `<GeneratedForm />` file (react-hook-form + zodResolver + shadcn Form) using the
 * current component picks, plus the shadcn/npm commands that file needs.
 *
 * The per-component JSX mirrors src/catalog-render.tsx so the export matches the
 * live preview. Keep the two in sync when adding a renderer.
 */

export type CodegenInput = {
  purpose: string;
  fields: FieldSpec[];
  picks: Record<string, Pick>;
};

/** Catalogue id → the shadcn registry items the generated component imports. */
export const SHADCN_ITEMS: Record<string, string[]> = {
  input: ["input"],
  textarea: ["textarea"],
  otp: ["input-otp"],
  number: ["input"],
  slider: ["slider"],
  switch: ["switch"],
  checkbox: ["checkbox"],
  radio: ["radio-group"],
  select: ["select"],
  combobox: ["popover", "command", "button"],
  "checkbox-group": ["checkbox"],
  chips: ["toggle-group"],
  "date-picker": ["popover", "calendar", "button"],
  "date-input": ["input"],
};

/** Every generated form imports these, whatever the picks are. */
const ALWAYS = ["form", "label", "button"];

/** Column span of each width on the 6-column grid, matching the preview (src/components/FormPreview.tsx). */
const SPAN: Record<Width, string> = { full: "lg:col-span-6", half: "lg:col-span-3", third: "lg:col-span-2" };

/** Rule default per value type, used when a pick names a component we have no template for. */
const KIND_DEFAULT: Record<Kind, string> = {
  string: "input",
  number: "number",
  boolean: "switch",
  enum: "select",
  multi: "checkbox-group",
  date: "date-input",
};

const KNOWN = new Set(Object.keys(SHADCN_ITEMS));

/** Component id for a field: the pick if we know it, otherwise the rule default for its value type. */
export function resolveComponent(spec: FieldSpec, pick?: Pick): string {
  const picked = pick?.component;
  if (picked && KNOWN.has(picked)) return picked;
  return KIND_DEFAULT[spec.kind];
}

/** shadcn registry items for every component the generated form uses, deduplicated. */
export function shadcnItems(input: CodegenInput): string[] {
  const items = new Set(ALWAYS);
  for (const f of input.fields) for (const item of SHADCN_ITEMS[resolveComponent(f, input.picks[f.id])] ?? []) items.add(item);
  return [...items].sort((a, b) => (a === "form" ? -1 : b === "form" ? 1 : a.localeCompare(b)));
}

/** npm packages the generated form imports. */
export function npmDeps(input: CodegenInput): string[] {
  const deps = ["react-hook-form", "@hookform/resolvers", "zod"];
  // A date picker needs the shadcn Calendar, which is built on react-day-picker (installed by `shadcn add calendar`).
  if (input.fields.some((f) => f.kind === "date")) deps.push("date-fns");
  return deps;
}

/** The Install tab: the two commands that make the generated file compile. */
export function installCode(input: CodegenInput): string {
  const items = shadcnItems(input);
  return [
    "# 1. shadcn/ui components",
    `npx shadcn@latest add ${items.join(" ")}`,
    "",
    "# 2. runtime dependencies",
    `npm install ${npmDeps(input).join(" ")}`,
    "",
    "# combobox is popover + command, chips is toggle-group, date picker is popover + calendar,",
    "# one-time code is input-otp. `shadcn add calendar` also pulls react-day-picker.",
  ].join("\n");
}

/** Module path → imported names, deduplicated (`"*"` means a namespace import). */
type Imports = Record<string, Set<string>>;

const addImport = (imports: Imports, module: string, ...names: string[]) => {
  const set = (imports[module] ??= new Set<string>());
  for (const n of names) set.add(n);
};

/** Text kept as JSX text, escaped so user labels can never break the file. */
const jsxText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/{/g, "&#123;").replace(/}/g, "&#125;");

/** A string attribute value. */
const attr = (s: string) => `"${s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;

const anchor = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "-") || "field";

const indent = (text: string, n: number) =>
  text
    .split("\n")
    .map((l) => (l ? " ".repeat(n) + l : l))
    .join("\n");

type Ctx = {
  spec: FieldSpec;
  component: string;
  sensitive: boolean;
  imports: Imports;
  helpers: Set<"Combobox" | "DatePicker">;
};

/** The control for one field, mirroring the renderer for that component id in src/catalog-render.tsx. */
function controlOf(ctx: Ctx): string {
  const { spec, imports } = ctx;
  switch (ctx.component) {
    case "input": {
      const type = ctx.sensitive ? "password" : spec.format === "email" ? "email" : spec.format === "url" ? "url" : "text";
      const placeholder = spec.format === "email" ? ` placeholder="you@example.com"` : "";
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/input", "Input");
      return `<FormControl>\n  <Input type=${attr(type)}${placeholder} {...field} value={field.value ?? ""} />\n</FormControl>`;
    }
    case "textarea": {
      const maxLength = spec.max != null ? ` maxLength={${spec.max}}` : "";
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/textarea", "Textarea");
      return `<FormControl>\n  <Textarea rows={4}${maxLength} {...field} value={field.value ?? ""} className="min-h-24" />\n</FormControl>`;
    }
    case "otp": {
      const len = Math.min(Math.max(spec.max ?? 6, 4), 8);
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/input-otp", "InputOTP", "InputOTPGroup", "InputOTPSlot");
      return [
        `<FormControl>`,
        `  <InputOTP maxLength={${len}} value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur}>`,
        `    <InputOTPGroup>`,
        `      {Array.from({ length: ${len} }, (_, i) => (`,
        `        <InputOTPSlot key={i} index={i} />`,
        `      ))}`,
        `    </InputOTPGroup>`,
        `  </InputOTP>`,
        `</FormControl>`,
      ].join("\n");
    }
    case "number": {
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/input", "Input");
      return [
        `<FormControl>`,
        `  <Input`,
        `    type="number"`,
        `    inputMode="numeric"`,
        ...(spec.min != null ? [`    min={${spec.min}}`] : []),
        ...(spec.max != null ? [`    max={${spec.max}}`] : []),
        `    name={field.name}`,
        `    ref={field.ref}`,
        `    onBlur={field.onBlur}`,
        `    value={field.value ?? ""}`,
        `    onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)}`,
        `    className="w-40"`,
        `  />`,
        `</FormControl>`,
      ].join("\n");
    }
    case "slider": {
      const min = spec.min ?? 0;
      const max = spec.max ?? 100;
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/slider", "Slider");
      return [
        `<div className="flex items-center gap-4">`,
        `  <FormControl>`,
        `    <Slider min={${min}} max={${max}} step={1} value={[field.value ?? ${min}]} onValueChange={([v]) => field.onChange(v)} onBlur={field.onBlur} />`,
        `  </FormControl>`,
        `  <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">{field.value ?? ${min}}</span>`,
        `</div>`,
      ].join("\n");
    }
    case "switch": {
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/switch", "Switch");
      return `<FormControl>\n  <Switch checked={!!field.value} onCheckedChange={field.onChange} onBlur={field.onBlur} />\n</FormControl>`;
    }
    case "checkbox": {
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/checkbox", "Checkbox");
      return `<FormControl>\n  <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} onBlur={field.onBlur} />\n</FormControl>`;
    }
    case "radio": {
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/label", "Label");
      addImport(imports, "@/components/ui/radio-group", "RadioGroup", "RadioGroupItem");
      const options = (spec.options ?? []).map((o, i) => {
        const id = `${anchor(spec.name)}-${i}`;
        return [
          `  <div className="flex items-center gap-2">`,
          `    <RadioGroupItem value=${attr(o)} id=${attr(id)} />`,
          `    <Label htmlFor=${attr(id)} className="font-normal">`,
          `      ${jsxText(o)}`,
          `    </Label>`,
          `  </div>`,
        ].join("\n");
      });
      return [`<FormControl>`, `  <RadioGroup value={field.value ?? ""} onValueChange={field.onChange} className="gap-2">`, indent(options.join("\n"), 2), `  </RadioGroup>`, `</FormControl>`].join("\n");
    }
    case "select": {
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/select", "Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue");
      const options = (spec.options ?? [])
        .map((o) => [`    <SelectItem value=${attr(o)}>`, `      ${jsxText(o)}`, `    </SelectItem>`].join("\n"))
        .join("\n");
      return [
        `<Select value={field.value ?? ""} onValueChange={field.onChange}>`,
        `  <FormControl>`,
        `    <SelectTrigger onBlur={field.onBlur}>`,
        `      <SelectValue placeholder="Choose…" />`,
        `    </SelectTrigger>`,
        `  </FormControl>`,
        `  <SelectContent>`,
        options,
        `  </SelectContent>`,
        `</Select>`,
      ].join("\n");
    }
    case "combobox": {
      ctx.helpers.add("Combobox");
      addImport(imports, "lucide-react", "CheckIcon", "ChevronsUpDownIcon");
      addImport(imports, "@/lib/utils", "cn");
      addImport(imports, "@/components/ui/button", "Button");
      addImport(imports, "@/components/ui/command", "Command", "CommandEmpty", "CommandGroup", "CommandInput", "CommandItem", "CommandList");
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/popover", "Popover", "PopoverContent", "PopoverTrigger");
      return [
        `<Combobox`,
        `  options={${codeList(spec.options ?? [], "    ")}}`,
        `  value={field.value}`,
        `  onChange={field.onChange}`,
        `  placeholder=${attr(`Search ${spec.label.toLowerCase()}…`)}`,
        `/>`,
      ].join("\n");
    }
    case "checkbox-group": {
      addImport(imports, "@/components/ui/checkbox", "Checkbox");
      addImport(imports, "@/components/ui/label", "Label");
      const options = (spec.options ?? []).map((o, i) => {
        const id = `${anchor(spec.name)}-${i}`;
        const json = JSON.stringify(o);
        return [
          `  <div className="flex items-center gap-2">`,
          `    <Checkbox`,
          `      id=${attr(id)}`,
          `      checked={value.includes(${json})}`,
          `      onCheckedChange={(on) => field.onChange(on ? [...value, ${json}] : value.filter((v) => v !== ${json}))}`,
          `    />`,
          `    <Label htmlFor=${attr(id)} className="font-normal">`,
          `      ${jsxText(o)}`,
          `    </Label>`,
          `  </div>`,
        ].join("\n");
      });
      return `<div className="grid gap-2">\n${options.join("\n")}\n</div>`;
    }
    case "chips": {
      addImport(imports, "@/components/ui/toggle-group", "ToggleGroup", "ToggleGroupItem");
      const options = (spec.options ?? [])
        .map((o) =>
          [`  <ToggleGroupItem value=${attr(o)} className="rounded-full">`, `    ${jsxText(o)}`, `  </ToggleGroupItem>`].join("\n"),
        )
        .join("\n");
      return [
        `<ToggleGroup type="multiple" variant="outline" spacing={2} className="flex-wrap" value={value} onValueChange={field.onChange}>`,
        options,
        `</ToggleGroup>`,
      ].join("\n");
    }
    case "date-picker": {
      ctx.helpers.add("DatePicker");
      addImport(imports, "@/components/ui/form", "FormControl");
      return `<DatePicker value={field.value} onChange={field.onChange} />`;
    }
    case "date-input": {
      addImport(imports, "@/components/ui/form", "FormControl");
      addImport(imports, "@/components/ui/input", "Input");
      return [
        `<FormControl>`,
        `  <Input`,
        `    type="date"`,
        `    className="w-48"`,
        `    name={field.name}`,
        `    ref={field.ref}`,
        `    onBlur={field.onBlur}`,
        `    value={toISO(field.value)}`,
        `    onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : undefined)}`,
        `  />`,
        `</FormControl>`,
      ].join("\n");
    }
    default:
      return `<FormControl>\n  <Input {...field} value={field.value ?? ""} />\n</FormControl>`;
  }
}

/** Booleans put their label next to the control instead of above it (same set as src/catalog-render.tsx). */
const INLINE_LABEL = new Set(["switch", "checkbox"]);

/** One <FormField> block, at zero indentation. */
function fieldBlock(spec: FieldSpec, component: string, sensitive: boolean): { code: string; imports: Imports; helpers: Set<"Combobox" | "DatePicker"> } {
  const imports: Imports = {};
  const helpers = new Set<"Combobox" | "DatePicker">();
  const control = controlOf({ spec, component, sensitive, imports, helpers });
  addImport(imports, "@/components/ui/form", "FormField", "FormItem", "FormLabel", "FormMessage");
  const description = spec.description ? `<FormDescription>${jsxText(spec.description)}</FormDescription>` : "";
  if (spec.description) addImport(imports, "@/components/ui/form", "FormDescription");

  const label = spec.required ? `${jsxText(spec.label)} <span className="text-destructive">*</span>` : jsxText(spec.label);
  const body = INLINE_LABEL.has(component)
    ? [
        `<FormItem className="flex flex-row items-start gap-3 rounded-lg border p-3">`,
        `  <div className="pt-0.5">`,
        indent(control, 4),
        `  </div>`,
        `  <div className="grid gap-1.5">`,
        `    <FormLabel className="leading-snug">${label}</FormLabel>`,
        ...(description ? [indent(description, 4)] : []),
        `    <FormMessage />`,
        `  </div>`,
        `</FormItem>`,
      ]
    : [
        `<FormItem>`,
        `  <FormLabel>${label}</FormLabel>`,
        indent(control, 2),
        ...(description ? [indent(description, 2)] : []),
        `  <FormMessage />`,
        `</FormItem>`,
      ];

  // Lists need the current array in scope; the render callback becomes a block.
  const inner = body.join("\n");
  const render =
    component === "checkbox-group" || component === "chips"
      ? [`render={({ field }) => {`, `  const value: string[] = field.value ?? [];`, `  return (`, indent(inner, 4), `  );`, `}}`].join("\n")
      : [`render={({ field }) => (`, indent(inner, 2), `)}`].join("\n");

  const code = [`<FormField`, `  control={form.control}`, `  name=${attr(spec.name)}`, indent(render, 2), `/>`].join("\n");
  return { code, imports, helpers };
}

/** The generated `<GeneratedForm />` file: schema, defaults, form and per-field controls. */
export function generatedFormCode(input: CodegenInput): string {
  const { purpose, fields, picks } = input;
  const imports: Imports = {};
  const helpers = new Set<"Combobox" | "DatePicker">();
  let usesToISO = false;

  // Same sections and column widths as the live preview: from the layout picks, else from the rules.
  const sections = groupSections(
    fields,
    fields.map((f) => picks[f.id]?.layout),
  );
  const sectionCode = sections
    .map((section) => {
      const inner = section.fields.map((spec) => {
        const pick = picks[spec.id];
        const component = resolveComponent(spec, pick);
        const block = fieldBlock(spec, component, (pick?.sensitive ?? 0) >= 0.5);
        for (const [module, names] of Object.entries(block.imports)) addImport(imports, module, ...names);
        for (const h of block.helpers) helpers.add(h);
        if (component === "date-input") usesToISO = true;
        return [`<div className=${attr(SPAN[widthFor(spec, pick?.layout)])}>`, indent(block.code, 2), `</div>`].join("\n");
      });
      return [
        `<section className="space-y-3">`,
        `  <h3 className="border-b pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">${jsxText(section.title)}</h3>`,
        `  <div className="grid grid-cols-1 gap-x-4 gap-y-5 lg:grid-cols-6">`,
        indent(inner.join("\n\n"), 4),
        `  </div>`,
        `</section>`,
      ].join("\n");
    })
    .join("\n\n");
  if (helpers.has("Combobox")) {
    addImport(imports, "@/components/ui/command", "Command", "CommandEmpty", "CommandGroup", "CommandInput", "CommandItem", "CommandList");
    addImport(imports, "@/components/ui/form", "FormControl");
    addImport(imports, "@/components/ui/popover", "Popover", "PopoverContent", "PopoverTrigger");
    addImport(imports, "@/lib/utils", "cn");
  }
  if (helpers.has("DatePicker")) {
    addImport(imports, "lucide-react", "CalendarIcon");
    addImport(imports, "@/lib/utils", "cn");
    addImport(imports, "@/components/ui/calendar", "Calendar");
    addImport(imports, "@/components/ui/form", "FormControl");
    addImport(imports, "@/components/ui/popover", "Popover", "PopoverContent", "PopoverTrigger");
  }

  addImport(imports, "react", "*");
  addImport(imports, "react-hook-form", "useForm");
  addImport(imports, "@hookform/resolvers/zod", "zodResolver");
  addImport(imports, "zod", "z");
  addImport(imports, "@/components/ui/form", "Form");
  addImport(imports, "@/components/ui/button", "Button");

  const importLines = Object.entries(imports)
    .sort(([a], [b]) => importRank(a) - importRank(b) || a.localeCompare(b))
    .map(([module, names]) => (names.has("*") ? `import * as React from "react";` : `import { ${[...names].sort().join(", ")} } from "${module}";`));

  const defaults = fields
    .map((f) => {
      const component = resolveComponent(f, picks[f.id]);
      switch (f.kind) {
        case "string":
          return `      ${f.name}: "",`;
        case "number":
          return component === "slider" ? `      ${f.name}: ${f.min ?? 0},` : "";
        case "boolean":
          return `      ${f.name}: false,`;
        case "multi":
          return `      ${f.name}: [],`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");

  const schema = fields.map((f) => `  ${f.name}: ${zodCodeForField(f)},`).join("\n");
  const title = purpose.replace(/[\r\n]+/g, " ").replace(/\*\//g, "* /").trim() || "Untitled form";

  const helperCode = [
    ...(helpers.has("DatePicker")
      ? [`const fmt = (date: Date) => date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });`]
      : []),
    ...(helpers.has("Combobox") ? [comboboxHelper()] : []),
    ...(helpers.has("DatePicker") ? [datePickerHelper()] : []),
  ].join("\n\n");

  return (
    [
      `/**`,
      ` * ${title}`,
      ` *`,
      ` * Generated by Jev Form Builder. Self-contained: paste it into any shadcn/ui project.`,
      ` */`,
      importLines.join("\n"),
      ``,
      `const formSchema = z.object({`,
      schema,
      `});`,
      ``,
      `export type FormValues = z.infer<typeof formSchema>;`,
      ``,
      ...(usesToISO
        ? [
            `function toISO(date: Date | undefined) {`,
            `  return date ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-") : "";`,
            `}`,
            ``,
          ]
        : []),
      `export default function GeneratedForm() {`,
      `  const form = useForm<FormValues>({`,
      `    resolver: zodResolver(formSchema),`,
      `    defaultValues: {`,
      defaults,
      `    },`,
      `    mode: "onTouched",`,
      `  });`,
      `  const [submitted, setSubmitted] = React.useState<FormValues | null>(null);`,
      ``,
      `  return (`,
      `    <Form {...form}>`,
      `      <form`,
      `        onSubmit={form.handleSubmit((values) => {`,
      `          console.log(values);`,
      `          setSubmitted(values);`,
      `        })}`,
      `        className="space-y-6"`,
      `        noValidate`,
      `      >`,
      `        <div>`,
      `          <h2 className="text-xl font-semibold tracking-tight">${jsxText(title)}</h2>`,
      `          <p className="text-sm text-muted-foreground">Validated by the generated Zod schema.</p>`,
      `        </div>`,
      ``,
      indent(sectionCode, 8),
      ``,
      `        <div className="flex gap-2">`,
      `          <Button type="submit">Submit</Button>`,
      `          <Button type="button" variant="ghost" onClick={() => form.reset()}>`,
      `            Reset`,
      `          </Button>`,
      `        </div>`,
      `        {submitted && <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs">{JSON.stringify(submitted, null, 2)}</pre>}`,
      `      </form>`,
      `    </Form>`,
      `  );`,
      `}`,
      ...(helperCode ? [``, helperCode] : []),
      ``,
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd()
      .concat("\n")
  );
}

/** Import order: react, form plumbing, zod, icons, aliases. */
function importRank(module: string): number {
  if (module === "react") return 0;
  if (module === "react-hook-form" || module === "@hookform/resolvers/zod" || module === "zod") return 1;
  if (module === "lucide-react") return 2;
  if (module === "@/lib/utils") return 3;
  return 4;
}

function comboboxHelper(): string {
  return [
    `function Combobox({`,
    `  options,`,
    `  value,`,
    `  onChange,`,
    `  placeholder = "Search…",`,
    `}: {`,
    `  options: readonly string[];`,
    `  value?: string;`,
    `  onChange: (value: string) => void;`,
    `  placeholder?: string;`,
    `}) {`,
    `  const [open, setOpen] = React.useState(false);`,
    `  return (`,
    `    <Popover open={open} onOpenChange={setOpen}>`,
    `      <PopoverTrigger asChild>`,
    `        <FormControl>`,
    `          <Button`,
    `            variant="outline"`,
    `            role="combobox"`,
    `            className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}`,
    `          >`,
    `            {value || placeholder}`,
    `            <ChevronsUpDownIcon className="opacity-50" />`,
    `          </Button>`,
    `        </FormControl>`,
    `      </PopoverTrigger>`,
    `      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">`,
    `        <Command>`,
    `          <CommandInput placeholder={placeholder} />`,
    `          <CommandList>`,
    `            <CommandEmpty>Nothing found.</CommandEmpty>`,
    `            <CommandGroup>`,
    `              {options.map((option) => (`,
    `                <CommandItem`,
    `                  key={option}`,
    `                  value={option}`,
    `                  onSelect={() => {`,
    `                    onChange(option);`,
    `                    setOpen(false);`,
    `                  }}`,
    `                >`,
    `                  {option}`,
    `                  <CheckIcon className={cn("ml-auto", option === value ? "opacity-100" : "opacity-0")} />`,
    `                </CommandItem>`,
    `              ))}`,
    `            </CommandGroup>`,
    `          </CommandList>`,
    `        </Command>`,
    `      </PopoverContent>`,
    `    </Popover>`,
    `  );`,
    `}`,
  ].join("\n");
}

function datePickerHelper(): string {
  return [
    `function DatePicker({`,
    `  value,`,
    `  onChange,`,
    `  placeholder = "Pick a date",`,
    `}: {`,
    `  value?: Date;`,
    `  onChange: (date: Date | undefined) => void;`,
    `  placeholder?: string;`,
    `}) {`,
    `  const [open, setOpen] = React.useState(false);`,
    `  return (`,
    `    <Popover open={open} onOpenChange={setOpen}>`,
    `      <PopoverTrigger asChild>`,
    `        <FormControl>`,
    `          <Button variant="outline" className={cn("w-60 justify-start font-normal", !value && "text-muted-foreground")}>`,
    `            <CalendarIcon />`,
    `            {value ? fmt(value) : placeholder}`,
    `          </Button>`,
    `        </FormControl>`,
    `      </PopoverTrigger>`,
    `      <PopoverContent className="w-auto p-0" align="start">`,
    `        <Calendar`,
    `          mode="single"`,
    `          selected={value}`,
    `          onSelect={(date: Date | undefined) => {`,
    `            onChange(date);`,
    `            setOpen(false);`,
    `          }}`,
    `        />`,
    `      </PopoverContent>`,
    `    </Popover>`,
    `  );`,
    `}`,
  ].join("\n");
}
