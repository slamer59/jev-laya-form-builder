import * as React from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, CheckIcon, ChevronsUpDownIcon, FileIcon, MinusIcon, PaperclipIcon, PlusIcon, StarIcon, UploadIcon, XIcon } from "lucide-react";
import type { FieldSpec } from "@shared/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { FormControl } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type RenderProps = {
  field: ControllerRenderProps<FieldValues, string>;
  spec: FieldSpec;
  sensitive: boolean;
};

/** Booleans put their label next to the control instead of above it. */
export const INLINE_LABEL = new Set(["switch", "checkbox"]);

const fmt = (d: Date) => d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const toISO = (d?: Date) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");
/** Keep a nudged value inside the field's declared bounds. */
const clampTo = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

/** Catalogue id → shadcn component. Keep ids in sync with shared/catalog.ts. */
export const RENDERERS: Record<string, (p: RenderProps) => React.ReactNode> = {
  input: ({ field, spec, sensitive }) => (
    <FormControl>
      <Input
        type={sensitive ? "password" : spec.format === "email" ? "email" : spec.format === "url" ? "url" : "text"}
        placeholder={spec.format === "email" ? "you@example.com" : undefined}
        {...field}
        value={field.value ?? ""}
      />
    </FormControl>
  ),

  "input-affix": ({ field, spec, sensitive }) => (
    <div className="border-input flex items-stretch overflow-hidden rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-destructive/20">
      {spec.prefix && <span className="bg-muted text-muted-foreground flex items-center border-r px-3 text-sm">{spec.prefix}</span>}
      <FormControl>
        <Input
          type={sensitive ? "password" : spec.format === "email" ? "email" : spec.format === "url" ? "url" : "text"}
          {...field}
          value={field.value ?? ""}
          className="rounded-none border-0 shadow-none focus-visible:ring-0 aria-invalid:border-0 aria-invalid:ring-0 dark:bg-transparent"
        />
      </FormControl>
      {spec.suffix && <span className="bg-muted text-muted-foreground flex items-center border-l px-3 text-sm">{spec.suffix}</span>}
    </div>
  ),

  textarea: ({ field, spec }) => (
    <FormControl>
      <Textarea rows={4} maxLength={spec.max} {...field} value={field.value ?? ""} className="min-h-24" />
    </FormControl>
  ),

  otp: ({ field, spec }) => {
    const len = Math.min(Math.max(spec.max ?? 6, 4), 8);
    return (
      <FormControl>
        <InputOTP maxLength={len} value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur}>
          <InputOTPGroup>
            {Array.from({ length: len }, (_, i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </FormControl>
    );
  },

  number: ({ field, spec }) => (
    <FormControl>
      <Input
        type="number"
        inputMode="numeric"
        min={spec.min}
        max={spec.max}
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        value={field.value ?? ""}
        onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)}
        className="w-40"
      />
    </FormControl>
  ),

  stepper: ({ field, spec }) => {
    const min = spec.min ?? 0;
    const max = spec.max ?? 100;
    const value: number | undefined = field.value;
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={value != null && value <= min}
          onClick={() => field.onChange(clampTo((value ?? min) - 1, min, max))}
          aria-label="Decrease"
        >
          <MinusIcon />
        </Button>
        <FormControl>
          <Input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={value ?? ""}
            onChange={(e) => field.onChange(e.target.value === "" ? undefined : clampTo(e.target.valueAsNumber, min, max))}
            className="w-20 text-center tabular-nums"
          />
        </FormControl>
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={value != null && value >= max}
          onClick={() => field.onChange(clampTo((value ?? min) + 1, min, max))}
          aria-label="Increase"
        >
          <PlusIcon />
        </Button>
      </div>
    );
  },

  rating: (p) => <Rating {...p} />,

  slider: ({ field, spec }) => {
    const min = spec.min ?? 0;
    const max = spec.max ?? 100;
    return (
      <div className="flex items-center gap-4">
        <FormControl>
          <Slider min={min} max={max} step={1} value={[field.value ?? min]} onValueChange={([v]) => field.onChange(v)} onBlur={field.onBlur} />
        </FormControl>
        <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">{field.value ?? min}</span>
      </div>
    );
  },

  switch: ({ field }) => (
    <FormControl>
      <Switch checked={!!field.value} onCheckedChange={field.onChange} onBlur={field.onBlur} />
    </FormControl>
  ),

  checkbox: ({ field }) => (
    <FormControl>
      <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} onBlur={field.onBlur} />
    </FormControl>
  ),

  "toggle-group": ({ field, spec }) => (
    <FormControl>
      <ToggleGroup
        type="single"
        variant="outline"
        value={field.value ?? ""}
        onValueChange={(v) => field.onChange(v || undefined)}
        onBlur={field.onBlur}
      >
        {spec.options?.map((o) => (
          <ToggleGroupItem key={o} value={o}>
            {o}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FormControl>
  ),

  radio: ({ field, spec }) => (
    <FormControl>
      <RadioGroup value={field.value ?? ""} onValueChange={field.onChange} className="gap-2">
        {spec.options?.map((o) => (
          <div key={o} className="flex items-center gap-2">
            <RadioGroupItem value={o} id={`${spec.id}-${o}`} />
            <Label htmlFor={`${spec.id}-${o}`} className="font-normal">
              {o}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </FormControl>
  ),

  select: ({ field, spec }) => (
    <Select value={field.value ?? ""} onValueChange={field.onChange}>
      <FormControl>
        <SelectTrigger onBlur={field.onBlur}>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {spec.options?.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),

  combobox: (p) => <Combobox {...p} />,

  "checkbox-group": ({ field, spec }) => {
    const value: string[] = field.value ?? [];
    return (
      <div className="grid gap-2">
        {spec.options?.map((o) => (
          <div key={o} className="flex items-center gap-2">
            <Checkbox
              id={`${spec.id}-${o}`}
              checked={value.includes(o)}
              onCheckedChange={(on) => field.onChange(on ? [...value, o] : value.filter((v) => v !== o))}
            />
            <Label htmlFor={`${spec.id}-${o}`} className="font-normal">
              {o}
            </Label>
          </div>
        ))}
      </div>
    );
  },

  chips: ({ field, spec }) => (
    <FormControl>
      <ToggleGroup type="multiple" variant="outline" spacing={2} className="flex-wrap" value={field.value ?? []} onValueChange={field.onChange}>
        {spec.options?.map((o) => (
          <ToggleGroupItem key={o} value={o} className="rounded-full">
            {o}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FormControl>
  ),

  "date-picker": (p) => <DatePicker {...p} />,

  "date-input": ({ field }) => (
    <FormControl>
      <Input
        type="date"
        className="w-48"
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        value={toISO(field.value)}
        onChange={(e) => field.onChange(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
      />
    </FormControl>
  ),

  time: ({ field }) => (
    <FormControl>
      <Input
        type="time"
        className="w-40"
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        value={field.value ?? ""}
        onChange={(e) => field.onChange(e.target.value)}
      />
    </FormControl>
  ),

  "date-range-picker": (p) => <DateRangePicker {...p} />,

  "range-slider": ({ field, spec }) => {
    const min = spec.min ?? 0;
    const max = spec.max ?? 100;
    const top = max > min ? max : min + 1; // a degenerate min==max would break the slider
    const [lo, hi] = Array.isArray(field.value) && field.value.length === 2 ? (field.value as number[]) : [min, top];
    return (
      <div className="w-72 space-y-2">
        <FormControl>
          <Slider min={min} max={top} step={1} value={[lo, hi]} onValueChange={([a, b]) => field.onChange([a, b])} onBlur={field.onBlur} />
        </FormControl>
        <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
          <span>{lo}</span>
          <span>{hi}</span>
        </div>
      </div>
    );
  },

  "file-dropzone": (p) => <FileField {...p} dropzone />,
  "file-button": (p) => <FileField {...p} dropzone={false} />,
};

function Rating({ field, spec }: RenderProps) {
  const [hover, setHover] = React.useState(0);
  const max = Math.min(spec.max ?? 5, 5);
  const value: number = typeof field.value === "number" ? field.value : 0;
  const shown = hover || value;
  return (
    <FormControl>
      <div role="radiogroup" aria-label={spec.label} className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)} onBlur={field.onBlur}>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className="rounded p-0.5"
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onClick={() => field.onChange(value === n && !spec.required ? undefined : n)}
          >
            <StarIcon className={cn("size-6 transition-colors", n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
          </button>
        ))}
        {value > 0 && (
          <span className="text-muted-foreground ml-2 text-sm tabular-nums">
            {value}/{max}
          </span>
        )}
      </div>
    </FormControl>
  );
}

function DateRangePicker({ field }: RenderProps) {
  const [open, setOpen] = React.useState(false);
  const range = field.value as DateRange | undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FormControl>
          <Button variant="outline" className={cn("w-72 justify-start font-normal", !range?.from && "text-muted-foreground")}>
            <CalendarIcon />
            {range?.from ? (range.to ? `${fmt(range.from)} – ${fmt(range.to)}` : `${fmt(range.from)} – …`) : "Pick a start and end date"}
          </Button>
        </FormControl>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={range?.from}
          selected={range}
          onSelect={(r) => {
            field.onChange(r);
            if (r?.from && r.to) setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** One implementation for both file components: a drop area (dropzone) or a compact button. */
function FileField({ field, spec, dropzone }: RenderProps & { dropzone: boolean }) {
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const files: File[] = Array.isArray(field.value) ? field.value : field.value ? [field.value] : [];
  const hint = [spec.accept?.split(",").map((s) => s.trim()).join(", "), spec.maxSizeMb && `up to ${spec.maxSizeMb} MB`, spec.multiple && "several allowed"]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid gap-2">
      <FormControl>
        <input
          ref={inputRef}
          type="file"
          name={field.name}
          className="sr-only"
          accept={spec.accept}
          multiple={spec.multiple}
          onBlur={field.onBlur}
          onChange={(e) => {
            field.onChange(spec.multiple ? [...files, ...Array.from(e.target.files ?? [])] : e.target.files?.[0]);
            e.target.value = ""; // so picking the same file again still fires a change
          }}
        />
      </FormControl>

      {dropzone ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            field.onChange(spec.multiple ? [...files, ...Array.from(e.dataTransfer.files)] : e.dataTransfer.files[0]);
          }}
          className={cn(
            "text-muted-foreground grid place-items-center gap-1 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors",
            over && "border-ring bg-accent",
          )}
        >
          <UploadIcon className="size-6" />
          <span className="text-foreground font-medium">{spec.multiple ? "Drag files here, or click to browse" : "Drag a file here, or click to browse"}</span>
          {hint && <span className="text-xs">{hint}</span>}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
            <PaperclipIcon />
            {files.length ? "Replace file…" : "Choose a file…"}
          </Button>
          {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        </div>
      )}

      {files.length > 0 && (
        <ul className="grid gap-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="bg-muted/50 flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <FileIcon className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {f.size < 1024 * 1024 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1024 / 1024).toFixed(1)} MB`}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={`Remove ${f.name}`}
                onClick={() => field.onChange(spec.multiple ? files.filter((_, j) => j !== i) : undefined)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Combobox({ field, spec }: RenderProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FormControl>
          <Button variant="outline" role="combobox" className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}>
            {field.value || "Search…"}
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </FormControl>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${spec.label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {spec.options?.map((o) => (
                <CommandItem
                  key={o}
                  value={o}
                  onSelect={() => {
                    field.onChange(o);
                    setOpen(false);
                  }}
                >
                  {o}
                  <CheckIcon className={cn("ml-auto", o === field.value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DatePicker({ field }: RenderProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FormControl>
          <Button variant="outline" className={cn("w-60 justify-start font-normal", !field.value && "text-muted-foreground")}>
            <CalendarIcon />
            {field.value ? fmt(field.value) : "Pick a date"}
          </Button>
        </FormControl>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={field.value}
          onSelect={(d) => {
            field.onChange(d);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
