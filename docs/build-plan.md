> Historical plan: see README.md and USAGE.md for current behavior. Local cards are now the default; token-budget enforcement is unsupported.

# COPE Agent — Build Plan (Handoff Document)

**Create Once, Post Everywhere.** An open-source, bring-your-own-key agent that takes one source piece of content and produces platform-native variants (long-form and short-form, text and image), then optionally publishes them.

Date: 2026-09-15
Status: M1 scaffolded (this repo). See README for current state; sections below are the original plan and remain the reference for M2+.

---

## 1. Goal and non-goals

**Goal:** A CLI + local HTTP service that turns one input (a draft, a blog post, a set of notes, or a URL) into a bundle of ready-to-post outputs for multiple channels, with review before publish.

**Model policy (fixed requirement):**
- **Claude (Anthropic)** — text-only tasks: source analysis, outlining, long-form drafting, short-form adaptation, editing, tone/brand checks.
- **Codex (OpenAI)** — text *and* image tasks: image prompt writing, image generation, alt-text, and text tasks when the user routes them there.
- Both are invoked through a provider abstraction; users supply their own API keys or point at compatible endpoints. No proprietary key is bundled.

**Non-goals for v1:**
- Video generation, scheduling calendars, analytics, multi-user auth, hosted SaaS.
- Fully autonomous publishing without a review step (opt-in only, off by default).

---

## 2. Content types

| Category | Formats (v1) | Primary model |
|---|---|---|
| Long-form | Blog post (Markdown), newsletter issue, LinkedIn article | Claude |
| Mid-form | LinkedIn post, Instagram/Facebook caption, YouTube description | Claude |
| Short-form | X/Twitter single post, X thread, Threads post, Bluesky post, Mastodon post | Claude |
| Visual | Hero/OG image, carousel slides (text-on-image), quote card | Codex (image) |
| Meta | Titles, subject lines, hashtags, alt-text, SEO description | Claude (alt-text may use Codex since it sees the image) |

Each format has a **spec** (hard limits + style rules) — see §5.

---

## 3. Architecture

```
┌────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Ingest    │ → │  Canonical   │ → │  Adapt       │ → │  Review &    │
│  (md/url/  │   │  Brief       │   │  (per-format │   │  Publish     │
│   notes)   │   │  (Claude)    │   │   pipelines) │   │  (adapters)  │
└────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
                                          │
                                   ┌──────┴───────┐
                                   │ Provider     │
                                   │ Router       │
                                   │ (Claude /    │
                                   │  Codex)      │
                                   └──────────────┘
```

**Stages:**

1. **Ingest** — Accept Markdown/plain text file, URL (fetch + readability extraction), or raw notes. Normalise to Markdown.
2. **Canonical Brief** — Claude produces a structured JSON brief: core claim, 3–7 key points, audience, tone, CTA, quotable lines, facts that must not be altered, suggested visual concepts. This is the single source of truth every adapter reads from; adapters never re-read the raw input unless the format needs full text (blog).
3. **Adapt** — For each requested format, run its pipeline: draft → self-check against the format spec (length, platform rules, brand voice) → repair loop (max 2 passes). Text goes to Claude; image steps go to Codex.
4. **Review** — Write everything to an output bundle (`out/<slug>/`). Optional TUI/web review page. Human edits are re-read before publish.
5. **Publish** — Platform adapters post via API where available; otherwise emit copy-paste-ready files. Dry-run by default.

**Runtime:** TypeScript / Node 22+ (single language for CLI, server, and adapters; matches likely contributor base). Use `pnpm` workspaces.

> Deviation: M1 was built and tested against Node 20.19 (the available local runtime). Nothing in M1 requires 22; revisit the floor if a later milestone needs a 22-only API.

---

## 4. Provider abstraction (BYO key / plug-through)

Define one interface; all model calls go through it.

```ts
interface TextProvider {
  id: string;                          // "anthropic" | "openai" | "custom"
  complete(req: TextRequest): Promise<TextResponse>;  // supports system, messages, json_schema, max_tokens
}

interface ImageProvider {
  id: string;
  generate(req: ImageRequest): Promise<ImageResponse>; // prompt, size, n, optional reference image
  describe?(req: DescribeRequest): Promise<string>;    // for alt-text
}
```

**Routing rules (config-driven, defaults below):**

