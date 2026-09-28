import * as React from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { CalendarIcon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
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

export type RenderProps = {
  field: ControllerRenderProps<FieldValues, string>;
  spec: FieldSpec;
  sensitive: boolean;
};

/** Booleans put their label next to the control instead of above it. */
export const INLINE_LABEL = new Set(["switch", "checkbox"]);

const fmt = (d: Date) => d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const toISO = (d?: Date) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");

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

  chips: ({ field, spec }) => {
    const value: string[] = field.value ?? [];
    return (
      <div className="flex flex-wrap gap-2">
        {spec.options?.map((o) => {
          const on = value.includes(o);
          return (
            <Button
              key={o}
              type="button"
              size="sm"
              variant={on ? "default" : "outline"}
              aria-pressed={on}
              className="rounded-full"
              onClick={() => field.onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            >
              {on && <CheckIcon />}
              {o}
            </Button>
          );
        })}
      </div>
    );
  },

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
};

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
