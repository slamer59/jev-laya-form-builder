import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, Trash2Icon } from "lucide-react";
import { KINDS, type FieldSpec, type Kind, type Pick } from "@shared/types";
import { catalogById } from "@shared/catalog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  field: FieldSpec;
  pick?: Pick;
  open: boolean;
  duplicateName: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<FieldSpec>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
};

const toName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1") || "field";

const numOrUndef = (v: string) => (v === "" ? undefined : Number(v));

export function FieldEditor({ field: f, pick, open, duplicateName, onToggle, onChange, onMove, onRemove, isFirst, isLast }: Props) {
  const kindLabel = KINDS.find((k) => k.value === f.kind)?.label;
  const hasOptions = f.kind === "enum" || f.kind === "multi";
  const hasRange = f.kind === "number" || f.kind === "string";

  return (
    <div className={cn("rounded-lg border bg-card", open && "ring-2 ring-ring/30")}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {f.label || <em className="text-muted-foreground">No label</em>}
            {f.required && <span className="text-destructive">*</span>}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {f.name} · {kindLabel}
          </span>
        </span>
        {pick && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{catalogById[pick.component]?.name}</span>}
      </button>

      {open && (
        <div className="grid gap-3 border-t p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${f.id}-label`}>Label</Label>
              <Input
                id={`${f.id}-label`}
                value={f.label}
                onChange={(e) => {
                  const label = e.target.value;
                  // Keep the name in sync while it still matches the old label.
                  onChange(f.name === toName(f.label) ? { label, name: toName(label) } : { label });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${f.id}-name`}>Key</Label>
              <Input
                id={`${f.id}-name`}
                className="font-mono text-xs"
                value={f.name}
                aria-invalid={duplicateName}
                onChange={(e) => onChange({ name: toName(e.target.value) })}
              />
              {duplicateName && <p className="text-xs text-destructive">Another field uses this key</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Value type</Label>
              <Select
                value={f.kind}
                onValueChange={(v) => {
                  const kind = v as Kind;
                  const needsOptions = kind === "enum" || kind === "multi";
                  onChange({
                    kind,
                    options: needsOptions ? (f.options?.length ? f.options : ["Option A", "Option B", "Option C"]) : undefined,
                    format: kind === "string" ? f.format : undefined,
                    min: kind === "number" || kind === "string" ? f.min : undefined,
                    max: kind === "number" || kind === "string" ? f.max : undefined,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {f.kind === "string" ? (
              <div className="grid gap-1.5">
                <Label>Format</Label>
                <Select value={f.format ?? "none"} onValueChange={(v) => onChange({ format: v === "none" ? undefined : (v as "email" | "url") })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any text</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="url">URL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div />
            )}
          </div>

          {hasOptions && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${f.id}-options`}>Options, one per line</Label>
              <Textarea
                id={`${f.id}-options`}
                rows={4}
                className="min-h-20 text-xs"
                defaultValue={(f.options ?? []).join("\n")}
                onBlur={(e) => {
                  const options = [...new Set(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))];
                  onChange({ options: options.length ? options : ["Option A"] });
                }}
              />
              <p className="text-xs text-muted-foreground">{f.options?.length ?? 0} options. Applied when you leave the box.</p>
            </div>
          )}

          {hasRange && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`${f.id}-min`}>{f.kind === "string" ? "Min length" : "Min"}</Label>
                <Input id={`${f.id}-min`} type="number" value={f.min ?? ""} onChange={(e) => onChange({ min: numOrUndef(e.target.value) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${f.id}-max`}>{f.kind === "string" ? "Max length" : "Max"}</Label>
                <Input id={`${f.id}-max`} type="number" value={f.max ?? ""} onChange={(e) => onChange({ max: numOrUndef(e.target.value) })} />
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor={`${f.id}-hint`}>Hint (shown to users, and read by Jev)</Label>
            <Input id={`${f.id}-hint`} value={f.description ?? ""} onChange={(e) => onChange({ description: e.target.value || undefined })} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch id={`${f.id}-req`} checked={f.required} onCheckedChange={(required) => onChange({ required })} />
              <Label htmlFor={`${f.id}-req`}>Required</Label>
            </div>
            <div className="flex gap-1">
              <Button type="button" size="icon" variant="ghost" className="size-8" disabled={isFirst} onClick={() => onMove(-1)} aria-label="Move up">
                <ArrowUpIcon />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-8" disabled={isLast} onClick={() => onMove(1)} aria-label="Move down">
                <ArrowDownIcon />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive" onClick={onRemove} aria-label="Delete field">
                <Trash2Icon />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
