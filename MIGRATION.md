# Migration guide: flex-url v0 → v1 → v2

This document is written to be executed, by a person or by a coding agent, as a
mechanical migration. Every claim in it was verified by running the actual
published sources (`flex-url@0.8.0`, `flex-url@1.6.0`, `flex-url@2.0.0`), not
inferred from changelogs.

**If you are an agent:** read *The wire format changed twice* and *Data
compatibility* before touching any code. They describe changes that are
invisible in the call sites you will be rewriting, and getting them wrong
corrupts queries at runtime rather than failing the build. Work through the
*Migration checklist* in order.

---

## Identify the version in use

All three majors are published under the same npm name, `flex-url`, so the
import specifier tells you nothing. Check the installed range first, then
confirm against the call sites:

| Signal | Version |
|---|---|
| `package.json` has `"flex-url": "^0..."` | v0 |
| `package.json` has `"flex-url": "^1..."` | v1 |
| `package.json` has `"flex-url": "^2..."` | v2 |
| `createFlexUrl(...)`, `.filterBy(...)`, `.sortBy(...)` | v0 |
| `new FlexibleUrl(...)`, `.queryParam(...)`, `.filters`, `.sorts`, `.sort()` | v1 |
| `.filter(attr, value)` with two arguments, `.toParams()`, `.toRelativeUrl()` | v2 |

**One consequence deserves emphasis.** Because the name never changed, upgrading
is a version bump: no import rewrite, and therefore *no build error anywhere* to
tell you the upgrade happened. Every difference in this guide is a silent
behaviour change. It also means the two majors cannot be installed side by side,
so an incremental file-by-file migration is not available — the cutover is
atomic per application.

---

## The wire format changed twice

This is the part that breaks backends, not builds. The same logical query
serialises differently in all three versions:

Filtering `status` by the two values `published` and `draft`:

| Version | Emitted query string |
|---|---|
| v0 | `filter%5Bstatus%5D=published%2Cdraft` |
| v1 | `filter[status]=published%2Cdraft` |
| **v2** | `filter[status]=published,draft` |

Two separate changes happened:

1. **v0 → v1: brackets stopped being percent-encoded.** `filter%5Bstatus%5D`
   became `filter[status]`.
2. **v1 → v2: the separator comma stopped being percent-encoded, and individual
   values started being encoded instead.** This is the inversion that matters.
   v2 matches apiable's own idiom and the pagination links apiable generates: a
   **raw** comma separates values, and a comma *inside* one value is escaped as
   `%2C`.

v1 had it exactly backwards, which is why the two formats are not just different
but mean opposite things. Under v1, `%2C` was the separator. Under v2, `%2C` is
a literal comma in a single value and a raw `,` is the separator.

---

## Data compatibility: old URLs parse differently

URLs produced by v0 or v1 still exist — in bookmarks, saved table views, emailed
links, stored "last search" rows in a database. v2 does not read all of them the
way v0/v1 wrote them.

Verified behaviour of v2 parsing older formats:

| Input (written by) | v2 `getFilter('foo')` | Correct? |
|---|---|---|
| `filter[foo]=bar,hello` (v2) | `['bar', 'hello']` | yes |
| `filter[foo]=bar%2Chello` (v0/v1 multi-value) | `'bar,hello'` — **one string** | **no** |
| `filter[foo]=bar&filter[foo]=hello` (v1 AND) | `['bar', 'hello']` | changes meaning, see below |
| `filter%5Bstatus%5D=a` (v0 brackets) | reads fine | yes |

Two consequences:

- **A v0/v1 multi-value filter is read by v2 as a single value containing a
  comma.** A saved view filtering by `published,draft` becomes a filter for the
  literal string `"published,draft"`, which matches nothing. If you have
  persisted URLs or query strings, they need a one-off rewrite: replace `%2C`
  with `,` inside `filter[...]` values.
