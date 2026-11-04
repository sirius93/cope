import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { IMAGE_STYLES, checkConcepts, draftRun, extractCodeBlocks, ingest, loadConfig, loadEnvFile, loadPersona, parseBriefJson, parseImageStyle, planImages, planPath, preflight, previewSlide, renderPlans, type CopeConfig, type ImageAdaptResult, type ImagePlan } from "@cope/core";
import { isImageFormat, listFormatIds, listImageFormatIds, loadFormat, loadImageFormat, validate } from "@cope/formats";
import { writeResults } from "../output.js";

const PAGE = join(dirname(fileURLToPath(import.meta.url)), "../review.html");
const MIME: Record<string, string> = { ".png": "image/png", ".pdf": "application/pdf", ".jpg": "image/jpeg" };

interface Summary {
  text: { formatId: string; valid: boolean; violations: string[]; repairPasses: number }[];
  images: { formatId: string; images: { file: string; altText: string }[]; pdfFile?: string; error?: string }[];
  // Set by runs started from the web page: image formats waiting for approval. Once
  // `planned`, each has an editable images/<format>.plan.json that rendering follows.
  pendingImages?: { formats: string[]; mode: "cards" | "generated"; style: string; planned?: boolean };
}

interface Job { status: "running" | "done" | "failed"; slug?: string; error?: string }

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf-8")) as T; } catch { return fallback; }
}

// Same naming as extensionFor in ../output.ts.
const extFor = (formatId: string) =>
  formatId === "blog_md" ? ".md" : loadFormat(formatId).outputSchema === "string[]" ? ".json" : ".txt";

function textFile(runDir: string, formatId: string): string | undefined {
  const ext = extFor(formatId);
  for (const dir of [runDir, join(runDir, "invalid")]) {
    const file = join(dir, formatId + ext);
    if (existsSync(file)) return file;
  }
}

