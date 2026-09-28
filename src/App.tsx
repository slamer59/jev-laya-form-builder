import * as React from "react";
import { Loader2Icon, PlusIcon, SparklesIcon } from "lucide-react";
import { candidatesFor } from "@shared/catalog";
import type { Backend, FieldSpec, Pick, PickResponse } from "@shared/types";
import { PRESETS, newFieldId } from "@/presets";
import { BackendPicker } from "@/components/BackendPicker";
import { CodeTab } from "@/components/CodeTab";
import { FieldEditor } from "@/components/FieldEditor";
import { FormPreview } from "@/components/FormPreview";
import { PickBadge } from "@/components/PickBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const FIRST = "Job application";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function App() {
  const [preset, setPreset] = React.useState(FIRST);
  const [purpose, setPurpose] = React.useState(PRESETS[FIRST].purpose);
  const [fields, setFields] = React.useState<FieldSpec[]>(PRESETS[FIRST].fields);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [threshold, setThreshold] = React.useState(0.5);
  const [showDecisions, setShowDecisions] = React.useState(true);
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [res, setRes] = React.useState<PickResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [serverMode, setServerMode] = React.useState<Backend | "offline" | null>(null);
  const [backends, setBackends] = React.useState<Record<Backend, boolean> | null>(null);
  const [backend, setBackend] = React.useState<Backend | null>(null);

  React.useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => {
        setServerMode(s.mode);
        setBackends(s.backends ?? null);
        setBackend((b) => b ?? s.mode); // best available, until the user picks another
      })
      .catch(() => setServerMode("offline"));
  }, []);

  // Ask the server (and the model) whenever the form settles for a moment.
  const request = useDebounced(
    React.useMemo(
      () => ({ purpose, fields, threshold, ...(backend && { backend }) }),
      [purpose, fields, threshold, backend],
    ),
    500,
  );
  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch("/api/pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: ctrl.signal })
      .then((r) => r.json())
      .then((data: PickResponse) => {
        setRes(data);
        setServerMode(data.mode); // reflect which backend actually answered
      })
      .catch((e) => e.name !== "AbortError" && setServerMode("offline"))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [request]);

  const picks: Record<string, Pick> = React.useMemo(() => {
    const out: Record<string, Pick> = {};
    for (const f of fields) {
      const p = res?.picks[f.id];
      const o = overrides[f.id];
      // An override or a stale pick must still fit the field's current value type.
      const fits = (c?: string) => !!c && candidatesFor(f.kind).some((x) => x.id === c);
      if (fits(o)) out[f.id] = { ...(p ?? {}), component: o, source: "override" };
      else if (p && fits(p.component)) out[f.id] = p;
    }
    return out;
  }, [fields, res, overrides]);

  const names = fields.map((f) => f.name);
  const duplicate = (n: string) => names.filter((x) => x === n).length > 1;
  const valid = fields.length > 0 && new Set(names).size === names.length;

  const update = (id: string, patch: Partial<FieldSpec>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const move = (i: number, dir: -1 | 1) =>
    setFields((fs) => {
      const next = [...fs];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  const add = () => {
    const id = newFieldId();
    const n = fields.length + 1;
    setFields((fs) => [...fs, { id, name: `field_${n}`, label: `Field ${n}`, kind: "string", required: false }]);
    setOpenId(id);
  };
  const loadPreset = (name: string) => {
    setPreset(name);
    setPurpose(PRESETS[name].purpose);
    setFields(PRESETS[name].fields);
    setOverrides({});
    setOpenId(null);
  };

  const previewKey = fields.map((f) => `${JSON.stringify(f)}:${picks[f.id]?.component}`).join("|");
  const modelCount = Object.values(picks).filter((p) => p.source === "jev" || p.source === "laya").length;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <SparklesIcon className="size-5" />
          <h1 className="font-semibold">Jev Form Builder</h1>
          <span className="hidden text-sm text-muted-foreground sm:inline">shadcn · Zod · React Hook Form · Jev</span>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {loading && <Loader2Icon className="size-4 animate-spin" />}
            {res && !loading && (
              <span className="tabular-nums">
                {res.model ? `${res.model} · ` : ""}
                {res.latencyMs} ms
              </span>
            )}
            <BackendPicker value={backend} available={backends} onChange={setBackend} />
            <ModeBadge mode={serverMode} />
          </div>
        </div>
        {res?.error && (
          <div className="border-t bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            The model call failed, so rules were used instead: {res.error}
          </div>
        )}
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[400px_1fr]">
        {/* Left: the builder */}
        <section className="space-y-4">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-base">Form</CardTitle>
              <CardDescription>Describe it. Jev reads this for context.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 px-4">
              <div className="grid gap-1.5">
                <Label>Start from</Label>
                <Select value={preset} onValueChange={loadPreset}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(PRESETS).map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="purpose">Purpose</Label>
                <Textarea id="purpose" rows={2} className="min-h-14" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Fields ({fields.length})</h2>
            <Button size="sm" variant="outline" onClick={add}>
              <PlusIcon /> Add field
            </Button>
          </div>
          <div className="space-y-2">
            {fields.map((f, i) => (
              <FieldEditor
                key={f.id}
                field={f}
                pick={picks[f.id]}
                open={openId === f.id}
                duplicateName={duplicate(f.name)}
                onToggle={() => setOpenId(openId === f.id ? null : f.id)}
                onChange={(patch) => update(f.id, patch)}
                onMove={(dir) => move(i, dir)}
                onRemove={() => setFields((fs) => fs.filter((x) => x.id !== f.id))}
                isFirst={i === 0}
                isLast={i === fields.length - 1}
              />
            ))}
          </div>

          <Card className="gap-3 py-4">
            <CardContent className="grid gap-3 px-4">
              <div className="flex items-center justify-between">
                <Label>Confidence gate</Label>
                <span className="text-sm tabular-nums text-muted-foreground">{Math.round(threshold * 100)}%</span>
              </div>
              <Slider min={0} max={1} step={0.05} value={[threshold]} onValueChange={([v]) => setThreshold(v)} />
              <p className="text-xs text-muted-foreground">Below this, the builder ignores Jev and uses a rule-based default.</p>
            </CardContent>
          </Card>
        </section>

        {/* Right: preview, decisions, code */}
        <section>
          <Tabs defaultValue="preview">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="decisions">Decisions</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2">
                <Switch id="show-dec" checked={showDecisions} onCheckedChange={setShowDecisions} />
                <Label htmlFor="show-dec" className="text-sm font-normal">
                  Show Jev's picks
                </Label>
              </div>
            </div>

            <TabsContent value="preview">
              <Card>
                <CardContent>
                  {valid ? (
                    <FormPreview
                      key={previewKey}
                      purpose={purpose}
                      fields={fields}
                      picks={picks}
                      showDecisions={showDecisions}
                      onOverride={(id, c) =>
                        setOverrides((o) => {
                          const next = { ...o };
                          if (c) next[id] = c;
                          else delete next[id];
                          return next;
                        })
                      }
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">{fields.length ? "Two fields share a key. Rename one to see the preview." : "Add a field to start."}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="decisions">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">How each component was chosen</CardTitle>
                  <CardDescription>
                    Code keeps only the components that can hold the value type. The model picks among the rest, one isolated question per field, all in one
                    request. {modelCount > 0 && `${modelCount} of ${fields.length} picks came from the model.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {fields.map((f) => {
                    const p = picks[f.id];
                    const cands = candidatesFor(f.kind);
                    return (
                      <div key={f.id} className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{f.label}</span>
                          <span className="font-mono text-xs text-muted-foreground">{f.name}</span>
                          {p && <PickBadge pick={p} className="ml-auto" />}
                        </div>
                        <div className="grid gap-1">
                          {cands.map((c) => {
                            const prob = p?.probabilities?.[c.id];
                            const chosen = p?.component === c.id;
                            return (
                              <div key={c.id} className="grid grid-cols-[120px_1fr_44px] items-center gap-2 text-xs">
                                <span className={chosen ? "font-semibold" : "text-muted-foreground"}>{c.name}</span>
                                <div className="h-2 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={chosen ? "h-full bg-primary" : "h-full bg-muted-foreground/40"}
                                    style={{ width: `${prob != null ? prob * 100 : chosen ? 100 : 0}%` }}
                                  />
                                </div>
                                <span className="text-right tabular-nums text-muted-foreground">{prob != null ? `${Math.round(prob * 100)}%` : chosen ? "✓" : ""}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {res?.usage && (
                    <p className="border-t pt-3 text-xs text-muted-foreground">
                      Last call: {res.usage.input_tokens} input tokens, {res.usage.output_tokens} output tokens.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="code">
              <CodeTab purpose={purpose} fields={fields} picks={picks} />
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
}

function ModeBadge({ mode }: { mode: Backend | "offline" | null }) {
  if (mode === "jev") return <Badge className="bg-emerald-600 text-white">Jev live</Badge>;
  if (mode === "laya") return <Badge className="bg-sky-600 text-white">Laya local</Badge>;
  if (mode === "rules")
    return (
      <Badge variant="outline" title="No model available: set TYPESAFE_API_KEY in .env, or start Laya, and reload">
        Rules only
      </Badge>
    );
  if (mode === "offline") return <Badge variant="destructive">Server offline</Badge>;
  return null;
}

