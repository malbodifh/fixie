// Protección contra bots del hosting y concurrencia limitada de los análisis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchApp, HostBlockedError, mapLimit } from "./common";

function mockFetch(status: number, headers: Record<string, string> = {}) {
  globalThis.fetch = (async () => new Response("", { status, headers })) as typeof fetch;
}

test("un desafío de Vercel o Cloudflare es un bloqueo, no un fallo de la app", async () => {
  mockFetch(403, { "x-vercel-mitigated": "challenge" });
  await assert.rejects(fetchApp("https://app.example.com/"), HostBlockedError);
  mockFetch(403, { "cf-mitigated": "challenge" });
  await assert.rejects(fetchApp("https://app.example.com/"), HostBlockedError);
  mockFetch(429);
  await assert.rejects(fetchApp("https://app.example.com/"), HostBlockedError);
});

test("un 403 o 500 propio de la app sí llega al análisis", async () => {
  mockFetch(403);
  assert.equal((await fetchApp("https://app.example.com/")).status, 403);
  mockFetch(500);
  assert.equal((await fetchApp("https://app.example.com/")).status, 500);
});

test("mapLimit respeta el orden y el límite", async () => {
  let enCurso = 0;
  let maximo = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
    enCurso++;
    maximo = Math.max(maximo, enCurso);
    await new Promise((r) => setTimeout(r, n * 3));
    enCurso--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.equal(maximo, 2);
});