function listRuns(outDir: string) {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(outDir, d.name, "run-summary.json")))
    .map((d) => ({
      slug: d.name,
      title: readJson<{ coreClaim?: string }>(join(outDir, d.name, "brief.json"), {}).coreClaim ?? d.name,
      mtime: statSync(join(outDir, d.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

function loadRun(runDir: string) {
  const summary = readJson<Summary>(join(runDir, "run-summary.json"), { text: [], images: [] });
  const texts = summary.text.flatMap(({ formatId, valid, violations }) => {
    const file = listFormatIds().includes(formatId) ? textFile(runDir, formatId) : undefined;
    if (!file) return [];
    const raw = readFileSync(file, "utf-8");
    const spec = loadFormat(formatId);
    return [{
      formatId, valid, violations, platform: spec.platform, limits: spec.limits,
      content: spec.outputSchema === "string[]" ? JSON.parse(raw) as string[] : raw,
    }];
  });
  // Summaries store absolute paths; serve by basename so runs survive being moved.
  const images = summary.images.map(({ formatId, images, pdfFile, error }) => ({
    formatId, error,
    images: images.map(({ file, altText }) => ({ src: `images/${basename(file)}`, altText })),
    pdf: pdfFile ? `images/${basename(pdfFile)}` : undefined,
  }));
  const pending = summary.pendingImages;
  const plans = pending?.planned
    ? pending.formats.map((formatId) => readJson<ImagePlan | null>(planPath(join(runDir, "images"), formatId), null)).filter(Boolean)
    : [];
  return { brief: readJson(join(runDir, "brief.json"), null), texts, images, pendingImages: pending, plans };
}

// Re-validates an edit with the same code validator as `cope run`, moves the file between
// the run dir and invalid/ to match, and keeps run-summary.json in step.
export function saveText(runDir: string, formatId: string, content: string | string[]) {
  const spec = loadFormat(formatId);
  const result = validate(spec, content);
  const existing = textFile(runDir, formatId);
  if (existing) rmSync(existing);
  const target = result.valid ? runDir : join(runDir, "invalid");
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, formatId + extFor(formatId)),
    Array.isArray(content) ? JSON.stringify(content, null, 2) : content,
  );
  const summaryFile = join(runDir, "run-summary.json");
  const summary = readJson<Summary>(summaryFile, { text: [], images: [] });
  const entry = summary.text.find((t) => t.formatId === formatId);
  if (entry) Object.assign(entry, result);
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  return result;
}

const toSummaryImages = (results: ImageAdaptResult[]): Summary["images"] =>
  results.map(({ formatId, images, pdfFile, error }) => ({
    formatId,
    images: images.map(({ file, altText }) => ({ file, altText })),
    ...(pdfFile ? { pdfFile } : {}),
    ...(error ? { error } : {}),
  }));

const MAX_BODY = 1024 * 1024;

function withImageSettings(config: CopeConfig, mode?: string, style?: string): CopeConfig {
  if (mode !== undefined) {
    if (mode !== "cards" && mode !== "generated") throw new Error("imageMode must be cards or generated");
    config.images.mode = mode;
  }
  if (style !== undefined) config.images.style = parseImageStyle(style);
  return config;
}

export interface StudioOptions {
  auth?: { user: string; password: string };
  publicHost?: string; // custom domain served through the Cloudflare tunnel
}

// Reads COPE_STUDIO_USER / COPE_STUDIO_PASSWORD / COPE_PUBLIC_HOST. Fails closed: the
// studio spends model calls, so it never goes public without a login.
export function studioOptionsFromEnv(env: NodeJS.ProcessEnv = process.env, tunnel = false): StudioOptions {
  const user = env.COPE_STUDIO_USER?.trim() ?? "";
  const password = env.COPE_STUDIO_PASSWORD ?? "";
  const publicHost = env.COPE_PUBLIC_HOST?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") || undefined;
  if (!user !== !password) throw new Error("Set both COPE_STUDIO_USER and COPE_STUDIO_PASSWORD in .env, or neither.");
  if (tunnel && !publicHost) throw new Error("--tunnel needs COPE_PUBLIC_HOST in .env (the custom domain, e.g. cope.example.com).");
  if (publicHost && !user) throw new Error("COPE_PUBLIC_HOST is set: add COPE_STUDIO_USER and COPE_STUDIO_PASSWORD to .env before exposing the studio.");
  if (publicHost && password.length < 12) throw new Error("COPE_STUDIO_PASSWORD must be at least 12 characters when the studio is public.");
  return { auth: user ? { user, password } : undefined, publicHost };
}

const sha256 = (text: string) => createHash("sha256").update(text).digest();
const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60_000;

export function createReviewServer(cwd: string, opts: StudioOptions = {}): Server {
  const expected = opts.auth && sha256(`${opts.auth.user}:${opts.auth.password}`);
  // ponytail: in-memory per-IP lockout, reset on restart. Cloudflare sets CF-Connecting-IP
  // to the real client; local requests fall back to the socket address.
  const failures = new Map<string, { count: number; since: number }>();
  const outDir = resolve(cwd, "out");
  const runDirFor = (slug: string) =>
    listRuns(outDir).some((r) => r.slug === slug) ? join(outDir, slug) : undefined;
  // ponytail: in-memory jobs, lost on restart (the run folder survives; re-approve). Add
  // persistence if runs ever need to outlive the server process.
  const jobs = new Map<string, Job>();
  const busy = new Set<string>(); // slugs with image generation in flight
  const startJob = (work: (job: Job) => Promise<void>) => {
    const id = randomUUID();
    const job: Job = { status: "running" };
    jobs.set(id, job);
    work(job).then(() => { job.status = "done"; }, (err) => {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
    });
    return { job: id };
  };

  return createServer(async (req, res) => {
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(type === "application/json" ? JSON.stringify(body) : body as string | Buffer);
    };
    const readBody = async <T>() => {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY) throw new Error("Request body too large");
      }
      return JSON.parse(body) as T;
    };
    try {
      // This server spends model calls, so refuse other hosts (DNS rebinding) and, for
      // writes, other origins: any page in the browser can fire requests at localhost.
      const host = (req.headers.host ?? "").toLowerCase();
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && host !== opts.publicHost) return send(403, { error: "Forbidden" });
      if (req.method !== "GET" && req.headers.origin && ![`http://${host}`, `https://${host}`].includes(req.headers.origin)) return send(403, { error: "Forbidden" });

      // Credentials are checked here, on the server, for every request (HTTP Basic over
      // the tunnel's HTTPS). The browser shows its own login prompt.
      if (expected) {
        const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress);
        const record = failures.get(ip);
        if (record && Date.now() - record.since > LOCKOUT_MS) failures.delete(ip);
        if ((failures.get(ip)?.count ?? 0) >= MAX_FAILURES) return send(429, { error: "Too many failed logins. Try again later." });
        const header = req.headers.authorization ?? "";
        const given = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString("utf-8") : undefined;
        if (given === undefined || !timingSafeEqual(sha256(given), expected)) {
          if (given !== undefined) failures.set(ip, { count: (failures.get(ip)?.count ?? 0) + 1, since: failures.get(ip)?.since ?? Date.now() });
          res.writeHead(401, { "www-authenticate": 'Basic realm="COPE studio", charset="UTF-8"', "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "Login required" }));
        }
        failures.delete(ip);
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

      if (req.method === "GET" && parts.length === 0) return send(200, readFileSync(PAGE, "utf-8"), "text/html; charset=utf-8");
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "runs" && parts.length === 2) return send(200, listRuns(outDir));
      if (req.method === "GET" && url.pathname === "/api/options") {
        const config = loadConfig(cwd);
        return send(200, { text: listFormatIds(), image: listImageFormatIds(), styles: Object.keys(IMAGE_STYLES), mode: config.images.mode, style: config.images.style });
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "jobs" && jobs.has(parts[2])) return send(200, jobs.get(parts[2]));

      // Phase one from the web page: brief + text now, image formats parked until approval.
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "runs" && parts.length === 2) {
        const body = await readBody<{ source?: string; formats?: string[]; imageMode?: string; imageStyle?: string }>();
        const input = body.source?.trim();
        if (!input) return send(400, { error: "Paste some text or a URL." });
        const formats = [...new Set(body.formats ?? [])];
        if (!formats.length) return send(400, { error: "Pick at least one format." });
        const config = withImageSettings(loadConfig(cwd), body.imageMode, body.imageStyle);
        preflight(formats, config);
        const images = formats.filter(isImageFormat);
        return send(202, startJob(async (job) => {
          // Only text or http(s) URLs: a web form must not read arbitrary local files.
          const source = /^https?:\/\/\S+$/i.test(input) ? (await ingest(input)).text : input;
          const draft = await draftRun(source, formats.filter((id) => !isImageFormat(id)), config, cwd);
          const dir = join(outDir, draft.slug);
          writeResults(dir, draft.results, []);
          if (images.length) {
            const summaryFile = join(dir, "run-summary.json");
            const summary = readJson<Summary>(summaryFile, { text: [], images: [] });
            summary.pendingImages = { formats: images, mode: config.images.mode, style: config.images.style };
            writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
          }
          job.slug = draft.slug;
        }));
      }

      const runDir = parts[0] === "api" && parts[1] === "runs" ? runDirFor(parts[2]) : parts[0] === "files" ? runDirFor(parts[1]) : undefined;
      if (!runDir) return send(404, { error: "Not found" });

      if (req.method === "GET" && parts[0] === "api" && parts.length === 3) return send(200, { ...loadRun(runDir), generating: busy.has(parts[2]) });

      if (req.method === "GET" && parts[0] === "files") {
        const file = resolve(runDir, ...parts.slice(2));
        if (!file.startsWith(runDir + sep) || !MIME[extname(file)] || !existsSync(file)) return send(404, { error: "Not found" });
        return send(200, readFileSync(file), MIME[extname(file)]);
      }

      if (req.method === "PUT" && parts[3] === "text" && listFormatIds().includes(parts[4])) {
        const { content } = await readBody<{ content: string | string[] }>();
        return send(200, saveText(runDir, parts[4], content));
      }

      const summaryFile = join(runDir, "run-summary.json");
      const pending = readJson<Summary>(summaryFile, { text: [], images: [] }).pendingImages;

      const slug = parts[2];
      const sourceFile = join(runDir, "source.txt");
      const codeBlocks = () => extractCodeBlocks(existsSync(sourceFile) ? readFileSync(sourceFile, "utf-8") : "");
      const writePending = (update: (summary: Summary) => void) => {
        const summary = readJson<Summary>(summaryFile, { text: [], images: [] });
        update(summary);
        writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
      };

      // Slides are written from the brief, so it stays editable until they are planned.
      if (req.method === "PUT" && parts[3] === "brief" && parts.length === 4) {
        if (!pending || pending.planned || busy.has(slug)) return send(409, { error: "Slides are already written; the brief is read-only." });
        const { brief } = await readBody<{ brief: unknown }>();
        let parsed;
        try { parsed = parseBriefJson(JSON.stringify(brief)); } catch (err) { return send(400, { error: (err as Error).message }); }
        writeFileSync(join(runDir, "brief.json"), JSON.stringify(parsed, null, 2));
        return send(200, { ok: true });
      }

      // Step one after approving the drafts: write each image format's plan for editing.
      if (req.method === "POST" && parts[3] === "approve" && parts.length === 4) {
        if (!pending || pending.planned) return send(409, { error: "This run has no drafts waiting for approval." });
        if (busy.has(slug)) return send(409, { error: "Already working on this run." });
        const config = withImageSettings(loadConfig(cwd), pending.mode, pending.style);
        preflight(pending.formats, config);
        busy.add(slug);
        return send(202, startJob(async (job) => {
          job.slug = slug;
          try {
            const { planned, failed } = await planImages(runDir, pending.formats, config, cwd);
            writePending((summary) => {
              summary.images = toSummaryImages(failed);
              if (planned.length) summary.pendingImages = { ...pending, formats: planned, planned: true };
              else delete summary.pendingImages;
            });
          } finally {
            busy.delete(slug);
          }
        }));
      }

      const editable = pending?.planned && pending.formats.includes(parts[4]) && !busy.has(slug);
      const savedPlan = () => readJson<ImagePlan>(planPath(join(runDir, "images"), parts[4]), { formatId: parts[4], mode: "cards", style: "editorial", slides: [] });

      // Saving an edited plan re-runs the same checks as model output, so nothing invalid
      // (or code that isn't in the source) ever reaches the renderer.
      if (req.method === "PUT" && parts[3] === "plan" && parts.length === 5) {
        if (!editable) return send(409, { error: "This format has no editable plan." });
        const { slides } = await readBody<{ slides: unknown }>();
        const plan = savedPlan();
        let checked;
        try { checked = checkConcepts(loadImageFormat(parts[4]), slides, codeBlocks(), { requireImagePrompt: plan.mode === "generated" }); }
        catch (err) { return send(400, { error: (err as Error).message }); }
        writeFileSync(planPath(join(runDir, "images"), parts[4]), JSON.stringify({ ...plan, slides: checked }, null, 2));
        return send(200, { ok: true });
      }

      // Live preview of one slide from unsaved edits. Local rendering only: no model calls.
      if (req.method === "POST" && parts[3] === "preview" && parts.length === 5) {
        if (!editable) return send(409, { error: "This format has no editable plan." });
        const { slides, index } = await readBody<{ slides: ImagePlan["slides"]; index: number }>();
        if (!Array.isArray(slides) || !Number.isInteger(index)) return send(400, { error: "Expected slides and an index." });
        try {
          return send(200, await previewSlide(loadImageFormat(parts[4]), { ...savedPlan(), slides }, index, loadPersona(cwd)), "image/png");
        } catch (err) {
          return send(400, { error: (err as Error).message });
        }
      }

      // Step two: render every format exactly as its saved plan says.
      if (req.method === "POST" && parts[3] === "render" && parts.length === 4) {
        if (!pending?.planned) return send(409, { error: "There are no slide plans to render." });
        if (busy.has(slug)) return send(409, { error: "Already working on this run." });
        const config = withImageSettings(loadConfig(cwd), pending.mode, pending.style);
        preflight(pending.formats, config);
        busy.add(slug);
        return send(202, startJob(async (job) => {
          job.slug = slug;
          try {
            const results = await renderPlans(runDir, pending.formats, config, cwd);
            // A format that failed stays pending and editable, with its error shown, so the
            // plan can be fixed and rendered again.
            const failed = results.filter((r) => r.error).map((r) => r.formatId);
            writePending((summary) => {
              summary.images = [...summary.images.filter((i) => !pending.formats.includes(i.formatId)), ...toSummaryImages(results)];
              if (failed.length) summary.pendingImages = { ...pending, formats: failed };
              else delete summary.pendingImages;
            });
          } finally {
            busy.delete(slug);
          }
        }));
      }
      send(404, { error: "Not found" });
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export function runReviewCommand(opts: { port?: number; tunnel?: string }, cwd: string = process.cwd()): void {
  loadEnvFile(join(cwd, ".env"));
  const studio = studioOptionsFromEnv(process.env, !!opts.tunnel);
  const port = opts.port ?? 4321;
  createReviewServer(cwd, studio).listen(port, "127.0.0.1", () => {
    console.log(`COPE studio for ${join(cwd, "out")}/ at http://localhost:${port}${studio.auth ? " (login required)" : ""}  (Ctrl+C to stop)`);
    if (!opts.tunnel) return;
    // Map the custom domain to the tunnel (a no-op when it already points there), then
    // route the tunnel to this server. Setup: `cloudflared tunnel login` + `tunnel create`.
    const dns = spawnSync("cloudflared", ["tunnel", "route", "dns", opts.tunnel, studio.publicHost!], { stdio: "inherit" });
    if (dns.error) {
      console.error("cloudflared not found; install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
      process.exit(1);
    }
    if (dns.status !== 0) console.warn(`Could not map ${studio.publicHost} to tunnel "${opts.tunnel}"; check the DNS record in Cloudflare.`);
    const tunnel = spawn("cloudflared", ["tunnel", "run", "--url", `http://localhost:${port}`, opts.tunnel], { stdio: "inherit" });
    console.log(`Tunnel "${opts.tunnel}" → https://${studio.publicHost}`);
    // Never leave the studio running while believing it's public (or vice versa).
    tunnel.on("exit", (code) => { console.error(`cloudflared exited (${code}); stopping the studio.`); process.exit(code ?? 1); });
    process.on("SIGINT", () => { tunnel.kill("SIGINT"); process.exit(0); });
  });
}
