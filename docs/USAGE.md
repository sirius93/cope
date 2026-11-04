# Using COPE

Install from the repository with `pnpm install --frozen-lockfile` (requires Node.js
>=20.9 and pnpm 10.11.1). The default text route requires an authenticated `claude` CLI
on `PATH`. See the [README](../README.md) for the full provider comparison, and
[SECURITY.md](../SECURITY.md) for the trust-boundary details (what COPE treats as
trusted input, what gets sent to providers, etc.) before pointing it at untrusted URLs.

**Every command starts with `cope run` or `cope brief`** — `pnpm cope <input> --all`
(without `run`) doesn't error loudly, it just prints the help text and exits 1 without
doing anything. If a command silently "does nothing," check you didn't drop the
subcommand.

## Supply your source

Use a UTF-8 text/Markdown file, or an HTTP(S) URL:

```bash
pnpm cope brief examples/post.md
pnpm cope run examples/post.md -f x_post,x_thread,linkedin_post
pnpm cope run https://example.com/article --all
```

Sources are capped at 2 MiB (file or fetched page); URL fetches have a 30-second
deadline. HTML extraction is basic tag-stripping, not a full Readability pass, so a
JS-heavy site or one with a lot of nav/ad chrome may leak some of that into the source —
if the brief looks polluted, paste the clean article text into a file instead. Only fetch
URLs you trust: the page's content (and, transitively, any prompt-injection payload
hidden in it) becomes part of what every provider sees.

### Don't have a written draft? Dictate it.

COPE only ever reads a file or a URL — it has no recording or transcription of its own,
and there's no `cope run -`/stdin mode. If talking is easier than writing, record
somewhere else and save the transcript as your source file:

1. Open Claude (mobile app, or voice input on claude.ai) and start voice mode.
2. Talk through your idea like you're explaining it to a colleague — what happened, what
   changed, the numbers that matter, why anyone should care. Rambling is fine; the brief
   stage's job is to extract structure from rough material.
3. Copy the resulting transcript (ask Claude to tidy it into plain text first if you
   want less filler), paste it into a file (e.g. `notes.txt`), and save it in your
   project directory.
4. Run COPE against that file: `pnpm cope run notes.txt --all`.

Any other dictation tool works the same way — phone/OS voice-to-text, Otter.ai, a Whisper
transcript. COPE doesn't care how the text file was produced, only that it exists and is
under 2 MiB. One tip specific to dictation: say your numbers and facts out loud clearly
("eleven minutes down to four," "fifteen percent") — these get pulled into the brief's
`immutableFacts` and are meant to survive unchanged into every format; a vague transcript
gives the brief less to anchor on.

## Choose image mode

```bash
# Fast: local information cards, no image-generation or vision calls.
pnpm cope run examples/post.md --all

# Only the image formats.
pnpm cope run examples/post.md -f carousel,quote_card

# Slower, optional: AI-generated artwork with locally-rendered text on top.
pnpm cope run examples/post.md --all --image-mode generated
```

**`cards` (default):** typographic layouts with no image-generation or vision call. A
carousel makes one text call through `routing.image_prompt` to produce its copy, then
renders everything locally. It gets a cover slide, one slide per key point, and a closing
slide with the CTA/facts, up to 9 slides total. Every title is a complete 5–6 word summary
of its description. Every description is complete prose: COPE asks the model to rewrite
it within 240 characters while retaining the claim, qualification, useful detail, and
numbers. It rejects titles or descriptions containing ellipses and descriptions that end
mid-sentence, and — for the carousel specifically — the format fails outright rather than
clamping copy if it still can't get complete, legible text back after its repair passes.

