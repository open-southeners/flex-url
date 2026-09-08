# Shared fixture schema

`cases.json` is a language-neutral table of canonical build/read cases, shared
by the Vitest suite (`packages/js`) and the PHPUnit suite
(`packages/php`) so the two implementations can't drift silently. This file
documents the intended shape; `cases.json` itself starts empty — A2/A3 (the
core implementations) populate it once the builder API is frozen.

Each entry in the top-level array is a case object:

```jsonc
{
  // Short, unique, human-readable identifier for the case (used as the test
  // name/description on both sides).
  "name": "filter with multiple values comma-joins raw",

  // The base URL the builder starts from, e.g. via `flexUrl(base)` /
  // `FlexUrl::from($base)`. Pathname, port, and any existing query string on
  // this URL must be preserved through the build.
  "base": "https://api.example.com/posts",

  // Optional: construction options passed to `flexUrl()`/`FlexUrl::make()`
  // alongside `base` (and, when `readsFrom` is "base", the read-back parse
  // too). Defaults to `{}` — today's lenient behaviour — when omitted, so
  // every existing case is unaffected. Currently the only key is
  // `strictCommaEncoding` (boolean): split a list value on a raw `,` only,
  // decoding each piece afterwards, instead of decoding first and splitting
  // on whatever commas fall out.
  "options": { "strictCommaEncoding": true },

  // Ordered list of operation descriptors applied to the builder, one call
  // per descriptor, applied in array order. `op` is the method name shared
  // by both implementations (camelCase, matching the mirrored API); `args`
  // is the ordered list of arguments passed to that call.
  "build": [
    { "op": "filter", "args": ["status", ["published", "draft"]] },
    { "op": "sort", "args": ["-created_at"] }
  ],

  // The exact string both `toString()` (TS) and `toString()`/`__toString()`
  // (PHP) must produce after applying every `build` step, in order, to
  // `base`.
  "url": "https://api.example.com/posts?filter[status]=published,draft&sort=-created_at",

  // Optional: which URL the `reads` assertions are checked against.
  // "url" (the default) builds the reader from the canonical `url` above,
  // asserting that parse = build. "base" builds it from `base` instead,
  // which is what parse-only cases need: when `base` is a URL nobody would
  // ever emit (a malformed escape, a raw `+`, an explicit `[]`), the point
  // of the case is what the *input* parses to, and `url` records how it is
  // normalised on the way back out. Only meaningful with `build: []`.
  "readsFrom": "url",

  // Optional: read-back assertions. Constructing a fresh builder instance
  // from `readsFrom` (parse = build) must satisfy every assertion here. Each
  // assertion is a reader call (`op`/`args`, same shape as `build`) paired
  // with the value it must return/equal on both sides.
  "reads": [
    { "op": "getFilter", "args": ["status"], "equals": ["published", "draft"] },
    { "op": "getSort", "args": [], "equals": [{ "attribute": "created_at", "direction": "desc" }] }
  ]
}
```

Notes:

- `op`/`args`/`equals` values must be representable in plain JSON (strings,
  numbers, booleans, arrays, objects, null) — no language-specific types.
  Each runner maps `op` names to its own method calls.
- `reads` is optional; omit it for cases that only assert the built URL.
- `readsFrom` is optional and defaults to `"url"`.
- An `"equals": null` means "absent". PHP returns `null` and TypeScript
  returns `undefined` for the same state, so the TypeScript runner normalises
  `undefined` to `null` before comparing — a fixture can't distinguish the
  two, and shouldn't try to.
- `reads` may target any zero-argument output method the two packages share
  (`toString`, `toRequestUri`, `toRelativeUrl`, `toParams`), not just the
  getters. A method that exists in only one package — PHP's `toQuery()`, which
  is `parse_str` semantics with no browser-side counterpart — never appears in
  a fixture; cover it in that package's own suite. Needing a per-language
  `equals` would be a signal that the mirrored API has drifted, not a reason
  to add one.
- Keep descriptors minimal: one call per array entry, no nesting/branching.
  A case that needs conditional logic belongs as multiple cases instead.