- **v1's AND and OR collapse into one thing.** v1 could express two different
  queries: `filter[foo]=bar&filter[foo]=hello` (AND) and
  `filter[foo]=bar%2Chello` (OR). v2 has one multi-value form and parses the AND
  form into it, emitting `filter[foo]=bar,hello`. v2 cannot emit repeated
  `filter[foo]=` keys at all. If your backend relied on v1's AND semantics, that
  query has no v2 builder equivalent — use two different attributes, or an
  operator (`filter('foo', 'like', ...)`), depending on what apiable expects.

Percent-encoded brackets (`filter%5Bstatus%5D`) parse correctly in v2, so v0-era
links are safe on that axis. apiable's own pagination links use that form.

---

## Behavioural changes that produce no build error

### 1. v2 is immutable — you must reassign

v0 and v1 both mutate in place and return `this`. v2 returns a **new instance**
from every call and never modifies the receiver. This is the single most common
silent breakage.

```ts
// v0 / v1 — mutates `url`
const url = flexUrl(window.location.href);
url.filter('status').add('published');   // v1
url.toString();                           // includes the filter

// v2 — WRONG, the filter is discarded
const url = flexUrl(window.location.href);
url.filter('status', 'published');        // returns a new instance, thrown away
url.toString();                           // no filter

// v2 — CORRECT
let url = flexUrl(window.location.href);
url = url.filter('status', 'published');
// or chain in one expression:
const url = flexUrl(window.location.href).filter('status', 'published');
```

**Rewrite rule:** any v1 statement of the form `url.<something>(...)` used for
its side effect must become an assignment. A bare expression statement calling a
v2 builder method is always a bug.

### 2. The pathname was dropped in v1 and is preserved again in v2

v0 preserved the pathname. **v1 regressed this** — `FlexibleUrl` kept only
`origin`, so `flexUrl('https://api.example.com/api/v1/posts').toString()`
returned `https://api.example.com?...`. v2 preserves pathname, port and hash.

If you wrote a workaround for the v1 behaviour, remove it:

```ts
// v1 workaround — delete this
router.visit(window.location.pathname + '?' + url.toString().split('?')[1]);

// v2
router.visit(url.toRelativeUrl());
```

The workaround still runs under v2 but is now redundant, yields
`/path?undefined` when no params are set, and mangles the hash.

### 3. `set()` vs `add()` no longer differ

In v1, `set()` was a no-op when the parameter did not already exist, and `add()`
was required to create one — a documented v1 behaviour, not a bug you can
ignore:

```ts
// v1: does nothing at all, params stays empty
url.queryParam('foo').set('bar');
```

v2 has one operation per concept. `filter()` upserts, `param()` upserts,
`include()`/`fields()`/ `append()` accumulate without duplicates. There is no
set/add distinction to carry over.

### 4. Malformed percent-escapes no longer throw

v0 and v1 both call `decodeURIComponent` unguarded while parsing, so **any** `%`
that is not a valid escape throws `URIError: URI malformed` from the
constructor:

```ts
flexUrl('https://x.com/p?name=20%');           // v0/v1: URIError
flexUrl('https://x.com/p?q=50%off');           // v0/v1: URIError
flexUrl('https://x.com/p?filter[status]=20%'); // v0/v1: URIError
```

v2 never throws while parsing: a `%` not followed by two hex digits is a literal
`%`, and bytes that are not valid UTF-8 become U+FFFD. **Remove any
`try`/`catch` wrapped around flex-url construction** that exists only to guard
against this — but keep the catch if it also guards something else.

### 5. An `=` inside a value is no longer truncated

v0 and v1 decode before splitting on `=`, so `?name=a=b` parses to `"a"` and the
rest is lost. This also affects v1's own output: it emits `a%3Db`, which it then
re-reads as `"a"` — v1 cannot round-trip its own URLs. v2 splits on the first
raw `=` and decodes afterwards, so `a=b` survives. Any downstream code that
compensated for the truncation should be removed.

### 6. A raw `+` in a query string now means a space