**Code on carousel slides.** When the source has fenced code blocks (```` ``` ```` or
`~~~`, or `<pre>` on a URL source), the carousel can put an excerpt on the slide whose
point it shows: at most 12 lines of at most 60 characters. Every line must match a line in
the source's code blocks; only the indentation may change. An invented or edited line
fails validation and gets a repair pass. Code is drawn in a monospace panel that keeps
indentation and never wraps. Code slides are always rendered as local cards, even in
`generated` mode, because generated artwork can't hold legible code. Their alt text
includes the code.

**`og_image`/`quote_card` render directly from the brief with no text call**, and behave
differently: they hard-truncate long fields (e.g. `brief.audience`) to a fixed character
budget, appending "…" — a real ellipsis, not a figure of speech — if a field runs long.
Unlike the carousel, this can and does silently drop the end of a sentence. Check the
image's own JSON if a card's subhead looks cut off; the fix today is a shorter `persona/voice.md`/
source, since there's no rewrite pass for these two formats to shrink the text instead.

Alt-text is the card's own title and description, so a truncated subhead shows up
truncated there too. This validation prevents visible clipping and half-sentences in the
carousel; it cannot prove a model preserved every nuance. Review the generated image JSON
beside the source brief for any format before trusting it.

**`generated`:** the primary agent still creates the brief, text, edits, carousel copy,
and visual concepts. With the default Claude workflow, only image generation and
vision-based alt text are handed to `codex` (or a configured image API). Headline/subhead
are rendered locally on top of the generated background — models are unreliable at
legible embedded text, so COPE never relies on one for that. Every image is resized or
cropped locally to the format's exact pixel size regardless of what the model produced.
This needs `codex` with a working image tool (or configured `openai` image/vision routes),
takes real time because each image is a sequential generation call, and **is not
automatically retried**. A failed generation may still be billable, so re-run explicitly.

## Choose a visual style

```bash
pnpm cope styles
pnpm cope run examples/post.md -f carousel --image-style minimal
pnpm cope run examples/post.md -f carousel --image-mode generated --image-style blueprint
```

| Style | Look |
|---|---|
| `editorial` (default) | Warm paper, serif headlines, restrained magazine layout |
| `minimal` | White space, centered sans-serif type, monochrome geometry |
| `blueprint` | Deep navy, fine construction lines, monospace/technical type |
| `sketch` | Off-white paper, graphite-like accents, quiet notebook feel |

The style applies to either image mode — local cards use it directly for palette/type/
layout; generated mode feeds it into the image-concept and image-generation prompts too,
so artwork and card design stay visually consistent. Changing style adds no calls. Set
`images.style` in `cope.config.yaml` to make a style your default; `--image-style`
overrides it for one run. An unknown style name fails immediately, before any generation
starts.

## Brand your images

Copy `persona/persona.yaml.example` to `persona/persona.yaml` and fill in whichever
fields you have — logo, primary/secondary color, website, X/Twitter handle. Every field
is optional, and the whole file is optional: skip it and images render exactly as before.

```yaml
logo: logo.png # relative to persona/
primaryColor: "#2f6f4f"
secondaryColor: "#555750"
website: yourdomain.com
twitter: yourhandle
```

When set, `primaryColor`/`secondaryColor` replace the chosen style's accent/muted colors
(rules, decoration, footer text), and a brand bar — logo, website, handle — is drawn in
the card's bottom margin. This applies to every image format (`carousel`, `quote_card`,
`og_image`), in both `cards` and `generated` mode. `persona/` is gitignored except the
`.example` file: your logo, handle, and brand voice are personal, not project code.

## Run it, then review the output

Every invocation creates a fresh `out/<slug>-<unique-id>/` directory — reruns never
collide with or overwrite a previous run of the same source:

```
out/migrating-five-repos-into-one-pnpm-mon-a1b2c3/
  brief.json              inspect this for factual errors before trusting anything else
  run-summary.json        pass/fail per requested format
  x_post.txt
  x_thread.json
  linkedin_post.txt
  blog_md.md
  invalid/                 any text draft that failed validation after its repair passes
  images/
    quote_card.png
    quote_card.json         concept/mode/style, alt-text, size, timestamp
    carousel-1.png ... carousel-N.png
    carousel.pdf             upload to LinkedIn as a document post — it renders an
                              uploaded PDF as a swipeable carousel natively
```

**Nothing is published automatically.** Review every file — text and images — before
posting anywhere.

**Review in the browser.** `pnpm cope review` opens COPE studio at
http://localhost:4321 (`--port` to change). It shows every run in `out/`. Edit text in
place with live character counts. Saving re-runs the same validator as `cope run` and
moves the file between the run folder and `invalid/` to match. Slides, cards and the
carousel PDF show with their alt text, and a Copy button puts each post on the clipboard.

**Start a post from the browser.** Click **+ New post**, paste notes, a Markdown draft
or a URL, and pick formats. Images happen in two reviewed steps:

1. **Approve the drafts.** COPE writes the brief and text drafts and sets the image formats
   aside. Review the drafts and adjust the brief's key points (the carousel gets one
   slide per point). Then click **Approve drafts & write slides**. COPE writes each image
   format's plan to `images/<format>.plan.json`: every slide's title, description,
   optional code and, in generated mode, its artwork prompt.
2. **Review the slides.** Each slide shows a live preview beside its fields, rendered
   locally as you type, with no model calls. Generated-mode previews show the text panel
   over a placeholder, because artwork is only made in the next step. Edit, add or remove
   slides, then click **Generate images**. Unsaved edits are saved first. Each save
   re-checks the same rules as model output: 5–6 word titles, complete descriptions up to
   240 characters, 3–9 slides, and code copied from the source. Images are then rendered
   exactly from the saved plan file.

A format that fails to render stays editable with its error, so you can fix the plan and
generate again. The brief is read-only once slides are written.

The studio runs model calls for you, so it listens only on 127.0.0.1 and refuses
requests from other hosts or origins. Jobs live in memory. If you stop the server
mid-generation, the run folder is kept, and you can approve it again.

**Put the studio on your own domain.** A Cloudflare tunnel serves the studio on a custom
domain without opening a port. You need the domain's DNS on Cloudflare and
[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
installed.

1. One-time setup: run `cloudflared tunnel login`, then `cloudflared tunnel create cope-studio`.
2. Add these to `.env`:

   ```bash
   COPE_STUDIO_USER=you
   COPE_STUDIO_PASSWORD=a-long-unique-passphrase   # at least 12 characters
   COPE_PUBLIC_HOST=cope.example.com
   ```

3. Run `pnpm cope review --tunnel cope-studio`.

This points `cope.example.com` at the tunnel (`cloudflared tunnel route dns`), starts the
tunnel, and serves the studio at `https://cope.example.com`. If cloudflared exits, the
studio stops too, so it is never half up.

The login is checked on the server for every request, with HTTP Basic auth over the
tunnel's HTTPS. The browser shows its own login prompt, and nothing about the password
reaches the page. After 10 wrong logins, that client is locked out for 15 minutes.
The studio won't start with `COPE_PUBLIC_HOST` set unless both login variables are
present, and it accepts requests only for localhost and that one domain. Anyone who logs
in can spend your model credits and make your machine fetch any URL pasted as a source.
For extra protection, add a Cloudflare Access policy for the hostname in front of it.

**LinkedIn hooks.** The `linkedin_hooks` format writes five alternative openings, each
under the 210-character "see more" fold, from different angles: outcome, contrarian,
number or fact, personal moment, question. In the studio, **Use as opening** replaces
the LinkedIn post's first paragraph with that hook. Save the post to keep it.

**Check `run-summary.json`.** A format can be `valid: true` after 1–2 repair passes;
that's normal (COPE catching its own draft going over a limit and fixing it). A failed
text format lands under `invalid/` instead of the top level, and the whole command exits
with status 1 — but other requested formats still complete; one format's provider hiccup
doesn't abort the run. An interrupted run (killed mid-way) can be missing
`run-summary.json` entirely — treat that output directory as incomplete.

Re-run just the format that failed rather than the whole thing:
`pnpm cope run notes.txt -f <formatId>`.

## Brand voice, providers, and limits

Drop a `persona/voice.md` file in the directory you run `pnpm cope` from — its tone
guidance reaches the brief and every text-format prompt. Carousel copy is summarized from
that brief, while image art direction is controlled separately by `--image-style`.

```
persona/voice.md
-----------------
Direct, a little dry. Short sentences. No "unlock", "leverage", "game-changing", or
exclamation points. Prefer concrete numbers over vague claims.
```

Don't want to write `persona/voice.md` by hand? `pnpm cope voice <source>...` distills one
from writing samples instead — pass article URLs, RSS/Atom feed URLs (it fetches the feed
and reads the embedded post content, no need to list every post link), or local text files.
It refuses to clobber an existing `persona/voice.md` unless you pass `--force`, and
re-running it against an existing file asks the model to refine rather than contradict it:

```
pnpm cope voice https://yourblog.com/feed.xml https://yourblog.com/some-post
```

`persona/voice.md` is gitignored by default — it's distilled from your own writing, so
it's treated as personal, not project, content. Same goes for anything you feed it as a
local writing sample (e.g. `examples/voice-note.txt`): keep personal source material
gitignored too, and commit only genericized/example versions if you want one tracked.

Run `pnpm cope init` to write a starter `cope.config.yaml` + `.env.example`, or write a
partial config yourself — sections/providers merge with `config/defaults.yaml`, so a
small override is enough:

```yaml
routing:
  brief: openai
  shortform: openai
images:
  mode: cards
  style: editorial
limits:
  maxImagesPerRun: 10
  maxRepairPasses: 2
```

By default Claude owns the workflow: brief, text formats, editing, carousel copy, and
image concepts. Local cards then use COPE's built-in renderer and never invoke Codex.
Only generated images and their vision-based alt text are handed to the local `codex`
CLI. COPE uses the authentication already held by each CLI. For predictable
per-token/per-image billing instead, copy `.env.example` to `.env`, set
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, and point the relevant `routing` entries at
`anthropic`/`openai`. See the [README provider table](../README.md#configuration-and-providers).

`maxImagesPerRun` bounds the total image count for a run — including images reserved
for formats that go on to fail, so a flaky provider can't silently blow past your
budget. There's no token/dollar budget field anymore (an old `maxTokensPerRun` in a
copied config now fails clearly instead of pretending to cap spend) — use your
provider's own account-level limits for that.

### Plug COPE into Claude Code

Install and authenticate Claude Code, then confirm `claude --version` works in the same
shell as COPE. The default configuration already routes the brief, all text formats, and
carousel copy through `claude -p`; tools are disabled for these subprocesses. Local card
mode therefore needs Claude only: COPE's built-in renderer creates the PNGs and carousel
PDF from predefined layouts.

```bash
pnpm cope run notes.md --all --image-mode cards
```

To make the routing explicit in `cope.config.yaml`:

```yaml
routing:
  brief: claude_cli
  shortform: claude_cli
  midform: claude_cli
  longform: claude_cli
  edit: claude_cli
  image_prompt: claude_cli
```

If you switch to `--image-mode generated`, keep these Claude routes and add Codex only
for `image_generate` and `alt_text`; those two routes are already the defaults.

### Plug COPE into Codex

Install and authenticate the Codex CLI, then confirm `codex --version` and a normal
interactive invocation work. To use Codex for the brief, text, carousel copy, generated
artwork, and alt-text, route all stages to `codex_cli`:

```yaml
routing:
  brief: codex_cli
  shortform: codex_cli
  midform: codex_cli
  longform: codex_cli
  edit: codex_cli
  image_prompt: codex_cli
  image_generate: codex_cli
  alt_text: codex_cli
```

Then choose local cards or tool-backed artwork:

```bash
pnpm cope run notes.md --all --image-mode cards
pnpm cope run notes.md --all --image-mode generated --image-style editorial
```

Text runs in a disposable read-only Codex workspace. Generated artwork runs in a
disposable writeable directory so Codex can create one PNG, which COPE validates and
copies into the run directory. Image generation still depends on the installed Codex
CLI, account, and available tools; a successful text run does not prove image generation
is enabled.

## Troubleshooting

- **Command printed help and did nothing.** You almost certainly dropped `run` — it's
  `cope run <input> ...`, not `cope <input> ...`.
- **"Missing API key for provider..."** — you're routed to `anthropic`/`openai` without
  the matching env var set. Add it to `.env`, or switch that stage back to
  `claude_cli`/`codex_cli` in `cope.config.yaml`.
- **A `claude_cli`/`codex_cli` stage fails immediately.** Usually means the CLI isn't on
  `PATH` or isn't logged in — confirm with `claude --version` / `codex --version` and a
  plain interactive session.
- **"Unknown format" / "Unknown image style".** COPE validates every requested format id
  and style name before doing any work, so a typo fails fast instead of burning a brief
  call first.
- **"maxImagesPerRun exceeded."** Request fewer image formats/slides, or raise the limit
  in `cope.config.yaml`.
- **"Too much text for an information card."** Split long source paragraphs into
  shorter, more concrete key points — cards shrink text to fit but won't drop content
  silently.
- **A generated image looks wrong or the run is slow.** Generated mode makes real,
  un-retried sequential calls — `--image-mode cards` is the fast, free path if you don't
  specifically need AI artwork.
- **Output ignored my brand voice.** Confirm `persona/voice.md` is in the directory you
  *ran* `pnpm cope` from. It reaches the brief and text formats; carousel copy sees the
  resulting brief, while image art direction remains controlled by `--image-style`.

Local tests (`pnpm test`) run without any paid service or account. Smoke-test with your
own `claude`/`codex` login (and API keys, if you use those routes) before relying on this
for anything real.
