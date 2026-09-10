# Claude Code guidance

Follow the [Open Southeners contribution guide](https://github.com/open-southeners/agents/blob/main/skills/opensoutheners-contributor/references/contribution-guide.md).
When installed, use the `opensoutheners-contributor` skill.

User instructions and the repository-specific guidance below take precedence
over the shared defaults.

## Repository-specific guidance

### Project overview

Flex Url is a zero-dependency URL builder/parser for the apiable request-query
grammar (`filter`, `sort`, `include`, `fields`, `appends`, `page`, `q`),
shipped as **two mirrored packages from one monorepo**:

- `packages/js` — the TypeScript core, published as `flex-url` on npm.
- `packages/php` — the PHP port, published as `open-southeners/flex-url` on
  Packagist.

**Official documentation**: https://docs.opensoutheners.com/flex-url/

The defining constraint of this repository: method names and wire semantics
must stay **identical** between the two packages. Any change to one side's
public API, encoding rules, or parsing behaviour must be mirrored on the
other side in the same change — see
[Testing & cross-language parity](#testing--cross-language-parity) for how
that's enforced mechanically rather than by convention alone.

### Development commands

TypeScript (`packages/js`):

```bash
npm ci                                    # from repo root — npm workspaces
npm run test --workspace packages/js      # vitest run
npm run coverage --workspace packages/js  # vitest run --coverage (lcov.info + clover.xml)
npm run lint --workspace packages/js      # eslint .
npm run typecheck --workspace packages/js # tsc --noEmit (strict + loose configs)
npm run build --workspace packages/js     # tsup
```

PHP (`packages/php`):

```bash
cd packages/php
vendor/bin/phpunit                             # test suite
vendor/bin/phpunit -c phpunit.coverage.dist.xml # test suite with clover.xml coverage
vendor/bin/pint --test                         # lint (Laravel Pint)
vendor/bin/phpstan analyse                     # static analysis, level 8
```

Root-level `npm run test`/`npm run coverage`/`npm run lint`/`npm run build`
fan out to every npm workspace (`--workspaces --if-present`); `packages/php`
is not an npm workspace, so PHP commands must be run from `packages/php`
directly (or via `composer test`/`composer lint`, which wrap the same
commands).

### Architecture

Both packages follow the same three-layer shape — read the TypeScript side
first when in doubt, since its doc comments are treated as the canonical
description the PHP side mirrors:

1. **Functional core** (`state.ts` / `Internal/State.php`) — `FlexUrlState`
   is a plain, immutable-by-convention data structure. Every `with*`/`set*`/
   `add*`/`remove*` function returns a **new** state rather than mutating its
   argument.
2. **`FlexUrl` class** (`flex-url.ts` / `FlexUrl.php`) — a thin, stateless
   fluent wrapper around the functional core. Every builder method returns a
   new `FlexUrl` instance. Construct via `flexUrl()`/`url()` (TS) or
   `FlexUrl::make()`/`::from()`/`flex_url()` (PHP) — never the constructor
   directly. PHP enforces this (the constructor is `private`); TS's is a
   documented convention only (the constructor has no access modifier), so
   don't rely on TypeScript to catch a direct `new FlexUrl(...)` call.
3. **`Encoding`** (`encoding.ts` / `Internal/Encoding.php`) — percent-encoding
   of scalar values, comma-joined list encode/decode (including the
   `strictCommaEncoding` option), and bracketed key build/parse
   (`filter[due_at][gte]` ⇄ `{base: 'filter', path: ['due_at', 'gte']}`).
4. **`Input`** (`input.ts` / `Internal/Input.php`) — parses a starting
   URL/path into `{origin, pathname, search, hash}` so it can be round-tripped
   through the output methods.

PHP has one extra internal module with no TypeScript counterpart:
`Internal/Utf8.php` implements a WHATWG-style UTF-8 scrubber (invalid byte
sequences become U+FFFD) — `mb_scrub()` substitutes `?` instead and would
have added an extension dependency, so it's hand-rolled to match
`TextDecoder`'s behaviour in the TS side exactly.

The JSON:API `links`/`meta` pagination helper (`links.ts`, exported from
`flex-url/links`) is **TypeScript-only** — see the "PHP mirror" note in
`docs/advanced/json-api-links.md` for why. PSR-7/`Stringable` input acceptance
(`FlexUrl::from()`) and typed `EndpointSchema` narrowing are single-language
features too — TS has no compile-time generics equivalent for the latter, PHP
has no browser `URL`/PSR-7 input parity concern for the former.

### Testing & cross-language parity

Both suites (Vitest for `packages/js`, PHPUnit for `packages/php`) load and
run every case in **`fixtures/cases.json`** — a language-neutral table of
build/read assertions — in addition to their own language-specific unit
tests. The exact field-by-field schema is documented in `fixtures/SCHEMA.md`.

When changing or adding to the shared grammar (a new filter operator, a new
output method, an encoding rule):

1. Implement the change in **both** `packages/js/src` and `packages/php/src`.
2. Add or update a case in `fixtures/cases.json` covering it.
3. Run both suites — a case failing on only one side is the mechanism working
   as intended, not a flake.

A method that exists in only one language (PHP's `toQuery()`, TS's
`flex-url/links` helpers) is deliberately **never** referenced from
`fixtures/cases.json` — it's covered by that package's own suite instead.
Needing a per-language `equals` in a shared fixture is a signal the mirrored
API has drifted, not a reason to add one.

### Encoding contract

Read `docs/advanced/encoding-contract.md` (or the doc comments at the top of
`encoding.ts`/`Internal/Encoding.php`, which are kept in lockstep with it)
before touching anything in the `Encoding` module. The short version:

- Brackets and the list-separator comma are emitted **raw**; individual
  values are percent-encoded before being joined.
- A comma in a list value is **always a separator** by default (a 3.0.0
  breaking change from the pre-3.0 behaviour) — `strictCommaEncoding: true` /
  `new FlexUrlOptions(strictCommaEncoding: true)` opts back into
  raw-comma-splitting so a literal comma can round-trip inside one value.
- A raw `+` on input is a space (form-urlencoded semantics); output never
  emits `+`.
- Percent-decoding never throws: a malformed `%XX` is a literal `%`, and
  invalid UTF-8 becomes U+FFFD — identically in both languages.

### CI & releases

`.github/workflows/tests.yml` runs two jobs — `js` (Node 24.x/26.x matrix)
and `php` (PHP 8.4/8.5 matrix) — each uploading coverage to Codecov. Both
lanes track one Active LTS and one Current/latest runtime version per the
org's [CI runtime version policy](https://github.com/open-southeners/agents/blob/main/skills/opensoutheners-contributor/references/contribution-guide.md#ci-runtime-versions);
update the matrix when those rotate rather than leaving a lane stale.

`.github/workflows/publish.yml` reacts to two **independent, package-scoped**
tag patterns — there is no single monorepo-wide version tag:

- `flex-url-v*` — publishes `packages/js` to npm (staged trusted publishing;
  a maintainer still approves with 2FA) and cuts a GitHub release from
  `packages/js/CHANGELOG.md`.
- `flex-url-php-v*` — `git subtree split`s `packages/php` into the
  `open-southeners/flex-url-php` split repo (which Packagist watches directly,
  not this monorepo) and cuts a GitHub release from `packages/php/CHANGELOG.md`.

Both packages' `CHANGELOG.md` follow Keep a Changelog; a release-prep commit
("prepare for X.Y.Z release") bumps `packages/js/package.json`'s version and
moves the `## [Unreleased]` entries under a new dated version heading in
**both** changelogs, even when only one language actually changed —
keeping their version numbers in sync makes "which PHP version pairs with
which JS version" a non-question.

### Documentation (`docs/`)

Every file inside `docs/` is synced to GitBook at
https://docs.opensoutheners.com/flex-url/. Whenever you edit any file inside
`docs/`, follow GitBook formatting conventions — fetch and apply
`https://gitbook.com/docs/skill.md` before making changes. Key rules:

- Use `{% tabs %}`/`{% tab title="TypeScript" %}` · `{% tab title="PHP" %}`
  for any code example that differs (or even just to keep both languages
  visible side-by-side) — this is the dominant pattern throughout `docs/`,
  since the whole point of these docs is documenting two mirrored APIs
  together rather than as separate trees.
- Use `{% hint style="info|warning|danger|success" %}` for callouts.
- `docs/SUMMARY.md` must stay in sync with the file structure — update it
  whenever pages are added, removed, or moved.
- Internal links use relative `.md` paths (e.g. `[text](../building-urls/filters.md)`).
- Every `{% tag %}` needs a matching `{% endtag %}`.

The three root/package `README.md` files are intentionally minimal (badges +
install + a short snippet) — the full API reference lives in `docs/` only.
Don't re-duplicate API documentation back into a `README.md`.

### Code style requirements

- **TypeScript**: ESLint (`eslint.config.js`), strict `tsconfig.json` plus a
  `tsconfig.loose.json` typecheck pass — both must pass.
- **PHP**: Laravel Pint, PHPStan **level 8** (`packages/php/phpstan.neon`,
  scoped to `src/`). Don't add `@phpstan-ignore` comments or widen a type to
  silence an error — fix the underlying type, the same rule PHPStan itself
  asks for in its own error output.
