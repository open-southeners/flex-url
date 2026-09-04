# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-09-04

### Added

- `addFilterValue()`, `removeFilterValue()` and `toggleFilterValue()` operate
  on a filter's individual values instead of replacing the whole list, and
  removing the last value removes the filter. Every multi-select filter UI was
  hand-rolling this on top of `getFilter()`, and the `removeFilter()` that
  looks like it should do it takes an *operator* as its second argument, so it
  silently does nothing.
- `getFilters()` returns every filter as `{attribute, operator, values}`
  entries, in wire order — the plural counterpart to `getFilter()`, mirroring
  `getSorts()`.
- `getParam()` reads a raw param, with bracket syntax for nested ones.
  `param()` could write and `removeParam()` could remove, but nothing could
  read, so callers had to go through `toParams()` and re-derive the value
  from its wire form.

### Fixed

- `removeParam()` now reaches nested raw params:
  `removeParam('custom_sort[lang]')` removes that one entry, and the bare
  `removeParam('custom_sort')` removes every `custom_sort[...]` under it.
  Previously both were silent no-ops, leaving a parsed nested raw param with
  no way to remove it at all.

## [2.0.0] - 2026-09-03

### Added

- **`toRelativeUrl()`** — `pathname?query#hash`, the fragment-preserving
  counterpart of `toRequestUri()` for redirect targets and Blade `href`s
  (mirrors the TypeScript package's method of the same name).
- New `open-southeners/flex-url` package: an immutable, fluent `FlexUrl`
  builder/parser for the apiable request-query grammar — the PHP mirror of
  `flex-url`, with identical method names and wire semantics.
  `FlexUrl::make()`/`FlexUrl::from()` and the global `flex_url()` helper cover
  `filter()` (with `eq`/`equal`/`like`/`gt`/`gte`/`lt`/`lte` operators,
  comma-joined multi-values, and range filters via two calls or the
  `between()` shorthand), `filterScope()` (truthy toggles, named scope
  arguments, and the `_scoped` suffix), `sort()`/`sortDesc()` (accumulating,
  dot-path relationship sorts), `include()`, `fields()`, `append()` (wire key
  `appends[type]`), `page()`/`pageSize()`/`pageCursor()`,
  `search()`/`searchFilter()`, and a raw `param()` escape hatch. Every call
  returns a new instance — nothing is ever mutated in place.
- **Full URL fidelity**: constructing from a URL preserves its pathname,
  port, hash, and any existing query params. Parsing and building share the
  same internal state, so `FlexUrl::make($url)->toString()` round-trips
  losslessly, and readers (`hasFilter()`, `getFilter()`, `getSorts()`,
  `getIncludes()`, `getPage()`, `getPageSize()`, `getPageCursor()`,
  `getFields()`, `getAppends()`, `getSearch()`, `getSearchFilter()`,
  `toParams()`) expose the exact same vocabulary for hydrating UI state from
  the address bar — matching the TypeScript core.
- **Encoding contract**: brackets and commas are emitted raw (matching
  apiable's own idiom); every value is percent-encoded individually before
  being comma-joined, so a literal comma/bracket/space/`%`/`=`/`&` inside a
  value can never be confused with the grammar's structural characters.
  Parsing accepts both raw and percent-encoded brackets/commas on input
  (apiable's own pagination links use `page%5Bnumber%5D`).
- **Server-driven table support**: `toQuery()` returns the query state as a
  flat, nested array shaped exactly like `Illuminate\Http\Request::query()`
  would hold it, and `toRequestUri()` returns the `pathname?query` string —
  together they're enough to dispatch an in-kernel sub-request against an
  apiable endpoint (e.g. from a Livewire component) without this package
  depending on illuminate/http.
- `FlexUrl::from()` accepts a plain string or anything `Stringable`
  (including PSR-7's `UriInterface`, which qualifies without adding
  `psr/http-message` as a dependency) — the package has zero runtime
  dependencies.
- Shared JSON fixtures (`fixtures/cases.json`) covering every grammar
  feature, encoding edge case, and v1 regression — replayed by both this
  package's PHPUnit suite and the TypeScript core's Vitest suite so the two
  implementations can't silently drift apart.

### Changed

- **A raw `+` in a query string now parses as a space** (`%2B` remains a
  literal plus), matching `$_GET`, `Request::query()`, `URLSearchParams` and
  HTML GET forms. Previously `?q=hello+world` parsed to `"hello+world"` and
  re-serialised to `?q=hello%2Bworld`, silently changing the value the server
  saw. Serialising still never emits `+`, so a parsed URL round-trips to the
  same meaning server-side.

### Fixed

- **Percent-decoding is now total, UTF-8-safe and identical to the TypeScript
  mirror.** `rawurldecode()` returns raw bytes, so `?name=%FF` produced a
  string that isn't valid UTF-8 — `json_encode()` returned `false` and
  `response()->json()` threw "Malformed UTF-8 characters" on nothing worse
  than a stray escape in the query string. Decoding now replaces malformed
  sequences with U+FFFD (via `Internal\Utf8`, a direct implementation of the
  WHATWG decoder — `mb_scrub()` substitutes `?` rather than U+FFFD and would
  have added an extension dependency), so output is always valid UTF-8 by
  construction. A `%` not followed by two hex digits is now a literal `%`
  (`20%`, `50%off`, `%zz` survive intact) instead of being partly rewritten.
- **`getPage()`/`getPageSize()` return `null` for non-integer page params.**
  `?page[number]=abc` used to cast to `0`, and `?page[size]=20%` to `20` —
  quietly discarding the `%` and inventing a plausible-looking value.
- **A single-value `q[filter][attr][]` keeps its `[]` marker.** It used to
  round-trip to `q[filter][attr]=`, downgrading apiable's `whereIn()` to a
  scalar `where()`. `getSearchFilter()` and `toParams()` likewise report it
  as a one-element list rather than a string.
