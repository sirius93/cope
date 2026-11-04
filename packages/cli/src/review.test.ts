import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReviewServer, studioOptionsFromEnv } from "./commands/review.js";

test("review server lists runs, saves edits with re-validation, and guards file access", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cope-review-test-"));
  const runDir = join(cwd, "out", "my-run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "brief.json"), JSON.stringify({ coreClaim: "Claim" }));
  writeFileSync(join(runDir, "x_post.txt"), "hello");
  writeFileSync(join(runDir, "run-summary.json"), JSON.stringify({
    text: [{ formatId: "x_post", valid: true, violations: [], repairPasses: 0 }], images: [],
  }));
  const server = createReviewServer(cwd).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();
  const put = (content: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/runs/my-run/text/x_post`, { method: "PUT", headers, body: JSON.stringify({ content }) });
  try {
    assert.equal((await json(fetch(`${base}/api/runs`)))[0].title, "Claim");
    assert.equal((await json(fetch(`${base}/api/runs/my-run`))).texts[0].content, "hello");

    // Too long: moves to invalid/ and the summary records it.
    assert.equal((await json(put("x".repeat(300)))).valid, false);
    assert.ok(existsSync(join(runDir, "invalid", "x_post.txt")) && !existsSync(join(runDir, "x_post.txt")));
    assert.equal(JSON.parse(readFileSync(join(runDir, "run-summary.json"), "utf-8")).text[0].valid, false);

    // Fixed: moves back.
    assert.equal((await json(put("short again"))).valid, true);
    assert.equal(readFileSync(join(runDir, "x_post.txt"), "utf-8"), "short again");
    assert.ok(!existsSync(join(runDir, "invalid", "x_post.txt")));

    assert.equal((await put("evil", { origin: "https://evil.example" })).status, 403);
    assert.equal((await fetch(`${base}/files/my-run/..%2Fmy-run%2Fbrief.json`)).status, 404);
    assert.equal((await fetch(`${base}/files/nope/x.png`)).status, 404);
  } finally {
    server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("web flow drafts text first, keeps the brief editable, and generates images only on approval", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "cope-studio-test-"));
  const envKey = "COPE_STUDIO_TEST_KEY";
  const previousKey = process.env[envKey];
  process.env[envKey] = "test";
  writeFileSync(join(cwd, "cope.config.yaml"), [
    "providers:",
    "  test: { kind: text+image, protocol: openai-compatible, baseUrl: https://example.invalid/v1, apiKeyEnv: " + envKey + ", textModel: test }",
    "routing: { brief: test, shortform: test, midform: test, image_prompt: test }",
  ].join("\n"));
  const brief = { coreClaim: "One idea, every format", keyPoints: ["Alpha point", "Beta point", "Gamma point"], audience: "Developers",
    tone: "Direct", cta: null, quotableLines: [], immutableFacts: [], visualConcepts: [] };
  const hooks = ["I shipped it in a week.", "Most advice here is wrong.", "Three formats, one source.", "I almost gave up.", "Why rewrite twice?"];
  const slides = [1, 2, 3].map((i) => ({ headline: `Clear Summary For Slide Number ${i}`, subhead: `Detail for slide ${i}.`, imagePrompt: "bg" }));
  const prompts: string[] = [];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("http://127.0.0.1")) return realFetch(input, init);
    const prompt = JSON.parse(String(init?.body)).messages[0].content as string;
    prompts.push(prompt);
    const content = prompt.includes("brief-writer") ? JSON.stringify(brief)
      : prompt.includes("opening hooks") ? JSON.stringify(hooks)
      : prompt.includes("carousel") ? JSON.stringify(slides)
      : "A valid short post.";
    return Response.json({ choices: [{ message: { content } }] });
  });

  const server = createReviewServer(cwd).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> => {
    const res = await realFetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const finish = async (job: string) => {
    for (;;) {
      const { data } = await call(`/api/jobs/${job}`);
      if (data.status !== "running") return data;
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  try {
    const started = await call("/api/runs", "POST", { source: "My rough notes", formats: ["x_post", "linkedin_hooks", "carousel"] });
    assert.equal(started.status, 202);
    const drafted = await finish(started.data.job);
    assert.equal(drafted.status, "done", drafted.error);
    const runPath = `/api/runs/${drafted.slug}`;
    let run = (await call(runPath)).data;
    assert.deepEqual(run.pendingImages.formats, ["carousel"]);
    assert.equal(run.images.length, 0);
    assert.ok(!prompts.some((p) => p.includes("carousel")), "no image work before approval");
    assert.deepEqual(run.texts.find((x: { formatId: string }) => x.formatId === "linkedin_hooks").content, hooks);
    assert.equal(readFileSync(join(cwd, "out", drafted.slug, "source.txt"), "utf-8"), "My rough notes");

    assert.equal((await call(`${runPath}/brief`, "PUT", { brief: { ...brief, coreClaim: "" } })).status, 400);
    assert.equal((await call(`${runPath}/brief`, "PUT", { brief: { ...brief, keyPoints: ["Edited point", "Beta point", "Gamma point"] } })).status, 200);

    const approved = await finish((await call(`${runPath}/approve`, "POST", {})).data.job);
    assert.equal(approved.status, "done", approved.error);
    run = (await call(runPath)).data;
    assert.equal(run.pendingImages.planned, true);
    assert.equal(run.images.length, 0, "approving writes the plan, it does not render");
    assert.ok(prompts.at(-1)!.includes("Edited point"), "slides are written from the edited brief");
    const planFile = join(cwd, "out", drafted.slug, "images", "carousel.plan.json");
    assert.deepEqual(JSON.parse(readFileSync(planFile, "utf-8")).slides.map((x: { headline: string }) => x.headline), slides.map((x) => x.headline));
    assert.equal((await call(`${runPath}/approve`, "POST", {})).status, 409);
    assert.equal((await call(`${runPath}/brief`, "PUT", { brief })).status, 409, "brief is frozen once slides exist");

    // Edits are checked like model output before they are saved.
    const edited = structuredClone(slides);
    edited[0].headline = "Too short";
    assert.match((await call(`${runPath}/plan/carousel`, "PUT", { slides: edited })).data.error, /5-6 word/);
    edited[0].headline = "My Own Edited Title For Slide";
    assert.match((await call(`${runPath}/plan/carousel`, "PUT", { slides: [{ ...edited[0], code: "rm -rf /" }, ...edited.slice(1)] })).data.error, /copied exactly/);
    assert.equal((await call(`${runPath}/plan/carousel`, "PUT", { slides: edited.slice(0, 2) })).status, 400, "carousel needs at least 3 slides");

    const preview = await realFetch(`${base}${runPath}/preview/carousel`, { method: "POST", body: JSON.stringify({ slides: edited, index: 0 }) });
    assert.equal(preview.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await preview.arrayBuffer()).readUInt32BE(16), 540, "half-size PNG (width from the IHDR header)");
    assert.equal((await call(`${runPath}/preview/carousel`, "POST", { slides: [{ headline: "x".repeat(5000), subhead: "y" }], index: 0 })).status, 400);

    assert.equal((await call(`${runPath}/plan/carousel`, "PUT", { slides: edited })).status, 200);
    const callsBeforeRender = prompts.length;
    const rendered = await finish((await call(`${runPath}/render`, "POST", {})).data.job);
    assert.equal(rendered.status, "done", rendered.error);
    run = (await call(runPath)).data;
    assert.equal(run.pendingImages, undefined);
    assert.equal(run.images[0].images.length, 3);
    assert.equal(prompts.length, callsBeforeRender, "card rendering follows the plan with no model calls");
    const slideMeta = JSON.parse(readFileSync(join(cwd, "out", drafted.slug, "images", "carousel-1.json"), "utf-8"));
    assert.equal(slideMeta.concept.headline, "My Own Edited Title For Slide");
    assert.equal((await call(`${runPath}/render`, "POST", {})).status, 409);
    assert.equal((await call(`${runPath}/plan/carousel`, "PUT", { slides: edited })).status, 409);
    assert.equal((await call("/api/runs", "POST", { source: "x", formats: ["../bad"] })).status, 500);
  } finally {
    server.close();
    if (previousKey === undefined) delete process.env[envKey]; else process.env[envKey] = previousKey;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("studio login is checked server-side, locks out guessing, and allows only the configured public host", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cope-auth-test-"));
  const opts = studioOptionsFromEnv({ COPE_STUDIO_USER: "me", COPE_STUDIO_PASSWORD: "correct horse battery", COPE_PUBLIC_HOST: "https://Cope.Example.com/" });
  assert.equal(opts.publicHost, "cope.example.com");
  const server = createReviewServer(cwd, opts).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const basic = (user: string, pass: string) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  const get = (headers: Record<string, string>, ip = "203.0.113.1") =>
    fetch(`http://127.0.0.1:${port}/api/runs`, { headers: { "cf-connecting-ip": ip, ...headers } });
  try {
    const anonymous = await get({});
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get("www-authenticate")!, /^Basic /);
    assert.equal((await get({ authorization: basic("me", "correct horse battery") })).status, 200);
    for (let i = 0; i < 10; i++) assert.equal((await get({ authorization: basic("me", `guess${i}`) })).status, 401);
    assert.equal((await get({ authorization: basic("me", "correct horse battery") })).status, 429, "locked out after 10 failures");
    assert.equal((await get({ authorization: basic("me", "correct horse battery") }, "198.51.100.7")).status, 200, "other clients unaffected");

    // Through the tunnel: the public Host is accepted, an https Origin may write, other hosts may not.
    const viaTunnel = (host: string, origin?: string) => new Promise<number>((resolve, reject) => {
      const req = request({ port, host: "127.0.0.1", path: "/api/runs", method: "POST", headers: {
        host, ...(origin ? { origin } : {}), authorization: basic("me", "correct horse battery"), "cf-connecting-ip": "192.0.2.9" } },
        (res) => { res.resume(); resolve(res.statusCode!); });
      req.on("error", reject);
      req.end(JSON.stringify({ source: "", formats: [] }));
    });
    assert.equal(await viaTunnel("cope.example.com", "https://cope.example.com"), 400, "reaches the handler (empty source)");
    assert.equal(await viaTunnel("evil.example.com"), 403);
    assert.equal(await viaTunnel("cope.example.com", "https://evil.example.com"), 403);
  } finally {
    server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("studio refuses to go public without a strong login", () => {
  assert.throws(() => studioOptionsFromEnv({ COPE_PUBLIC_HOST: "cope.example.com" }), /COPE_STUDIO_USER/);
  assert.throws(() => studioOptionsFromEnv({ COPE_STUDIO_USER: "me", COPE_STUDIO_PASSWORD: "short", COPE_PUBLIC_HOST: "cope.example.com" }), /12 characters/);
  assert.throws(() => studioOptionsFromEnv({ COPE_STUDIO_USER: "me" }), /both/);
  assert.throws(() => studioOptionsFromEnv({}, true), /COPE_PUBLIC_HOST/);
  assert.deepEqual(studioOptionsFromEnv({}), { auth: undefined, publicHost: undefined });
});
