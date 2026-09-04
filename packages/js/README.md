# flex-url

An immutable, fluent URL builder/parser for the [Laravel Apiable](https://github.com/open-southeners/laravel-apiable)
request-query grammar — `filter`, `sort`, `include`, `fields`, `appends`, `page` and `q`. Zero
runtime dependencies, ESM + CJS, full type declarations.

```ts
import {url} from 'flex-url';

url('https://api.example.com/posts')
  .filter('status', 'published')
  .sort('-created_at')
  .include('tags', 'author')
  .page(1)
  .toString();
// => "https://api.example.com/posts?filter[status]=published&sort=-created_at&include=tags,author&page[number]=1"
```

## Install

```bash
npm install flex-url
```

## Why

- **Immutable**: every builder call returns a *new* instance. Nothing is ever mutated in place,
  so instances are safe to pass around, store, or reuse as a starting point for several requests.
- **Parse = build**: constructing from a URL hydrates the exact same state a builder produces —
  round-trip a URL through `flexUrl(url).toString()` and read it back with `getFilter()`,
  `getSorts()`, `getPage()`, etc. This is the vocabulary a data table uses to restore its filters
  from the address bar on page load.
- **Full URL fidelity**: pathname, port, hash, and any existing query params are preserved.
- **Matches apiable's own encoding idiom**: brackets and commas are raw on the wire; individual
  values are percent-encoded. See [Encoding contract](#encoding-contract) below.

## Quick start

```ts
import {flexUrl} from 'flex-url';
// `url` is an alias for `flexUrl`.

const built = flexUrl('/posts')
  .filter('status', ['published', 'draft'])       // filter[status]=published,draft
  .filter('title', 'like', 'laravel')              // filter[title][like]=laravel
  .between('due_at', '2024-01-01', '2024-01-31')   // filter[due_at][gte]=...&filter[due_at][lte]=...
  .filterScope('overdue')                          // filter[overdue]=1
  .filterScope('reviewedBy', {user: 42})           // filter[reviewedBy][user]=42
  .sort('priority').sortDesc('created_at')         // sort=priority,-created_at
  .include('project', 'assignee.team')             // include=project,assignee.team
  .fields('post', 'title', 'body')                 // fields[post]=title,body
  .append('post', 'is_overdue')                    // appends[post]=is_overdue
  .page(2).pageSize(25)                            // page[number]=2&page[size]=25
  .search('laravel').searchFilter('status', 'published') // q=laravel&q[filter][status]=published
  .param('debug', '1');                            // debug=1 (raw escape hatch)

built.toString();
```

### Filter operators

`filter(attribute, operator, value)` accepts the canonical apiable operator keys — `equal`,
`like`, `gt`, `gte`, `lt`, `lte` — matching what `laravel-apiable` expects on the wire
(`filter[attr][equal]=value`). `eq` is also accepted as a DX alias for `equal` and always
normalises to it before reaching the URL, `toParams()`, or a schema's operator list.

A plain `filter(attribute, value)` (no operator) sends a bracket-less `filter[attribute]=value`,
matching whichever operator apiable has registered first for that attribute.

### Multi-value filters

`filter()` replaces an attribute's values. For the checkbox/chip UIs that build a list one value
at a time, three operations work on the values themselves:

```ts
flexUrl('/posts?filter[char]=A').addFilterValue('char', 'B');     // filter[char]=A,B
flexUrl('/posts?filter[char]=A,B').removeFilterValue('char', 'B'); // filter[char]=A
flexUrl('/posts?filter[char]=A').removeFilterValue('char', 'A');   // filter dropped entirely
flexUrl('/posts?filter[char]=A').toggleFilterValue('char', 'A');   // present → removed
```

Removing the last value removes the filter, which is what "untick the last checkbox" should do.

They act on the plain (bracket-less) entry — a multi-value list and a comparison operator don't
combine. Note this is the distinction `removeFilter()` does *not* make: its second argument is an
**operator**, so `removeFilter('char', 'B')` matches nothing and silently changes nothing.

### Reading state back

```ts
const parsed = flexUrl(window.location.href);

parsed.hasFilter('status');            // boolean
parsed.getFilter('status');            // string | string[] | undefined
parsed.getFilter('due_at', 'gte');     // reads a specific operator/scope-arg entry
parsed.getSorts();                     // Array<{attribute: string; direction: 'asc' | 'desc'}>
parsed.getIncludes();                  // string[]
parsed.getFields('post');              // string[] | undefined
parsed.getFields();                    // Record<string, string[]>
parsed.getPage();                      // number | undefined
parsed.getPageSize();                  // number | undefined
parsed.getPageCursor();                // string | undefined
parsed.getSearch();                    // string | undefined
parsed.getSearchFilter('status');      // string | string[] | undefined
parsed.toParams();                     // nested object form, see below

parsed.toString();                     // full URL, origin included — the round-trip form
parsed.toRelativeUrl();                // "pathname?query#hash" — for client-side navigation
parsed.toRequestUri();                 // "pathname?query" — what reaches the server
```

Omitting `operator` on `hasFilter()`/`getFilter()` checks/reads the plain (bracket-less)
`filter[attribute]=` entry specifically — not "any operator".

`getFilters()` returns every filter as `{attribute, operator, values}` entries, in wire order —
the plural counterpart to `getFilter()`. Entries rather than a keyed object, because an attribute
can appear more than once under different operators (`filter[due][gte]`, `filter[due][lte]`).

`getParam(key)` reads a raw param set with `param()`, with bracket syntax for a nested one
(`getParam('custom_sort[lang]')`). Grammar buckets are not raw params, so `getParam('filter')` is
`undefined` — use `getFilter()`/`getSorts()`/`getPage()` for those.

### `toParams()`

Returns a plain nested object mirroring the wire's bracket structure:

```ts
flexUrl('/posts')
  .filter('status', 'published')
  .filter('due_at', 'gte', '2024-01-01')
  .filter('due_at', 'lte', '2024-01-31')
  .sort('-created_at')
  .page(2)
  .toParams();
// {
//   filter: {
//     status: 'published',
//     due_at: {gte: '2024-01-01', lte: '2024-01-31'},
//   },
//   sort: '-created_at',
//   page: {number: '2'},
// }
```

An attribute with both a plain and an operator-keyed entry is promoted to an object with the
plain value under the `''` key (e.g. `{status: {'': 'published', equal: 'archived'}}`) — this
only happens if you mix `filter(attr, value)` and `filter(attr, op, value)` for the same
attribute, which is unusual but representable.

### Removing / clearing

```ts
flexUrl('/posts').filter('status', 'published').removeFilter('status');       // drop one filter
flexUrl('/posts').filter('due_at', 'gte', '1').removeFilter('due_at', 'gte'); // drop one operator entry
flexUrl('/posts').sort('title').removeParam('sort');                          // clear a whole bucket
flexUrl('/posts').param('debug', '1').removeParam('debug');                   // drop a raw param
flexUrl('/posts').filter('status', 'published').clear();                     // drop everything
```

`removeParam(key)` clears an entire bucket when `key` is one of `filter`, `sort`, `include`,
`fields`, `appends`, `page`, `q` — otherwise it removes a raw param set via `param()`.

`removeParam()` also reaches nested raw params — the custom, outside-the-grammar keys a URL may
carry. A bracketed key targets one entry; a bare key removes everything under it, the same rule
the bucket names follow:

```ts
const u = flexUrl('/posts?custom_sort[lang]=asc&custom_sort[dir]=desc');

u.removeParam('custom_sort[lang]'); // "/posts?custom_sort[dir]=desc"
u.removeParam('custom_sort');       // "/posts"
```

## Typed schemas

`flexUrl<S extends EndpointSchema>(path, schema?)` narrows `filter()`/`sort()`/`include()`/
`fields()`/`append()` arguments to a specific endpoint's allowed vocabulary at compile time.
`EndpointSchema` is the shared contract generated by apiable's `apiable:types` exporter:

```ts
import {flexUrl, type EndpointSchema} from 'flex-url';

interface IssuesSchema extends EndpointSchema {
  resource: 'issues';
  path: '/api/v1/issues';
  filters: {
    status: {operators: ['equal']; values: ['open', 'closed']};
    due_at: {operators: ['gte', 'lte']};
  };
  sorts: ['priority', 'due_at'];
  includes: ['project', 'assignee'];
  fields: {issues: ['title', 'status', 'priority']};
  appends: {issues: ['is_overdue']};
}

// S is inferred from the `schema` argument — no explicit generic needed.
const issues = flexUrl('/api/v1/issues', issuesSchema);

issues.filter('status', 'open');   // OK
issues.filter('budget', '100');    // compile error: "budget" isn't in IssuesSchema['filters']

// Or narrow with an explicit generic and no runtime schema object:
const alsoIssues = flexUrl<IssuesSchema>('/api/v1/issues');
```

Passing a runtime `schema` object additionally enables dev-mode diagnostics: an unrecognised
filter/sort/include/fields/appends call logs a `console.warn` (it never throws or changes
behaviour) — useful for catching a typo that an untyped call site wouldn't catch at compile time.
Omit the schema argument (explicit-generic-only usage) to skip these warnings entirely.

## Encoding contract

- Structural brackets (`filter[attr][op]`) and the comma that separates multiple values
  (`filter[status]=published,draft`) are emitted **raw**, matching apiable's own idiom and its
  generated pagination links.
- Every individual value is percent-encoded (via `encodeURIComponent`) *before* being joined into
  a list — a literal comma/bracket/space/`%`/`=`/`&` inside one value is always escaped, so it can
  never be confused with the raw commas/brackets used as structural separators.
- Parsing is the exact inverse and accepts **both** raw and percent-encoded brackets/commas on
  input — apiable's own pagination `links` use `page%5Bnumber%5D`.
- Parsing uses `application/x-www-form-urlencoded` semantics for the query string — what
  `URLSearchParams`, HTML GET forms, PHP's `$_GET` and Laravel's `Request::query()` all do: a raw
  `+` decodes to a **space**, `%2B` to a literal plus. Serialising never emits `+` (a space is
  `%20`), so `flexUrl(url).toString()` always means the same thing to the server as `url` did.
- Parsing never throws and never produces invalid UTF-8. A `%` that isn't followed by two hex
  digits is a literal `%`, and bytes that don't form valid UTF-8 become U+FFFD. The PHP mirror
  runs the same steps over the same bytes, so both languages return identical strings for
  identical input — malformed input included.

```ts
flexUrl('/posts').filter('title', 'a,b').toString();
// "/posts?filter[title]=a%2Cb"  — the comma is part of the value, not a separator

flexUrl('/posts').filter('title', ['a,b', 'c']).toString();
// "/posts?filter[title]=a%2Cb,c"  — first item's comma escaped, the separator comma stays raw

flexUrl('/posts?filter[title]=a%2Cb').getFilter('title'); // "a,b"
flexUrl('http://x/y?page%5Bnumber%5D=2').getPage();        // 2

flexUrl('/posts?filter[discount]=20%').getFilter('discount'); // "20%"   — literal, not a broken escape
flexUrl('/posts?q=hello+world').getSearch();                  // "hello world"
flexUrl('/posts?q=C%2B%2B').getSearch();                      // "C++"
```

A value you pass to the builder is always percent-encoded, so a leading `+` is safe: a phone
number goes out as `%2B` and parses back identically. The `+`-is-a-space rule only applies to a
raw `+` that was already on the wire — which is what the server reads it as too, so flex-url and
`Request::query()` never disagree:

```ts
flexUrl('/contacts').filter('phone', '+34600123456').toString();
// "/contacts?filter[phone]=%2B34600123456"  — same as URLSearchParams and any <form>
flexUrl('/contacts?filter[phone]=%2B34600123456').getFilter('phone'); // "+34600123456"

flexUrl('/contacts?filter[phone]=+34600123456').getFilter('phone');   // " 34600123456"
// a hand-written raw "+" — PHP's parse_str() and Laravel read that as a space as well
```

## `search()` vs. `searchFilter()`

`search(term)` sets the top-level `q=term`. `searchFilter(attribute, values)` narrows the search
via `q[filter][attribute]=`. A single value uses the plain key; **multiple** values use apiable's
repeated-`[]` `whereIn()` convention rather than a comma list (this differs from the rest of the
grammar — apiable's own search-filter parsing expects it):

```ts
flexUrl('/posts').search('laravel').searchFilter('status', 'published').toString();
// "/posts?q=laravel&q[filter][status]=published"

flexUrl('/posts').search('laravel').searchFilter('status', ['published', 'draft']).toString();
// "/posts?q=laravel&q[filter][status][]=published&q[filter][status][]=draft"
```

## JSON:API `links`/`meta` helper

Kept at a separate entry point so it's tree-shaken out when you only need the URL builder:

```ts
import {links, meta, nextUrl, prevUrl} from 'flex-url/links';

const response = await fetch('/api/v1/posts', {headers: {Accept: 'application/vnd.api+json'}});
const document = await response.json();

links(document);   // {first, last, prev, next} — each string | null
meta(document);     // {current_page, per_page, total, ...} — apiable's pagination meta
nextUrl(document);  // FlexUrl | null — parsed straight from links.next
prevUrl(document);  // FlexUrl | null — parsed straight from links.prev

nextUrl(document)?.getPageCursor(); // works for cursor pagination too
```

Works with apiable's three pagination strategies: length-aware (full `links`/`meta`), simple
(`links.last`/`meta.total`/`meta.last_page` are `null`/absent), and cursor (`links.first`/
`links.last`/`meta.current_page`/`meta.total` are `null`/absent). No resource deserialisation —
pair this with a JSON:API client such as [jsona](https://github.com/olosegres/jsona) for `data`/
`included`.

## Navigating with the result (Inertia, vue-router, history API)

`toString()` renders the full URL — origin included, when you started from one — and is the
round-trip form. For client-side navigation use `toRelativeUrl()` (`pathname?query#hash`, never
the origin), which is what `router.visit()`, `history.pushState()` and vue-router expect:

```ts
const next = flexUrl(window.location.href).filter('status', 'active').page(1);

router.visit(next.toRelativeUrl(), {preserveState: true, preserveScroll: true}); // Inertia
history.replaceState(null, '', next.toRelativeUrl());                            // history API
router.push(next.toRelativeUrl());                                               // vue-router
```

`history.pushState()`/`replaceState()` throw a `SecurityError` when the origin differs from the
document's — which is what happens as soon as you build from an API URL
(`flexUrl('https://api.example.com/posts')`) and want the app's own address bar to reflect the
filters. `toRelativeUrl()` has no origin to clash.

Pass every parameter through flex-url rather than Inertia's `data` option: `router.visit(url,
{data})` re-serialises the whole query string through `qs`, which percent-encodes the commas
apiable expects raw.

`toRequestUri()` is the same string without the fragment (`pathname?query`) — the part that
actually reaches the server — and mirrors the PHP package's `toRequestUri()`.

## Upgrading from 0.x / 1.x

Full symbol-by-symbol migration guide, including the wire-format changes and what happens to
URLs your users have already bookmarked: [MIGRATION.md](../../MIGRATION.md).

v1's `FlexibleUrl` kept only the origin of the URL you constructed it from, so
`router.visit(url.toString())` navigated to `/`. If you worked around that with something like

```ts
router.visit(window.location.pathname + '?' + url.toString().split('?')[1]);
```

replace it with `router.visit(url.toRelativeUrl())`. The workaround still runs on v2, but it is
now redundant (the pathname is preserved), it produces `/path?undefined` when no parameters are
set, and it mangles the hash.

## PHP mirror

A PHP port with identical method names/semantics lives alongside this package at
`packages/php` (`open-southeners/flex-url` on Packagist) for server-driven tables (e.g. Livewire).
Both implementations are tested against the same [shared JSON fixtures](../../fixtures/SCHEMA.md)
so they can't silently drift apart.
