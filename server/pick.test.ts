import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { PRESETS } from "../src/presets";
import { groupSections } from "../shared/layout";
import type { FieldSpec, Pick } from "../shared/types";
import type { clearPickCache, pickComponents } from "./pick";

/** The module surface this test needs, typed only, so `LAYA_URL` can be set before the real import. */
type PickModule = { pickComponents: typeof pickComponents; clearPickCache: typeof clearPickCache };

/**
 * Layout checks for the pick cache. A layout depends on where a field sits — the
 * first field always opens a section, and the break question is asked about the
 * neighbours — so reordering a form must re-derive it instead of serving the
 * layout computed for the old position. Run with `bun run test:pick`.
 */

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

/** Question ids of every model request, in order. */
const askedQuestions: string[] = [];

/**
 * A stand-in for Laya, so the cache can be exercised without a model: it answers
 * every choice with its first label at 0.9 (so widths come out "full" and headings
 * "Identity"), and every section-break question with a confident "no".
 */
function stubAnswer(questions: Record<string, { criteria?: Record<string, unknown> }>) {
  const answers: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(questions)) {
    const labels = Object.keys(q.criteria ?? {});
    if (name.startsWith("n_")) answers[name] = { type: "noul", noul: 0.1 };
    else if (name.startsWith("s_")) answers[name] = { type: "noul", noul: 0.9 };
    else
      answers[name] = {
        type: "choice",
        choice: labels[0],
        confidence: 0.9,
        answer_confidence: 0.9,
        probabilities: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.9 : 0.1 / (labels.length - 1)])),
      };
  }
  return answers;
}

function handle(req: IncomingMessage, res: ServerResponse) {
  const json = (body: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.url === "/health") return json({ status: "ok" });
  if (req.method !== "POST" || req.url !== "/v1/systemone") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const { questions } = JSON.parse(body) as { questions: Record<string, { criteria?: Record<string, unknown> }> };
    askedQuestions.push(...Object.keys(questions));
    json({ model: "stub-model", usage: { input_tokens: 10, output_tokens: 10 }, answers: stubAnswer(questions) });
  });
}

const stubServers: Server[] = [];

/**
 * `server/backends.ts` reads `LAYA_URL` when it loads, so the stub has to be
 * listening and the env set before `server/pick.ts` is imported.
 */
let pickModule: Promise<PickModule> | null = null;
async function loadPick() {
  if (!pickModule) {
    const stub = createServer(handle);
    stubServers.push(stub);
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    process.env.LAYA_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    pickModule = import("./pick");
  }
  return pickModule;
}

const field = (name: string, label: string, kind: FieldSpec["kind"] = "string"): FieldSpec => ({ id: name, name, label, kind, required: true });

/** The layouts the client would group into sections, in the order the fields sit now. */
function layoutsOf(fields: FieldSpec[], picks: Record<string, Pick>) {
  return fields.map((f) => {
    const layout = picks[f.id]?.layout;
    if (!layout) throw new Error(`${f.label} has no layout`);
    return layout;
  });
}

/** The client groups fields by these two flags, so a heading belongs to a section start and nowhere else. */
function checkSectionsAreWellFormed(fields: FieldSpec[], picks: Record<string, Pick>) {
  fields.forEach((f, i) => {
    const layout = picks[f.id]?.layout;
    if (!layout) throw new Error(`${f.label} has no layout`);
    if (!layout.startsSection) assert.equal(layout.sectionTitle, undefined, `${f.label} continues a section at ${i} but has a heading`);
    else assert.equal(typeof layout.sectionTitle, "string", `${f.label} opens a section at ${i} without a heading`);
  });
}

/* -------------------------------------------------------------------- cache */

test("cache: a reorder re-derives the section break instead of reusing the old position", async () => {
  const { pickComponents, clearPickCache } = await loadPick();
  clearPickCache();
  const purpose = "Stub form";
  const first = field("first_name", "First name");
  const last = field("last_name", "Last name");

  const before = await pickComponents({ purpose, fields: [first, last], backend: "laya", threshold: 0.5 });
  assert.equal(before.asked > 0, true, "the first call must ask the model");
  assert.equal(before.picks.first_name.layout?.startsSection, true, "the first field opens a section");
  assert.equal(before.picks.last_name.layout?.startsSection, false, "the stub answers no, and the rules agree here");

  askedQuestions.length = 0;
  const after = await pickComponents({ purpose, fields: [last, first], backend: "laya", threshold: 0.5 });
  assert.equal(after.asked, 0, "moving fields must not re-ask the model");
  assert.equal(after.cached, 2, "both picks come from the cache");
  assert.equal(after.picks.last_name.component, before.picks.last_name.component, "component answers are reused");
  assert.equal(after.picks.last_name.layout?.width, "full", "the width answer is kept: it does not depend on position");
  assert.equal(after.picks.last_name.layout?.startsSection, true, "the field moved to the front must open a section");
  assert.equal(after.picks.first_name.layout?.startsSection, false, "the field moved out of front follows its new neighbours");
  assert.equal(after.picks.first_name.layout?.sectionTitle, undefined, "no heading is left over from being first");
  checkSectionsAreWellFormed([last, first], after.picks);
});