v2 parses `+` as a space and `%2B` as a literal plus, matching
`URLSearchParams`, HTML GET forms, PHP's `$_GET` and Laravel's
`Request::query()`. v0 and v1 treated a raw `+` as a literal plus, which
disagreed with what the server actually read.

Values you pass to the builder are unaffected — they are percent-encoded, so a
phone number `+34600123456` goes out as `%2B34600123456` and reads back
identically. Only a raw `+` already present in a URL string changes meaning, and
it changes *towards* what the backend was always seeing.

---

## v0 → v2 symbol map

Construction: `createFlexUrl(url)` → `flexUrl(url)` (or the `url()` alias).

| v0 | v2 | Notes |
|---|---|---|
| `createFlexUrl(u)` | `flexUrl(u)` | v2 also accepts a `URL`, a relative path, or nothing |
| `.host` | *(no equivalent)* | v2 keeps origin + pathname + hash internally; use `toString()` |
| `.params` | `.toParams()` | v0 exposed a mutable public object; v2 returns a fresh nested object |
| `.getQuery()` | `.toString()` | v0 returned only the `?query` part |
| `.getQuery(key)` | `.getParam(key)` | returns a `string[]` for a repeated param |
| `.hasQuery(key)` | `.getParam(key) !== undefined` | with a value, compare what `getParam()` returns |
| `.setQuery(k, v)` | `.param(k, v)` | upserts |
| `.addQuery(k, v)` | `.param(k, [v1, v2])` | v2 takes the full value list; repeated keys are emitted for arrays |
| `.removeQuery(k)` | `.removeParam(k)` | the function-predicate form has no equivalent |
| `.query(k, v, op)` | `.param(k, v)` | |
| `.filterBy(k, v)` | `.filter(k, v)` | see the AND/OR note above |
| `.orFilterBy(k, v)` | `.addFilterValue(k, v)` | appends to the attribute's list, like v0's OR did |
| `.hasFilter(k, v?)` | `.hasFilter(k)` | v2's takes an optional *operator*, not a value |
| `.getFilters()` | `u.getFilters().map(f => f.attribute)` | v0 returned attribute names; v2's returns full entries |
| `.getFiltersAsObject()` | `.getFilters()` | v2 returns `{attribute, operator, values}` entries rather than a keyed object — see the note below |
| `.replaceFilter(k, old, new)` | `.filter(k, newValues)` | v2 upserts; compute the new list yourself |
| `.replaceAllFilters(k, v)` | `.filter(k, v)` | |
| `.removeFilter(k)` | `.removeFilter(k)` | |
| `.removeFilter(k, value)` | `.removeFilterValue(k, value)` | **do not use `removeFilter(k, value)`**: v2's 2nd arg is an *operator*, so it matches nothing and silently does nothing |
| `.clearFilters()` | `.removeParam('filter')` | the `except` argument has no equivalent |
| `.sortBy(v)` / `.sortByAsc(v)` | `.sort(v)` | |
| `.sortByDesc(v)` | `.sortDesc(v)` or `.sort('-v')` | |
| `.getSortsAsArray()` | `.getSorts().map(s => s.direction === 'desc' ? '-' + s.attribute : s.attribute)` | |
| `.getSortsAsObject()` | `Object.fromEntries(u.getSorts().map(s => [s.attribute, s.direction]))` | |
| `.hasSort(v)` | `.getSorts().some(s => s.attribute === v)` | v0's used `indexOf` and matched substrings |
| `.clearSorts()` | `.removeParam('sort')` | |
| `.toString()` | `.toString()` | v2 output differs — see the wire format section |

`sortBy()` with no direction toggled asc/desc in v0. v2 has no toggle; read the
current direction with `getSorts()` and call `sort()`/`sortDesc()` accordingly.

`getFilters()` returns entries rather than the object v0's
`getFiltersAsObject()` produced, because an attribute can appear under several
operators (`filter[due][gte]`, `filter[due][lte]`), which a `Record` keyed by
attribute cannot represent. If you need the old shape for a UI that only ever
uses bracket-less filters:

