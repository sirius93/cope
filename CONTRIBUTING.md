# Contributing

Use Node.js >=20.9 and pnpm 10.11.1:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Keep changes focused. Reuse the existing provider/format/render pipeline and avoid adding
dependencies where Node.js or the installed packages suffice. Add a regression check for
changed behavior; tests must not require accounts, API keys, or paid calls.

Describe the user-visible change, how it was tested, and any compatibility limitations
in your pull request. Never include credentials, private source material, or provider
responses containing private data. See SECURITY.md for vulnerability reports.

By submitting a contribution, you agree that your original contribution is provided
under the repository's MIT license. Submit only work you have the right to license;
identify third-party material and retain its required notices. Examples and assets must
have documented permission for redistribution. No separate CLA is required.
