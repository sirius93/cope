# Why we moved our build pipeline to a monorepo

We spent three weeks migrating five separate repos into one pnpm workspace. Build times
dropped from 11 minutes to 4 minutes because CI now shares a single dependency cache
instead of rebuilding node_modules five times. We also cut our release process from 45
minutes of manual repo-hopping down to one `pnpm changeset publish` command.

The catch: our CI bill went up about 15% in the first month, because more jobs run on
every PR now (any change touches the shared lint/typecheck step). We fixed that by adding
path-based filtering so only affected packages run their test suite.

If you're maintaining more than three repos that share code, and you're copy-pasting the
same GitHub Actions workflow into each one, a monorepo will probably save you more time
than it costs — but budget a real week for the migration, not a weekend.
