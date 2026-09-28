import type { Pick } from "@shared/types";
import { catalogById } from "@shared/catalog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Shows where a pick came from and how sure Jev was. */
export function PickBadge({ pick, className }: { pick: Pick; className?: string }) {
  const lock = (pick.sensitive ?? 0) >= 0.5 ? " · masked" : "";
  switch (pick.source) {
    case "jev": {
      const c = pick.confidence ?? 0;
      return (
        <Badge variant="outline" className={cn("gap-1.5 font-normal", className)}>
          <span className={cn("size-1.5 rounded-full", c >= 0.8 ? "bg-emerald-500" : c >= 0.5 ? "bg-amber-500" : "bg-red-500")} />
          Jev · {pct(c)} sure{lock}
        </Badge>
      );
    }
    case "low-confidence":
      return (
        <Badge variant="outline" className={cn("font-normal text-amber-700 dark:text-amber-400", className)} title={`Jev leaned towards ${catalogById[pick.jevChoice ?? ""]?.name}`}>
          Jev unsure ({pct(pick.confidence ?? 0)}) · rule default{lock}
        </Badge>
      );
    case "override":
      return <Badge variant="secondary" className={cn("font-normal", className)}>Your choice</Badge>;
    case "only-option":
      return <Badge variant="outline" className={cn("font-normal text-muted-foreground", className)}>Only option{lock}</Badge>;
    case "rules":
      return <Badge variant="outline" className={cn("font-normal text-muted-foreground", className)}>Rule{lock}</Badge>;
  }
}