```yaml
providers:
  anthropic:
    kind: text
    baseUrl: https://api.anthropic.com      # overridable for proxies/gateways
    apiKeyEnv: ANTHROPIC_API_KEY
    model: <verify current Claude model id at build time>
  openai:
    kind: text+image
    baseUrl: https://api.openai.com/v1
    apiKeyEnv: OPENAI_API_KEY
    textModel: <verify current Codex model id>
    imageModel: <verify current OpenAI image model id>

routing:
  brief: anthropic
  longform: anthropic
  shortform: anthropic
  edit: anthropic
  image_prompt: openai
  image_generate: openai
  alt_text: openai
```

**"Plug-through" requirements:**
- Any provider entry can set `baseUrl` to a compatible gateway (OpenRouter, LiteLLM, self-hosted proxy). Treat the OpenAI-compatible chat format as the generic fallback provider type.
- Keys are read from env or an untracked `.env`; never written to disk by the tool.
- Per-task model override via CLI flag (`--model shortform=anthropic:<id>`).
- Retry with backoff; surface provider errors verbatim; log token usage per stage.

**Do not hardcode model IDs in code.** Put them in `config/defaults.yaml` with a comment to verify against provider docs — model names rotate.

---

## 5. Format specs

Each format is a YAML/JSON spec + a prompt template. Example:

```yaml
id: x_thread
platform: x
kind: shortform
limits:
  maxPostChars: 280          # count with a proper grapheme counter; URLs count as 23
  minPosts: 3
  maxPosts: 12
rules:
  - First post must stand alone and hook without "a thread 🧵" clichés.
  - No hashtags except at most one in the last post.
  - Number posts only if >5.
  - Last post: CTA + link back to the long-form source if it exists.
output_schema: { posts: string[] }
```

Specs to write for v1: `blog_md`, `newsletter`, `linkedin_post`, `linkedin_article`, `x_post`, `x_thread`, `threads_post`, `bluesky_post` (300 chars), `mastodon_post` (500 default, configurable), `instagram_caption`, `youtube_description`, `og_image`, `carousel`, `quote_card`.

> M1 shipped `x_post`, `x_thread`, `linkedin_post`, `blog_md`. The rest come with M2 (images) and as the text-format set widens.

**Validation is code, not the model.** A `validate(spec, output)` function checks lengths and hard rules; failures feed back into the repair pass with the specific violation.

---

## 6. Image pipeline (Codex)

1. From the brief, Codex writes N image concepts (JSON: concept, prompt, negative cues, text overlay if any).
2. Generate with the image model. Sizes per platform (OG 1200×630, IG square 1080×1080, carousel 1080×1350, X 1600×900).
3. Text-on-image (carousel/quote cards): render text **locally** with a Canvas/Satori-style renderer over a generated or solid background — do not rely on the image model to render legible text.
4. Codex `describe` produces alt-text (≤125 chars) for every image.
5. Store prompt + seed + model alongside each image for reproducibility.

**Implementation notes (M2):**
- Steps 1 and 2 are `packages/core/src/image-pipeline.ts` (`generateConcepts` /
  `adaptImageFormat`); step 3 is `packages/render` (`sharp` compositing an SVG — not
  Canvas/Satori; no seed is stored since neither `codex`'s `image_gen` nor OpenAI's
  `images/generations` exposes one).
- One text-generation call produces all N concepts for a format at once (a JSON array,
  N=1 for `og_image`/`quote_card`, N=slide-count for `carousel`), not N separate calls —
  this is what keeps the carousel's style consistent across slides, since one call sees
  all slides together.
- The image-generation prompt always explicitly forbids model-rendered text, regardless
  of whether the format actually overlays text, so a background image never has stray
  AI-guessed letterforms baked in even for `og_image` (which has no overlay).
- Image output is nested one level under the run's output dir (`out/<slug>/images/`),
  separate from the flat text-format files at `out/<slug>/` — a `carousel` alone can
  produce 24 files (PNG + JSON per slide + one PDF), which would otherwise swamp the
  4-ish text files sitting next to them.