test("cache: a reorder drops answers that were given for other neighbours", async () => {
  const { pickComponents, clearPickCache } = await loadPick();
  clearPickCache();
  const purpose = "Stub form 2";
  const person = field("full_name", "Full name");
  const role = field("role", "Role", "enum");
  const notes = field("notes", "Notes");
  const order = [person, role, notes];

  // Identity → Details: the rules predict a section at `role`, so it gets a heading question too.
  const before = await pickComponents({ purpose, fields: order, backend: "laya", threshold: 0.5 });
  assert.equal(askedQuestions.includes("t_role"), true, "role is predicted to open a section, so it is asked for a heading");
  assert.equal(askedQuestions.includes("t_notes"), false, "notes is predicted to continue a section, so it is not");
  assert.equal(before.picks.role.layout?.startsSection, false, "the stub answers no to every break question");

  // Asking again about the same order is a pure cache hit, and reuses the heading answers.
  const again = await pickComponents({ purpose, fields: order, backend: "laya", threshold: 0.5 });
  assert.equal(again.asked, 0);
  assert.equal(again.picks.full_name.layout?.sectionTitle, "Identity", "heading reused while the neighbours are unchanged");

  askedQuestions.length = 0;
  const reordered = [role, person, notes];
  const after = await pickComponents({ purpose, fields: reordered, backend: "laya", threshold: 0.5 });
  assert.equal(after.asked, 0, "the reorder is served from the cache");
  const layouts = layoutsOf(reordered, after.picks);
  assert.deepEqual(
    layouts.map((l) => [l.startsSection, l.sectionTitle]),
    [
      [true, "Details"], // first field: always a section; the break answer was given for another neighbour
      [false, undefined], // island between two Details fields: continues, no stale heading
      [true, "Details"], // the rules open a section and name it
    ],
  );
  checkSectionsAreWellFormed(reordered, after.picks);
});

/* -------------------------------------------------------------------- rules

   The rules backend has no cache, but it is what the layout always ends up on,
   so reordering a preset must still lay it out for the new order. */

test("rules: reordering a preset re-lays it out for the new order", async () => {
  const { pickComponents } = await loadPick();
  const order = PRESETS["Job application"].fields;
  const reversed = [...order].reverse();
  const forward = await pickComponents({ purpose: "purpose", fields: order, backend: "rules" });
  const flipped = await pickComponents({ purpose: "purpose", fields: reversed, backend: "rules" });

  for (const [fields, picks] of [
    [order, forward.picks],
    [reversed, flipped.picks],
  ] as const) {
    assert.equal(picks[fields[0].id].layout?.startsSection, true, "the first field of any order opens a section");
    checkSectionsAreWellFormed(fields, picks);
    // What the preview will group: every field lands in exactly one section, titled by the field that opens it.
    const grouped = groupSections(fields, layoutsOf(fields, picks));
    assert.deepEqual(grouped.flatMap((s) => s.fields), fields);
    for (const s of grouped) assert.equal(s.title, picks[s.fields[0].id].layout?.sectionTitle);
  }

  // Width is a property of the field, not of its position.
  for (const f of order) assert.equal(flipped.picks[f.id].layout?.width, forward.picks[f.id].layout?.width, f.label);

  // Reversing back reproduces the first layout exactly.
  const back = await pickComponents({ purpose: "purpose", fields: order, backend: "rules" });
  assert.deepEqual(back.picks, forward.picks);
});

/* ------------------------------------------------------------------- runner */

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`ok   ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${t.name}\n${(e as Error).message.split("\n").slice(0, 12).join("\n")}`);
  }
}
for (const server of stubServers) server.close();
console.log(`\n${tests.length - failed}/${tests.length} checks passed`);
if (failed) process.exit(1);