```ts
Object.fromEntries(
  url.getFilters()
    .filter(entry => entry.operator === '')
    .map(entry => [
      entry.attribute,
      entry.values.length === 1 ? entry.values[0] : entry.values,
    ]),
);
```

Do not reach for `toParams().filter` instead: that is the wire form, so a
multi-value filter comes back comma-joined into a single string.

---

## v1 → v2 symbol map

Construction: `flexUrl(url)` keeps its name but changes package and semantics
(immutable).

| v1 | v2 |
|---|---|
| `flexUrl(u)` / `new FlexibleUrl(u)` | `flexUrl(u)` / `url(u)` — no `new`, no exported class to instantiate |
| `.params` (public, mutable) | `.toParams()` (fresh object) |
| `.clear()` | `.clear()` — returns a new instance |
| `.toString()` | `.toString()` — now includes the pathname |
| — | `.toRelativeUrl()` — `pathname?query#hash`, for `router.visit()`/`pushState` |
| — | `.toRequestUri()` — `pathname?query` |

### Query params

| v1 | v2 |
|---|---|
| `.queryParam(k).add(v)` | `.param(k, v)` |
| `.queryParam(k).set(v)` | `.param(k, v)` |
| `.queryParam(k).add(v, ['a','b'])` | *(no direct equivalent — modifiers were arbitrary bracket paths; use the grammar methods, or `param()` for a flat key)* |
| `.queryParam(k).remove()` | `.removeParam(k)` |
| `.queryParam(k).remove(v)` | `.param(k, remaining)` — read with `getParam(k)` first |
| `.queryParam(k).toggle(v)` | compute it: `u.getParam(k) === v ? u.removeParam(k) : u.param(k, v)` |
| `.queryParam(k).replace(fn)` | `.param(k, fn(u.getParam(k)))` |
| `.queryParam(k).append(s)` | `.param(k, u.getParam(k) + s)` |
| `.queryParam(k).withModifiers([...])` | *(no equivalent for writing; `removeParam('k[a][b]')` does remove a nested raw param)* |
| `.queryParams.has(k, v?)` | `.getParam(k) !== undefined` |
| `.queryParams.get(k)` | `.getParam(k)` — a plain value, not `{key, value}` |
| `.queryParams.all()` | `.toParams()` — **shape differs**: v1 returned `{'filter[hello]': [...]}`, v2 returns nested `{filter: {hello: ...}}` |

### Filters

| v1 | v2 |
|---|---|
| `.filter(k).add(v)` | `.filter(k, v)` |
| `.filter(k).set(v)` | `.filter(k, v)` |
| `.filter(k).add(a).or.add(b)` | `.addFilterValue(k, b)` |
| `.filter(k).add(a).add(b)` (AND) | no equivalent — see *Data compatibility* |
| `.filter(k).add(v, ['gte'])` | `.filter(k, 'gte', v)` — the operator is now a positional argument |
| `.filter(k).remove()` | `.removeFilter(k)` |
| `.filter(k).remove(v)` | `.removeFilterValue(k, v)` — removes the filter when the last value goes |
| `.filter(k).toggle(v)` | `.toggleFilterValue(k, v)` |
| `.filters.has(k, v?)` | `.hasFilter(k, operator?)` — **2nd arg is an operator now, not a value**; compare values with `getFilter()` |
| `.filters.get(k)` | `.getFilter(k)` — returns `string \| string[] \| undefined`, not `{modifiers, value}` |
| `.filters.all()` | `.getFilters()` — `{attribute, operator, values}` entries, not `{key: {modifiers, value}}` |
| `.filters.includes(k, v)` | `u.getFilters().some(f => f.attribute === k && f.values.includes(v))` |

### Sorts

