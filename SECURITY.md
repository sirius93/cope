# Security

COPE is an experimental, single-user local CLI. It is not a multi-tenant service or a
sandbox for running arbitrary uploaded content. Only the current development version
receives fixes; no response-time guarantee is offered.

## Reporting

Use the repository's GitHub **Security → Report a vulnerability** private reporting
feature. Maintainers must enable this before making the repository public. If that route
is unavailable, ask for a private contact without posting exploit details, credentials,
or private source material in a public issue.

## Trust boundaries

- Treat repository configuration, provider URLs, local CLI settings/plugins, and source
  files as trusted inputs. Remote articles and model output can contain prompt injection.
- Local cards do not invoke image/vision tools. Generated artwork invokes a tool-enabled
  CLI in a disposable directory; only a regular, bounded PNG is copied out. This reduces
  write exposure but does not establish host read isolation or disable inherited tools,
  connectors, settings, and authentication. Use an isolated account/container for
  untrusted material. Read-only CLI mode is not a confidentiality boundary.
- URLs are fetched with bounded size/time but may reach local/private network addresses
  and follow redirects. Do not expose ingestion to untrusted remote users without SSRF
  protections. Custom API endpoints receive API keys and submitted content.
- Source material, brand voice, and generated images may be sent to configured providers.
  Output files contain source-derived information. Review provider retention policies and
  local CLI logging; ephemeral mode is not a guarantee of zero external retention.
- Output escaping, JSON checks, and image decoding do not validate facts, copyright,
  or publication suitability. Review before posting.
- `.env*` files are ignored except `.env.example`. Never place real credentials in
  examples, prompts, logs, screenshots, or committed configuration.

Before publishing, enable private vulnerability reporting and secret scanning where
available, review the staged files, and run dependency advisory checks. Do not publish
bundled dependencies until their platform-specific licensing obligations are addressed.
