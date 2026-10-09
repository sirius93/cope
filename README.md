<p align="center">
  <img src="assets/cop-e.png" alt="COP-e, COPE's corgi mascot, holding three content cards" width="260">
</p>

# COPE — Create Once, Post Everywhere

**Turn one idea into a complete, platform-ready content package.**

[![MIT License](https://img.shields.io/badge/license-MIT-2f6feb.svg)](LICENSE)
[![Node.js 20.9+](https://img.shields.io/badge/Node.js-20.9%2B-339933.svg)](package.json)
[![Local first](https://img.shields.io/badge/workflow-local--first-7c3aed.svg)](docs/USAGE.md)

COPE is an open-source, local-first content repurposing agent. Give it rough notes, a
Markdown draft, or a URL; it builds one canonical brief, then creates X posts, LinkedIn
posts, blog drafts, social images, and swipeable carousel PDFs from the same source.

```bash
pnpm cope run examples/post.md --all
```

One command produces a reviewable folder of text, images, metadata, and a run summary.
COPE never publishes automatically.

## Why COPE?

- **One source, many formats.** Create an X post, thread, LinkedIn post, blog draft, OG
  image, quote card, and carousel without rebuilding the idea each time.
- **Fast local visuals.** Information cards render locally with no image-generation or
  vision calls; use generated artwork only when it adds value.
- **Complete carousel copy.** Every slide gets a short 5–6 word title and a complete
  supporting description. Text that cannot fit fails instead of being clipped.
- **Bring your preferred model.** Use Claude Code, Codex, Anthropic, OpenAI, or a trusted
  OpenAI-compatible endpoint through configuration.
- **Review before publishing.** Outputs are files, validation failures are explicit, and
  every run is isolated so an older result is never silently reused.

## Agent or skill?

**Describe COPE as an agent.** It owns a multi-step workflow: ingesting source material,
building a brief, routing work to models, adapting formats, validating results, rendering
visuals, and writing artifacts. A Claude or Codex skill is usually an instruction bundle
that runs inside its host. COPE is a standalone CLI agent that can use either host as a
provider, so a future skill would be a thin way to invoke COPE rather than the product
itself.

## What it creates

| Output | Format ID | Result |
|---|---|---|
| X post | `x_post` | Concise single post |
| X thread | `x_thread` | Structured multi-post thread |
| LinkedIn post | `linkedin_post` | Professional long-form social post |
| Blog draft | `blog_md` | Markdown article |
| OG image | `og_image` | Share-ready PNG |
| Quote card | `quote_card` | Branded quote PNG |
| Carousel | `carousel` | PNG slides, metadata, and a PDF |

Start with selected formats when you want a faster first run:

```bash
pnpm cope run examples/post.md -f x_post,linkedin_post,carousel
```

## Installation

COPE is currently clone-and-run. It requires Git, Node.js >=20.9, and pnpm 10.11.1:

```bash
git clone https://github.com/sirius93/cope.git
cd cope
corepack enable
corepack prepare pnpm@10.11.1 --activate
pnpm install --frozen-lockfile
```

Then install and authenticate the provider needed by your workflow.

| Primary workflow | Local cards and carousels | Generated artwork |
|---|---|---|
| Claude Code (default) | Claude writes the copy; COPE renders it locally. Codex is not needed. | Claude keeps the full text workflow; Codex handles only image generation and vision-based alt text. |
| Codex | Codex writes the copy; COPE renders it locally. | Codex handles the complete workflow. |

The built-in card renderer is the default. It creates the carousel PNGs and PDF from
predefined layouts, so neither agent needs to generate an image unless you explicitly
select `--image-mode generated`.

### Claude Code: default local-card workflow

The default configuration uses Claude Code for the brief, text formats, and carousel
copy. Install it using an [official Claude Code method](https://code.claude.com/docs/en/setup):

```bash
# macOS, Linux, or WSL
curl -fsSL https://claude.ai/install.sh | bash

# macOS with Homebrew
brew install --cask claude-code
```

Windows users can use the PowerShell or WinGet commands in the linked setup guide.

Run `claude` once to sign in, then verify and run COPE:

```bash
claude --version
pnpm cope run examples/post.md -f x_post,linkedin_post
pnpm cope run examples/post.md --all --image-mode cards
```

This path does not require an API key or Codex. Claude Code's account limits, billing,
and service terms still apply.

### Codex: image handoff or complete workflow

When Claude is the primary agent, the generated-artwork route hands only image generation
and vision-based alt text to Codex. Install it using the
[official Codex CLI installer](https://developers.openai.com/codex/cli/):

```bash
# macOS or Linux
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

Windows users should follow the Windows instructions in the linked Codex guide.

Run `codex` once and choose a sign-in method, then verify it:

```bash
codex --version
```

With the default configuration, keep Claude installed and add Codex for generated images:

```bash
pnpm cope run examples/post.md --all --image-mode generated
```

To use Codex for the entire pipeline, create `cope.config.yaml`:

```yaml
routing:
  brief: codex_cli
  voice_learn: codex_cli
  longform: codex_cli
  midform: codex_cli
  shortform: codex_cli
  edit: codex_cli
  image_prompt: codex_cli
  image_generate: codex_cli
  alt_text: codex_cli
```

### API providers: no agent CLI

Copy `.env.example` to `.env`, add `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`, then
route stages to `anthropic` or `openai` in `cope.config.yaml`. For an OpenAI-only setup:

```yaml
routing:
  brief: openai
  voice_learn: openai
  longform: openai
  midform: openai
  shortform: openai
  edit: openai
  image_prompt: openai
  image_generate: openai
  alt_text: openai
```

Verify the configured model IDs before running API routes. For all commands, provider
details, and Claude/Codex integration notes, see the [usage guide](docs/USAGE.md).

## Fast images

```bash
pnpm cope run examples/post.md --all
```

Images default to **local information cards**: readable typography, key points, and a
carousel PDF rendered from the brief. This mode makes **zero image-generation or vision
calls**. A carousel uses one text call to create complete 5–6 word titles and supporting
descriptions; other cards render directly from the brief. Alt-text is derived from the
card's actual content. No `codex` installation is needed.

For AI-generated artwork instead:

```bash
pnpm cope run examples/post.md --all --image-mode generated
```

Generated mode keeps the brief, writing, editing, and image concept with the selected
primary agent. By default, only image generation and vision-based alt text use the local
`codex` CLI. Those calls can take many minutes, and tool availability depends on the
installed CLI and account. This integration is experimental; the automated tests use
substitutes, not live authenticated services. Simpler visual prompts alone do not
guarantee faster remote generation.

## Visual styles

Choose a style independently of image mode:

```bash
pnpm cope styles
pnpm cope run examples/post.md --all --image-style editorial
pnpm cope run examples/post.md -f carousel --image-mode generated --image-style sketch
```

| Style | Look |
|---|---|
| `editorial` (default) | Warm paper, serif headlines, restrained magazine composition |
| `minimal` | White space, centered sans-serif typography, monochrome geometry |
| `blueprint` | Deep navy, fine construction lines, technical typography |
| `sketch` | Off-white paper, graphite-like accents, quiet notebook feel |

Local cards use the selected palette, typography and layout without extra model calls.
Generated mode applies the art direction to both concept and image prompts and uses a
matching caption panel. Actual artwork still depends on the image provider. Styles stay
consistent within a carousel and are recorded in each image's JSON metadata. There are
no automatic COPE banners or watermarks.

## Output and validation

Each run gets a fresh `out/<slug>-<unique-id>/` directory, containing `brief.json`,
`run-summary.json`, text drafts, and `images/` (PNG, metadata/alt-text JSON, carousel PDF).
Previous runs are never reused. Failed text drafts go under `invalid/`; any failed format
sets a nonzero exit code. Other formats continue after a provider failure.

Validation checks JSON types and configured numeric limits, with a bounded repair loop.
It does **not** establish factual accuracy, originality, or suitability for publication.
Failed image formats may leave partial files; consult `run-summary.json` before using them.

Formats: `x_post`, `x_thread`, `linkedin_post`, `blog_md`, `og_image`, `quote_card`, `carousel`.
The `og_image` card contains a headline; generated mode uses artwork without a text overlay.

## Configuration and providers

`config/defaults.yaml` contains defaults. A local `cope.config.yaml` merges sections and
individual provider entries, so a small override is enough:

```yaml
images:
  mode: cards # or generated
  style: editorial # minimal | blueprint | sketch
limits:
  maxImagesPerRun: 10
voice:
  file: persona/voice.md # gitignored by default — it's derived from your own writing, not project code
```

Brand images with a logo, colors, website, and social handle by copying
`persona/persona.yaml.example` to `persona/persona.yaml` — see [docs/USAGE.md](docs/USAGE.md)
for the fields. It's optional and gitignored, same as `persona/voice.md`.

| Provider | Authentication | Use |
|---|---|---|
| `claude_cli` | Existing local CLI login | Text (default) |
| `codex_cli` | Existing local CLI login | Text, experimental generated artwork and vision |
| `anthropic` | `ANTHROPIC_API_KEY` | Text API |
| `openai` | `OPENAI_API_KEY` | OpenAI-compatible text, image and vision APIs |

Copy `.env.example` to `.env` for API credentials and override the relevant `routing`
entries. Verify model IDs with your provider before using the API routes. Custom
`baseUrl` values receive the configured credentials and submitted content; only use
trusted endpoints. See [usage](docs/USAGE.md) and [security](SECURITY.md).

`maxImagesPerRun` bounds the total image count reserved across a run, including failed
formats. Image generation and CLI subprocesses are not automatically retried: a failed
request may still be billable. Text HTTP requests retry only transient HTTP statuses.
`maxRepairPasses` is limited to 0–10. `maxTokensPerRun` is unsupported and rejected;
configure spending/quota limits with your provider. This is not a dollar-budget guarantee.

## Development

```bash
pnpm typecheck
pnpm test
```

Source packages live in `packages/{providers,formats,render,core,cli}`. Distribution is
currently clone-and-run; packages are private and are not prepared for npm publication.
See [contributing](CONTRIBUTING.md). The original [build plan](docs/build-plan.md) is
historical planning material, not a statement of implemented features.

## License

COPE's original code and documentation are [MIT licensed](LICENSE). Dependencies retain
their own licenses; see [third-party licensing](THIRD_PARTY_NOTICES.md), especially before
redistributing native binaries or containers. The software license does not determine
rights to source material or generated output, or replace provider service terms.
