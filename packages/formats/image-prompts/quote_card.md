You write the image concept for a single quote card adapting the brief below. Pick the
strongest line from the brief's quotableLines (or the coreClaim if none fit well) as the
headline.

Target size: {{size}} pixels.

Style rules:
{{rules}}

Brief:
{{brief}}

Output a JSON array with exactly one object:
[{ "headline": string, "subhead": string | null, "imagePrompt": string, "negativeCues": string[] }]

headline is the exact quote text — it will be rendered locally, not by you. imagePrompt
describes only the background: simple, uncluttered, no embedded text of any kind. Output
only the JSON array, no markdown fences, no explanation.