- A format spec can set `bundlePdf: true` (currently just `carousel`) to also assemble
  its slide PNGs into one multi-page PDF via `packages/render`'s `buildPdfFromImages`
  (`pdf-lib`, one full-page image per page at the slide's own pixel size) — this is what
  LinkedIn's document-post feature wants: upload one PDF, it renders as a swipeable
  carousel, rather than attaching images separately. Verified live: a 7-page PDF from
  real carousel slides, correct 1080×1350pt page size, round-tripped through `pdftoppm`
  to confirm page 1 pixel-matches the source PNG.

---

## 7. Publishing adapters

Each adapter implements `{ validate, preview, publish(dryRun) }`.

| Platform | v1 approach |
|---|---|
| X | API v2 (user-context OAuth 2.0). Thread = chained replies. Media upload for images. |
| LinkedIn | Community Management API (needs app approval) — ship as **copy-ready** first, API optional. |
| Bluesky | AT Protocol — straightforward, do this first as the reference adapter. |
| Mastodon | REST API with access token. |
| Threads | Threads API. |
| Blog | Write Markdown + frontmatter to a target directory or open a PR via GitHub API (fits static-site blogs). |
| Newsletter | Generic: emit HTML + text. Optional beehiiv/Buttondown adapter behind a flag. |
| Instagram | Copy-ready only in v1 (Graph API requires business account + hosted image URL). |

Rules: dry-run default; `--publish` required; each published item logs the platform URL to `out/<slug>/publish-log.json`; idempotency key per item so re-runs don't double-post.

---

## 8. Interfaces

**CLI (`cope`):**
```
cope init                          # writes config + .env.example
cope brief ./post.md               # just the canonical brief
cope run ./post.md -f x_thread,linkedin_post,og_image
cope run https://example.com/post --all
cope review out/my-post            # opens local review UI
cope publish out/my-post --platforms bluesky,x [--dry-run]
```

> M1 ships `init`, `brief`, `run`. `review` and `publish` land in M4/M3.

**Local server:** `cope serve` exposes the same operations over HTTP (`POST /runs`, `GET /runs/:id`, `POST /runs/:id/publish`) so it can be driven by other agents or a UI.

**Review UI (v1-lite):** single static page served locally listing each output with edit-in-place and per-item approve/skip. Nothing fancy.

---

## 9. Repo layout

```
cope/
  packages/
    core/          # brief, pipelines, validation, provider router
    providers/     # anthropic, openai, openai-compatible
    formats/       # specs + prompt templates
    adapters/      # bluesky, x, mastodon, threads, blog-git, newsletter
    render/        # text-on-image rendering
    cli/
    server/
    review-ui/
  config/defaults.yaml
  examples/
  docs/
  LICENSE          # MIT or Apache-2.0
```

> `render/` was added for M2; `adapters/`, `server/`, `review-ui/` are still M3/M4 — not scaffolded empty ahead of need, per YAGNI.

---

## 10. Milestones

**M1 — Core loop (text only, Claude)** ✅ done
Ingest → brief → `x_post`, `x_thread`, `linkedin_post`, `blog_md` → validated outputs to disk. Provider abstraction with Anthropic + OpenAI-compatible fallback. CLI `run`. Tests for validators.

**M2 — Images (Codex)** ✅ done
Image concepts, generation, local text rendering, alt-text. `og_image`, `carousel`, `quote_card`. Confirmed live end-to-end: a 7-slide carousel + og_image + quote_card, all real generated PNGs with locally-rendered headline/subhead text, correct dimensions, and alt-text (including transcribing the overlaid text, which is correct practice since it's raster pixels a screen reader can't read directly).

**M3 — Publishing**
Bluesky (reference), Mastodon, X, blog-via-git. Dry-run, publish log, idempotency.

**M4 — Review + server**
`cope serve`, review UI, human-edit round-trip.

**M5 — Polish for open source**
README with 5-minute quickstart, config docs, format-spec authoring guide, contribution guide, example inputs/outputs, CI (lint, typecheck, tests).

---

## 11. Acceptance criteria

- Running `cope run examples/post.md --all` with only `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` set produces every v1 format with zero validation failures.
- Swapping `baseUrl` to a gateway requires no code change.
- Every short-form output passes hard limits via the code validator (not model self-report).
- Every image has alt-text and a stored prompt.
- `publish` without `--publish` never hits a platform API.
- Facts flagged "must not alter" in the brief appear unchanged in every text output (assert via test fixtures).

---

## 12. Open questions — decided for M1

1. Should the brief stage also run on Codex as a second opinion, or stay Claude-only? → **Claude-only.**
2. Brand voice: single global `voice.md` file, or per-platform overrides? → **Global `voice.md`, optional per-format append** (append path not yet wired — single global file only in M1).
3. Licence: MIT vs Apache-2.0. → **MIT.**
4. Does the blog adapter target a specific static-site generator or stay generic frontmatter? → **Generic frontmatter** (adapter itself is M3).
5. Cost guardrail: hard cap on tokens/images per run? → **Yes, configurable, on by default** (`config/defaults.yaml: limits`) — not yet enforced at runtime in M1, see notes below.

---

## 13. Notes for the implementing agent

- Verify current model IDs, API endpoints, and platform API terms before writing provider/adapter code; treat everything in this document about third-party APIs as "check at build time".
- Build validators and format specs before prompts — prompts are cheap to iterate once the checks exist.
- Keep prompts in files (`formats/*/prompt.md`), not string literals, so non-developers can contribute.
- Ship M1 end-to-end before widening formats.

### Addendum: CLI-agent providers (beyond the original plan)

The original plan assumed BYOK-only (§4: "No proprietary key is bundled"). M1 added a
third provider protocol, `claude-code-cli`/`codex-cli`, that shells out to the local
`claude`/`codex` CLI in headless mode instead of calling the Anthropic/OpenAI APIs
directly — reusing whatever subscription auth the CLI already has, so text generation
needs no API key at all. This is now the **default** routing (`config/defaults.yaml`);
`anthropic`/`openai` (direct API, BYOK) remain available by switching `routing` entries.
Implementation: `packages/providers/src/{cli-agent,claude-code-cli,codex-cli}.ts`. See
README's "Providers" section for the trade-offs (per-call session overhead, no
programmatic billing control).

