import * as React from "react";
import { PencilIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  title: string;
  /** True when the user renamed this section (the title is an override, not the model's pick). */
  renamed: boolean;
  onRename: (title: string | null) => void;
};

/** A section heading, editable in place. Sections come from the layout (see shared/layout.ts). */
export function SectionHeading({ title, renamed, onRename }: Props) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (next != null) onRename(next && next !== title ? next : null);
  };

  if (draft != null)
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        className="h-8 max-w-64 font-semibold"
        aria-label="Section title"
      />
    );

  return (
    <h3 className="flex items-center gap-2 border-b pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {title}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-1 text-muted-foreground/60 hover:text-foreground"
        onClick={() => setDraft(title)}
        aria-label={`Rename section ${title}`}
      >
        <PencilIcon className="size-3" />
      </Button>
      {renamed && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1 text-xs font-normal normal-case text-muted-foreground"
          onClick={() => onRename(null)}
          title="Back to the model's title"
        >
          <Undo2Icon className="size-3" /> renamed
        </Button>
      )}
    </h3>
  );
}
