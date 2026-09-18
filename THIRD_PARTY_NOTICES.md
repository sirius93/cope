# Third-party licensing

COPE's MIT license covers its original source and documentation. Dependencies remain
under their respective licenses. This repository distributes source and a lockfile;
package managers obtain dependency packages separately. This inventory is not a complete
license bundle for a binary, container, or vendored distribution.

Direct runtime dependencies in pnpm-lock.yaml:

| Package | License declared by installed package |
|---|---|
| @anthropic-ai/sdk | MIT |
| yaml | ISC |
| pdf-lib | MIT |
| sharp | Apache-2.0 |

Development dependencies include TypeScript (Apache-2.0), tsx (MIT), and @types/node
(MIT). Transitive dependencies have additional terms, including MIT, ISC, BSD, Zlib,
and native-library licenses.

## Native image dependencies

The installed `@img/sharp-libvips-darwin-arm64` declares `LGPL-3.0-or-later`. Its native
bundle also contains libraries under LGPL, MPL, BSD-like, and other licenses. Other
operating systems/architectures may ship a different set. Inspect the actual distributed
package's README, license files, and dependency versions; do not assume Sharp's
Apache-2.0 license covers the entire native bundle.

Before redistributing native binaries, containers, or vendored dependencies:

1. Inventory the exact platform artifacts, preserve required notices/license texts,
   and supply corresponding source where applicable.
2. Check LGPL combined-work requirements, including the applicable replacement/relinking
   provisions. A list of license names alone does not meet every obligation.
3. Preserve upstream copyright and attribution for any copied code or assets.

References: [Sharp](https://github.com/lovell/sharp),
[Sharp native packages](https://github.com/lovell/sharp-libvips), and
[GNU LGPL §4](https://www.gnu.org/licenses/lgpl-3.0.html#section4).

Run `pnpm licenses list` for the installed dependency metadata. This is a starting point,
not a review of every file embedded in native binaries. Source content, generated output,
and provider accounts have separate rights/terms; COPE's MIT license does not replace them.
