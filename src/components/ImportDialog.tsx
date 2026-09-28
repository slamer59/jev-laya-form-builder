import * as React from "react";
import { UploadIcon } from "lucide-react";
import { KINDS } from "@shared/types";
import { parseImport, type ImportResult } from "@shared/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const FORMAT_LABEL: Record<ImportResult["format"], string> = {
  "builder-file": "Builder file · JSON Schema + uiSchema",
  "json-schema": "JSON Schema",
  zod: "Zod source",
};

const PREVIEW_LIMIT = 12;

/** Paste a JSON Schema, a Zod `z.object({ … })` snippet, or a builder export. */
export function ImportDialog({ onImport }: { onImport: (result: ImportResult) => void }) {
  const [open, setOpen] = React.useState(false);
  const [src, setSrc] = React.useState("");
  const result = React.useMemo(() => (src.trim() ? parseImport(src) : null), [src]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UploadIcon /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a form</DialogTitle>
          <DialogDescription>
            Paste a JSON Schema object, a file exported by this builder (JSON Schema + uiSchema) or a Zod <code>z.object(…)</code> snippet. Title, description,
            type, format, enum, bounds and required are mapped, <code>ui:widget</code> becomes a component override; anything else becomes a text field.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          autoFocus
          rows={9}
          className="max-h-64 min-h-36 font-mono text-xs"
          placeholder={'{\n  "schema": {\n    "type": "object",\n    "description": "Sign-up",\n    "required": ["email"],\n    "properties": {\n      "email": { "title": "Email", "type": "string", "format": "email" },\n      "plan": { "title": "Plan", "type": "string", "enum": ["Free", "Pro"] }\n    }\n  },\n  "uiSchema": { "ui:order": ["email", "plan"] }\n}'}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
        />

        {result && (
          <div className="grid gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{FORMAT_LABEL[result.format]}</Badge>
              <span className="text-muted-foreground">
                {result.fields.length} field{result.fields.length === 1 ? "" : "s"}
              </span>
              {!result.ok && <span className="text-destructive">Nothing to import yet</span>}
            </div>

            {result.fields.length > 0 && (
              <ul className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 font-mono leading-relaxed">
                {result.fields.slice(0, PREVIEW_LIMIT).map((f) => (
                  <li key={f.id}>
                    {f.name} · {KINDS.find((k) => k.value === f.kind)?.label}
                    {f.options ? ` (${f.options.length} options)` : ""}
                    {f.format ? ` · ${f.format}` : ""}
                  </li>
                ))}
                {result.fields.length > PREVIEW_LIMIT && <li className="text-muted-foreground">… {result.fields.length - PREVIEW_LIMIT} more</li>}
              </ul>
            )}

            {result.warnings.length > 0 && (
              <div className="max-h-32 overflow-auto rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-900/60 dark:bg-amber-950/40">
                <p className="font-medium text-amber-900 dark:text-amber-200">{result.warnings.length} thing(s) could not be mapped</p>
                <ul className="mt-1 list-disc pl-4 text-amber-900 dark:text-amber-200">
                  {result.warnings.map((w, i) => (
                    <li key={`${i}-${w}`}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!result?.ok}
            onClick={() => {
              if (!result?.ok) return;
              onImport(result);
              setSrc("");
              setOpen(false);
            }}
          >
            Replace form
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