| v1 | v2 |
|---|---|
| `.sort().asc.toggle(v)` | `.sort(v)` |
| `.sort().desc.toggle(v)` | `.sortDesc(v)` |
| `.sorts.all()` | `Object.fromEntries(u.getSorts().map(s => [s.attribute, s.direction]))` |
| `.sorts.has(v, dir)` | `.getSorts().some(s => s.attribute === v && s.direction === dir)` |
| `.sorts.byAsc(v)` | `.getSorts().some(s => s.attribute === v && s.direction === 'asc')` |
| `.sorts.byDesc(v)` | `.getSorts().some(s => s.attribute === v && s.direction === 'desc')` |

v1's `toggle` flipped the direction when the attribute was already sorted. v2
has no toggle; read `getSorts()` and pick the call.

---

## New in v2 (no v0/v1 equivalent)

These have no predecessor, so there is nothing to rewrite — but they often
replace hand-rolled code that a migration should delete:

- `between(attr, min, max)` — sugar for `gte` + `lte`
- `filterScope(name, args?, {scoped})` — apiable scope filters
- `include(...)`, `fields(type, ...)`, `append(type, ...)`
- `page(n)`, `pageSize(n)`, `pageCursor(c)` and
  `getPage()`/`getPageSize()`/`getPageCursor()`
- `search(term)`, `searchFilter(attr, values)`
- `addFilterValue(attr, value)`, `removeFilterValue(attr, value)` and
  `toggleFilterValue(attr, value)` — operate on one value of a multi-value
  filter instead of replacing the whole list, and removing the last value
  removes the filter. These are what the checkbox/chip UIs written against v0/v1
  were hand-rolling
- `getFilters()` — every filter as `{attribute, operator, values}` entries;
  `getParam(key)` — reads a raw param, with bracket syntax for nested ones
- `toParams()`, `toRelativeUrl()`, `toRequestUri()`
- Typed endpoint schemas: `flexUrl<S extends EndpointSchema>(path, schema?)`
- `flex-url/links` subpath: `links()`, `meta()`, `nextUrl()`, `prevUrl()`
- A PHP mirror (`open-southeners/flex-url` on Packagist) with identical method
  names and byte-identical wire behaviour

---

## Migration checklist

1. `npm install flex-url@^2`. The package name is unchanged, so nothing in your
   import statements has to move — and nothing will fail to compile to confirm
   the upgrade landed.
2. Rename the v0 entry point if you are on v0: `createFlexUrl` → `flexUrl`.
   Coming from v1 the name is already right, and the semantics underneath it are
   not (see step 3).
3. **Make every mutation an assignment.** Search for statements that call a
   builder method and discard the result — under v2 they are all no-ops.
4. Apply the symbol maps above.
5. Delete `try`/`catch` blocks that existed only to guard `URIError: URI
   malformed`.
6. Delete v1 pathname workarounds; use `toRelativeUrl()` for navigation.
7. Audit every two-argument `removeFilter` and `filters.has` call. In v2 the
   second argument of both is an **operator**, not a value, so a call that used
   to remove or match a value now silently matches nothing — it compiles, runs,
   and does nothing. Use `removeFilterValue(k, value)` to drop one value, and
   `getFilter(k)` to compare one.
8. Decide what to do about persisted v0/v1 URLs (see *Data compatibility*). If
   you store query strings, plan a rewrite of `%2C` → `,` inside filter values.
9. Check that your backend receives what you expect: the emitted query string
   changed, even where your call sites did not.

### Call sites worth grepping

```sh
grep -rn "createFlexUrl\|FlexibleUrl\|from 'flex-url'" src/
grep -rn "\.queryParam(\|\.filters\.\|\.sorts\.\|\.sort()\." src/   # v1 API
# v0 API
grep -rn "\.filterBy(\|\.orFilterBy(\|\.sortBy\|getFiltersAsObject" src/
# v1 pathname workaround
grep -rn "split('?')\[1\]" src/
```

### Verifying the result

The behaviours above are pinned by the shared fixture suite in
[`fixtures/cases.json`](fixtures/cases.json), which both the TypeScript and the
PHP package replay — see [`fixtures/SCHEMA.md`](fixtures/SCHEMA.md). If you are
unsure how v2 treats a particular URL, the fastest answer is to add a case there
and run both suites.
