import * as React from "react";
import { useForm, type FieldValues, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { buildSchema, defaultValueFor } from "@shared/schema";
import { candidatesFor } from "@shared/catalog";
import type { FieldSpec, Pick } from "@shared/types";
import { INLINE_LABEL, RENDERERS } from "@/catalog-render";
import { Button } from "@/components/ui/button";
import { Form, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PickBadge } from "@/components/PickBadge";

type Props = {
  purpose: string;
  fields: FieldSpec[];
  picks: Record<string, Pick>;
  showDecisions: boolean;
  onOverride: (fieldId: string, component: string | null) => void;
};

export function FormPreview({ purpose, fields, picks, showDecisions, onOverride }: Props) {
  const schema = React.useMemo(() => buildSchema(fields), [fields]);
  const form = useForm<FieldValues>({
    resolver: zodResolver(schema) as Resolver<FieldValues>,
    defaultValues: Object.fromEntries(fields.map((f) => [f.name, defaultValueFor(f, picks[f.id]?.component ?? "")])),
    mode: "onTouched",
  });
  const [submitted, setSubmitted] = React.useState<FieldValues | null>(null);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => setSubmitted(v))} className="space-y-6" noValidate>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{purpose || "Untitled form"}</h2>
          <p className="text-sm text-muted-foreground">Validated by the generated Zod schema. Components chosen by Jev.</p>
        </div>

        {fields.map((spec) => {
          const pick = picks[spec.id];
          const component = pick?.component && RENDERERS[pick.component] ? pick.component : null;
          return (
            <div key={spec.id} className="space-y-2">
              {showDecisions && pick && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={pick.component}
                    onValueChange={(v) => onOverride(spec.id, v === "__auto" ? null : v)}
                  >
                    <SelectTrigger size="sm" className="h-7 w-auto gap-1 border-dashed px-2 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pick.source === "override" && <SelectItem value="__auto">↺ Let Jev decide</SelectItem>}
                      {candidatesFor(spec.kind).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {pick.probabilities?.[c.id] != null && (
                            <span className="ml-2 text-muted-foreground tabular-nums">{Math.round(pick.probabilities[c.id] * 100)}%</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <PickBadge pick={pick} />
                </div>
              )}
              {component ? (
                <FormField
                  control={form.control}
                  name={spec.name}
                  render={({ field }) => {
                    const control = RENDERERS[component]({ field, spec, sensitive: (pick.sensitive ?? 0) >= 0.5 });
                    return INLINE_LABEL.has(component) ? (
                      <FormItem className="flex flex-row items-start gap-3 rounded-lg border p-3">
                        <div className="pt-0.5">{control}</div>
                        <div className="grid gap-1.5">
                          <FormLabel className="leading-snug">
                            {spec.label}
                            {spec.required && <span className="text-destructive">*</span>}
                          </FormLabel>
                          {spec.description && <FormDescription>{spec.description}</FormDescription>}
                          <FormMessage />
                        </div>
                      </FormItem>
                    ) : (
                      <FormItem>
                        <FormLabel>
                          {spec.label}
                          {spec.required && <span className="text-destructive">*</span>}
                        </FormLabel>
                        {control}
                        {spec.description && <FormDescription>{spec.description}</FormDescription>}
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              ) : (
                <div className="h-16 animate-pulse rounded-md bg-muted" aria-label={`Waiting for a component for ${spec.label}`} />
              )}
            </div>
          );
        })}

        <div className="flex gap-2">
          <Button type="submit">Submit</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              form.reset();
              setSubmitted(null);
            }}
          >
            Reset
          </Button>
        </div>

        {submitted && (
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="mb-2 text-sm font-medium">Valid! Submitted data:</p>
            <pre className="overflow-x-auto text-xs">{JSON.stringify(submitted, null, 2)}</pre>
          </div>
        )}
      </form>
    </Form>
  );
}

