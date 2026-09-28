import type { FieldSpec, Pick } from "@shared/types";
import { WIDTHS, WIDTH_LABEL, widthFor } from "@shared/layout";
import { cn } from "@/lib/utils";

/** One probability row: label, bar, percentage. Mirrors the component rows in the Decisions tab. */
function Bar({ label, prob, chosen }: { label: string; prob?: number; chosen: boolean }) {
  return (
    <div className="grid grid-cols-[100px_1fr_44px] items-center gap-2 text-xs">
      <span className={chosen ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={chosen ? "h-full bg-primary" : "h-full bg-muted-foreground/40"} style={{ width: `${prob != null ? prob * 100 : chosen ? 100 : 0}%` }} />
      </div>
      <span className="text-right tabular-nums text-muted-foreground">{prob != null ? `${Math.round(prob * 100)}%` : chosen ? "✓" : ""}</span>
    </div>
  );
}

/** The layout questions' answers for one field: column width and section break, with probabilities. */
export function LayoutDecisions({ field, pick }: { field: FieldSpec; pick?: Pick }) {
  const layout = pick?.layout;
  const width = widthFor(field, layout);
  const titles = layout?.sectionTitleProbabilities;
  const said = layout?.sectionProbability;
  const trusted = layout?.source === "jev" || layout?.source === "laya";
  const overridden = said != null && (said >= 0.5) !== !!layout?.startsSection;
  return (
    <div className="grid gap-1.5 rounded-md border bg-muted/30 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium">Layout</span>
        <span className={cn(trusted ? "text-foreground" : "text-muted-foreground")}>
          {WIDTH_LABEL[width]}
          {layout?.source === "low-confidence" && layout.modelWidth && layout.modelWidth !== width && ` (model leaned ${WIDTH_LABEL[layout.modelWidth].toLowerCase()})`}
          {!trusted && ` · ${layout?.source === "low-confidence" ? "rule default" : "rule"}`}
        </span>
        <span className="text-muted-foreground">
          {layout?.startsSection ? `starts a section${layout.sectionTitle ? `: ${layout.sectionTitle}` : ""}` : "continues the section"}
          {said != null && ` (${Math.round(said * 100)}% says yes${overridden ? ", rule decides" : ""})`}
        </span>
      </div>
      {layout?.widthProbabilities && WIDTHS.map((w) => <Bar key={w} label={WIDTH_LABEL[w]} prob={layout.widthProbabilities?.[w]} chosen={w === width} />)}
      {titles && Object.entries(titles).map(([title, prob]) => <Bar key={title} label={title} prob={prob} chosen={title === layout?.sectionTitle} />)}
    </div>
  );
}
