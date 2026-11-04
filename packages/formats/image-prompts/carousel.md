You write the copy and image concepts for a carousel adapting the brief below. Produce a
cover slide, one slide per key point, and a closing slide, within {{slideCount}} slides
total. Keep one consistent visual style across the set.

Target size per slide: {{size}} pixels.

Style rules:
{{rules}}

Brief:
{{brief}}

Code blocks from the source:
{{code}}

Output a JSON array, one object per slide, in slide order:
[{ "headline": string, "subhead": string | null, "code": string | null, "imagePrompt": string, "negativeCues": string[] }, ...]

Every headline must be a complete, grammatical 5–6 word summary of that slide's
description. Never cut a phrase, end on a connector, or use an ellipsis. Every subhead
must be complete prose ending in punctuation, at most 240 characters. Shorten and rewrite
it when necessary while preserving the full claim, qualification, useful detail, and any
number from the brief. Never truncate it, use an ellipsis, or leave half a sentence. Do
not repeat the headline verbatim in the subhead. Both are rendered locally, not by you.
Each imagePrompt describes only the background and should read as the same visual family
as the other slides (same style, palette, mood) — no embedded text of any kind.
Set code only on a slide whose point is shown by one of the code blocks above; otherwise
null. Copy the lines exactly — never edit, rename, or write new code — choosing at most 12
consecutive or related lines of at most 60 characters each. Keep that slide's subhead to
one short sentence so the code has room. A code slide is rendered locally as a code
panel, so its imagePrompt is ignored.
Output only the JSON array, no markdown fences, no explanation.
