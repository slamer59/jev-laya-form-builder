import { existsSync } from "node:fs";

// Load .env if present (Node 20.12+ has this built in).
if (existsSync(".env")) process.loadEnvFile(".env");

// Dynamic imports: `.env` must be loaded above before a module reads its keys from process.env.
const { Hono } = await import("hono");
const { serve } = await import("@hono/node-server");
const { serveStatic } = await import("@hono/node-server/serve-static");
const { pickComponents } = await import("./pick");
const { availability, bestOf, LAYA_URL } = await import("./backends");
const { CATALOG } = await import("../shared/catalog");
import type { PickRequest } from "../shared/types";

const app = new Hono();

app.get("/api/status", async (c) => {
  const backends = await availability();
  return c.json({ mode: bestOf(backends), backends, catalog: CATALOG.length, layaUrl: LAYA_URL });
});

app.post("/api/pick", async (c) => {
  const body = (await c.req.json()) as PickRequest;
  if (!Array.isArray(body?.fields)) return c.json({ error: "fields must be an array" }, 400);
  return c.json(await pickComponents(body));
});

// In production, serve the built Vite app from the same server.
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, async () => {
  const a = await availability();
  const up = (["jev", "laya", "rules"] as const).filter((b) => a[b]);
  console.log(`API on http://localhost:${port} — ${up.join(" + ")} available, default ${bestOf(a)}${a.laya ? "" : ` (no Laya on ${LAYA_URL})`}`);
});
