import type { Backend } from "@shared/types";
import { BACKENDS } from "@shared/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Chooses which backend the server answers with. Unavailable backends stay visible but disabled. */
export function BackendPicker({
  value,
  available,
  onChange,
}: {
  value: Backend | null;
  available: Record<Backend, boolean> | null;
  onChange: (backend: Backend) => void;
}) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as Backend)}>
      <SelectTrigger size="sm" className="text-xs" aria-label="Backend" title="Which model decides the components">
        <SelectValue placeholder="Backend…" />
      </SelectTrigger>
      <SelectContent>
        {BACKENDS.map((b) => {
          const off = available?.[b.value] === false;
          return (
            <SelectItem key={b.value} value={b.value} disabled={off}>
              {b.label}
              {off ? " · offline" : ""}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
