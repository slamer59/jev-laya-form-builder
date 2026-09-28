import * as React from "react";
import { CheckIcon, DownloadIcon } from "lucide-react";
import { CATALOG } from "@shared/catalog";
import { generatedFormCode, installCode } from "@shared/codegen";
import { schemaToCode } from "@shared/schema";
import type { FieldSpec, Pick } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  purpose: string;
  fields: FieldSpec[];
  picks: Record<string, Pick>;
};

/** The Code view: the generated component, the Zod schema and the install commands, each copyable. */
export function CodeTab({ purpose, fields, picks }: Props) {
  const input = React.useMemo(() => ({ purpose, fields, picks }), [purpose, fields, picks]);
  const component = React.useMemo(() => generatedFormCode(input), [input]);
  const install = React.useMemo(() => installCode(input), [input]);
  const schema = React.useMemo(() => schemaToCode(fields), [fields]);
  const formJson = React.useMemo(
    () => JSON.stringify({ purpose, fields: fields.map(({ id: _id, ...f }) => ({ ...f, component: picks[_id]?.component, layout: picks[_id]?.layout })) }, null, 2),
    [purpose, fields, picks],
  );
  const fileName = `${purpose.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "generated-form"}-form.tsx`;

  return (
    <Tabs defaultValue="component" className="gap-4">
      <TabsList>
        <TabsTrigger value="component">Component</TabsTrigger>
        <TabsTrigger value="schema">Schema</TabsTrigger>
        <TabsTrigger value="install">Install</TabsTrigger>
      </TabsList>

      <TabsContent value="component" className="grid gap-4">
        <p className="text-xs text-muted-foreground">
          A self-contained <code>&lt;GeneratedForm /&gt;</code>: react-hook-form + zodResolver + the shadcn components Jev picked. Run the{" "}
          <strong>Install</strong> commands, then save this as <code>src/components/{fileName}</code>.
        </p>
        <CodeCard title={fileName} code={component} download />
      </TabsContent>

      <TabsContent value="schema" className="grid gap-4">
        <p className="text-xs text-muted-foreground">The same validation the live preview uses, as source.</p>
        <CodeCard title="schema.ts" code={schema} />
      </TabsContent>

      <TabsContent value="install" className="grid gap-4">
        <p className="text-xs text-muted-foreground">
          Only the components and packages this form actually uses. Catalogue ids are mapped to shadcn registry names.
        </p>
        <CodeCard title="install" code={install} />
      </TabsContent>

      <CodeCard title="form.json (render anywhere with FormPreview)" code={formJson} />
      <p className="text-xs text-muted-foreground">
        Catalogue: {CATALOG.map((c) => c.name).join(", ")}. Add one in <code>shared/catalog.ts</code>, a renderer in{" "}
        <code>src/catalog-render.tsx</code> and a template in <code>shared/codegen.ts</code>, and Jev can start choosing it.
      </p>
    </Tabs>
  );
}

function CodeCard({ title, code, download }: { title: string; code: string; download?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="truncate font-mono text-xs">{title}</span>
        <div className="flex shrink-0 items-center gap-1">
          {download && (
            <Button size="sm" variant="ghost" onClick={() => saveFile(title, code)}>
              <DownloadIcon /> Download .tsx
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <CheckIcon /> : null}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <pre className="max-h-[480px] overflow-auto bg-muted/40 p-4 text-xs leading-relaxed">{code}</pre>
    </Card>
  );
}

/** Plain anchor download, so the generated file lands on disk without a server round-trip. */
function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking in the same tick can cancel the download, so let the browser start it first.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
