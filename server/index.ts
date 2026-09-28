import { existsSync } from "node:fs";

// Load .env if present (Node 20.12+ has this built in).
if (existsSync(".env")) process.loadEnvFile(".env");

const { Hono } = await import("hono");
const { serve } = await import("@hono/node-server");
const { serveStatic } = await import("@hono/node-server/serve-static");
const { pickComponents, jevEnabled } = await import("./pick");
const { CATALOG } = await import("../shared/catalog");
type PickRequest = import("../shared/types").PickRequest;

const app = new Hono();

app.get("/api/status", (c) => c.json({ mode: jevEnabled ? "jev" : "rules", catalog: CATALOG.length }));

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
serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port} — ${jevEnabled ? "Jev is live" : "no TYPESAFE_API_KEY, using rules fallback"}`);
});