**Update:** `codex exec` also has a built-in `image_gen` tool producing real PNG pixel
data — confirmed by two direct tests (a 1672×941 PNG via raw CLI, then a 512×512 PNG via
`ImageProvider.generate()` itself), run with `--sandbox workspace-write` instead of
`read-only` so it can write into the workspace. §4's `ImageProvider`/`DescribeRequest`
interface is now implemented (`packages/providers/src/types.ts`) with two backends:
`codex-cli-image.ts` (default, no API key) and `openai-image.ts` (direct `gpt-image-1` +
vision, BYOK). `ProviderEntry` gained `imageModel`; `ProviderRouter` gained
`imageProviderFor(stage)` alongside `textProviderFor`. `image_generate`, `image_prompt`,
and `alt_text` all default to `codex_cli` in `config/defaults.yaml` now — revise §6's
"Codex (image)"-only assumption accordingly. Routing an image stage to a text-only
protocol (`claude-code-cli`/`anthropic`) throws a clear config-time error rather than
failing silently.

Not yet done: the image *formats* (`og_image`/`carousel`/`quote_card`), the local
text-on-image renderer (§6 step 3 — still needed since neither image tool reliably
renders legible arbitrary text), and per-platform sizing. `ImageRequest.size` is steered
through the prompt text only (ponytail — codex's `image_gen` tool isn't exposed as CLI
flags we control directly); revisit if a format needs an exact pixel size the model won't
reliably hit from prose.

### M1 follow-ups (not yet done)

- `limits.maxTokensPerRun` / `maxImagesPerRun` are defined in config but not enforced by the pipeline — now more pressing since M2 landed: a `carousel` with the max 8 slides means 8 real sequential image-generation calls with no cap, and a live test run of `--all` took ~17.5 minutes for 4 text + 3 image formats (9 images total). Add a running-total check in `adaptImageFormat`/`runCope`.
- Per-format voice append (`voice.<format>.md`) is speced in the open-questions answer but not implemented — only the global `voice.md` is read, and image-concept prompts don't receive brand voice at all (no `{{voice}}` placeholder in `image-prompts/*.md`).
- `--model stage=provider:id` CLI override is supported by `createProviderRouter`'s `overrides` param but not yet wired to a CLI flag.
- URL ingestion strips HTML with regex, not a real Readability pass — fine for simple articles, will mangle complex pages.
- Image generation has no seed/reproducibility field to store (neither `codex`'s `image_gen` nor OpenAI's `images/generations` exposes one) — §6 step 5's "store prompt + seed + model" is prompt + size + timestamp only; re-running the same concept will not reproduce the same image.
- `adaptImageFormat` has no repair loop for the image itself (only the concept-JSON parse has one) — a generated image that doesn't match the concept (wrong style, accidentally has text despite the instruction) isn't detected or retried, unlike text's validate-and-repair loop.
