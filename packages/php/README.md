# open-southeners/flex-url

An immutable, fluent URL builder/parser for the [Laravel Apiable](https://github.com/open-southeners/laravel-apiable)
request-query grammar — `filter`, `sort`, `include`, `fields`, `appends`, `page` and `q`. Zero
runtime dependencies. PHP mirror of [`flex-url`](../js) — method names and
wire semantics are kept identical on purpose.

```php
use function flex_url;

flex_url('https://api.example.com/posts')
    ->filter('status', 'published')
    ->sort('-created_at')
    ->include('tags', 'author')
    ->page(1)
    ->toString();
// => "https://api.example.com/posts?filter[status]=published&sort=-created_at&include=tags,author&page[number]=1"
```

## Install

This package isn't published to Packagist yet — until then, require it from the monorepo via a
[path repository](https://getcomposer.org/doc/05-repositories.md#path):

```json
{
    "repositories": [
        {"type": "path", "url": "path/to/flex-url/packages/php"}
    ],
    "require": {
        "open-southeners/flex-url": "dev-v2"
    }
}
```

## Why

- **Immutable**: every builder call returns a *new* `FlexUrl` instance. Nothing is ever mutated in
  place, so instances are safe to pass around, store, or reuse as a starting point for several
  requests.
- **Parse = build**: constructing from a URL hydrates the exact same state a builder produces —
  round-trip a URL through `FlexUrl::make($url)->toString()` and read it back with `getFilter()`,
  `getSorts()`, `getPage()`, etc. This is the vocabulary a server-driven table (e.g. Livewire) uses
  to restore its filters from an incoming request.
- **Full URL fidelity**: pathname, port, hash, and any existing query params are preserved.
- **Matches apiable's own encoding idiom**: brackets and commas are raw on the wire; individual
  values are percent-encoded. See [Encoding contract](#encoding-contract) below.
- **Framework-free**: no Laravel/Illuminate runtime dependency — `toQuery()`/`toRequestUri()` give
  you what you need to dispatch an in-kernel sub-request yourself.

## Quick start

```php
use OpenSoutheners\FlexUrl\FlexUrl;
// `flex_url()` is a global helper alias for `FlexUrl::make()`.

$built = FlexUrl::make('/posts')
    ->filter('status', ['published', 'draft'])       // filter[status]=published,draft
    ->filter('title', 'like', 'laravel')              // filter[title][like]=laravel
    ->between('due_at', '2024-01-01', '2024-01-31')   // filter[due_at][gte]=...&filter[due_at][lte]=...
    ->filterScope('overdue')                          // filter[overdue]=1
    ->filterScope('reviewedBy', ['user' => 42])       // filter[reviewedBy][user]=42
    ->sort('priority')->sortDesc('created_at')        // sort=priority,-created_at
    ->include('project', 'assignee.team')             // include=project,assignee.team
    ->fields('post', 'title', 'body')                 // fields[post]=title,body
    ->append('post', 'is_overdue')                    // appends[post]=is_overdue
    ->page(2)->pageSize(25)                           // page[number]=2&page[size]=25
    ->search('laravel')->searchFilter('status', 'published') // q=laravel&q[filter][status]=published
    ->param('debug', '1');                            // debug=1 (raw escape hatch)

$built->toString();
```

### Filter operators

`filter($attribute, $operator, $value)` accepts the canonical apiable operator keys — `equal`,
`like`, `gt`, `gte`, `lt`, `lte` — matching what `laravel-apiable` expects on the wire
(`filter[attr][equal]=value`). `eq` is also accepted as a DX alias for `equal` and always
normalises to it before reaching the URL, `toParams()`, or `hasFilter()`/`getFilter()`.

A plain `filter($attribute, $value)` (no operator) sends a bracket-less `filter[attribute]=value`,
matching whichever operator apiable has registered first for that attribute.

### Multi-value filters

`filter()` replaces an attribute's values. For the checkbox/chip UIs that build a list one value
at a time, three operations work on the values themselves:

```php
FlexUrl::make('/posts?filter[char]=A')->addFilterValue('char', 'B');     // filter[char]=A,B
FlexUrl::make('/posts?filter[char]=A,B')->removeFilterValue('char', 'B'); // filter[char]=A
FlexUrl::make('/posts?filter[char]=A')->removeFilterValue('char', 'A');   // filter dropped entirely
FlexUrl::make('/posts?filter[char]=A')->toggleFilterValue('char', 'A');   // present → removed
```

Removing the last value removes the filter, which is what "untick the last checkbox" should do.

They act on the plain (bracket-less) entry — a multi-value list and a comparison operator don't
combine. Note this is the distinction `removeFilter()` does *not* make: its second argument is an
**operator**, so `removeFilter('char', 'B')` matches nothing and silently changes nothing.

### Reading state back

```php
$parsed = FlexUrl::from($request->fullUrl());

$parsed->hasFilter('status');            // bool
$parsed->getFilter('status');            // string|list<string>|null
$parsed->getFilter('due_at', 'gte');     // reads a specific operator/scope-arg entry
$parsed->getSorts();                     // list<array{attribute: string, direction: string}>
$parsed->getIncludes();                  // list<string>
$parsed->getFields('post');              // list<string>|null
$parsed->getFields();                    // array<string, list<string>>
$parsed->getPage();                      // int|null
$parsed->getPageSize();                  // int|null
$parsed->getPageCursor();                // string|null
$parsed->getSearch();                    // string|null
$parsed->getSearchFilter('status');      // string|list<string>|null
$parsed->toParams();                     // nested array form, see below
```

Omitting `$operator` on `hasFilter()`/`getFilter()` checks/reads the plain (bracket-less)
`filter[attribute]=` entry specifically — not "any operator".

`getFilters()` returns every filter as `{attribute, operator, values}` entries, in wire order —
the plural counterpart to `getFilter()`. Entries rather than a keyed object, because an attribute
can appear more than once under different operators (`filter[due][gte]`, `filter[due][lte]`).

`getParam(key)` reads a raw param set with `param()`, with bracket syntax for a nested one
(`getParam('custom_sort[lang]')`). Grammar buckets are not raw params, so `getParam('filter')` is
`null` — use `getFilter()`/`getSorts()`/`getPage()` for those.

### `toParams()`

Returns a plain nested array mirroring the wire's bracket structure:

```php
FlexUrl::make('/posts')
    ->filter('status', 'published')
    ->filter('due_at', 'gte', '2024-01-01')
    ->filter('due_at', 'lte', '2024-01-31')
    ->sort('-created_at')
    ->page(2)
    ->toParams();
// [
//   'filter' => [
//     'status' => 'published',
//     'due_at' => ['gte' => '2024-01-01', 'lte' => '2024-01-31'],
//   ],
//   'sort' => '-created_at',
//   'page' => ['number' => '2'],
// ]
```

An attribute with both a plain and an operator-keyed entry is promoted to an array with the plain
value under the `''` key — this only happens if you mix `filter($attr, $value)` and
`filter($attr, $op, $value)` for the same attribute, which is unusual but representable.

### Removing / clearing

```php
FlexUrl::make('/posts')->filter('status', 'published')->removeFilter('status');       // drop one filter
FlexUrl::make('/posts')->filter('due_at', 'gte', '1')->removeFilter('due_at', 'gte'); // drop one operator entry
FlexUrl::make('/posts')->sort('title')->removeParam('sort');                          // clear a whole bucket
FlexUrl::make('/posts')->param('debug', '1')->removeParam('debug');                   // drop a raw param
FlexUrl::make('/posts')->filter('status', 'published')->clear();                      // drop everything
```

`removeParam($key)` clears an entire bucket when `$key` is one of `filter`, `sort`, `include`,
`fields`, `appends`, `page`, `q` — otherwise it removes a raw param set via `param()`.

`removeParam()` also reaches nested raw params — the custom, outside-the-grammar keys a URL may
carry. A bracketed key targets one entry; a bare key removes everything under it, the same rule
the bucket names follow:

```php
$u = FlexUrl::make('/posts?custom_sort[lang]=asc&custom_sort[dir]=desc');

$u->removeParam('custom_sort[lang]'); // "/posts?custom_sort[dir]=desc"
$u->removeParam('custom_sort');       // "/posts"
```

## Encoding contract

- Structural brackets (`filter[attr][op]`) and the comma that separates multiple values
  (`filter[status]=published,draft`) are emitted **raw**, matching apiable's own idiom and its
  generated pagination links.
- Every individual value is percent-encoded (matching JavaScript's `encodeURIComponent`, not raw
  `rawurlencode()`) *before* being joined into a list — a literal comma/bracket/space/`%`/`=`/`&`
  inside one value is always escaped, so it can never be confused with the raw commas/brackets
  used as structural separators.
- Parsing is the exact inverse and accepts **both** raw and percent-encoded brackets/commas on
  input — apiable's own pagination `links` use `page%5Bnumber%5D`.
- Parsing uses `application/x-www-form-urlencoded` semantics for the query string — what `$_GET`,
  `Request::query()`, `URLSearchParams` and HTML GET forms all do: a raw `+` decodes to a
  **space**, `%2B` to a literal plus. Serialising never emits `+` (a space is `%20`), so
  `FlexUrl::make($url)->toString()` always means the same thing to the server as `$url` did.
- Parsing never throws and never produces invalid UTF-8. A `%` that isn't followed by two hex
  digits is a literal `%`, and bytes that don't form valid UTF-8 become U+FFFD — so a stray
  `?name=%FF` can't make `json_encode()` fail or `response()->json()` throw "Malformed UTF-8
  characters". The TypeScript mirror runs the same steps over the same bytes, so both languages
  return identical strings for identical input — malformed input included.

```php
FlexUrl::make('/posts')->filter('title', 'a,b')->toString();
// "/posts?filter[title]=a%2Cb"  — the comma is part of the value, not a separator

FlexUrl::make('/posts')->filter('title', ['a,b', 'c'])->toString();
// "/posts?filter[title]=a%2Cb,c"  — first item's comma escaped, the separator comma stays raw

FlexUrl::make('/posts?filter[title]=a%2Cb')->getFilter('title'); // "a,b"
FlexUrl::make('http://x/y?page%5Bnumber%5D=2')->getPage();       // 2

FlexUrl::make('/posts?filter[discount]=20%')->getFilter('discount'); // "20%"  — literal, not a broken escape
FlexUrl::make('/posts?q=hello+world')->getSearch();                  // "hello world"
FlexUrl::make('/posts?q=C%2B%2B')->getSearch();                      // "C++"
```

A value you pass to the builder is always percent-encoded, so a leading `+` is safe: a phone
number goes out as `%2B` and parses back identically. The `+`-is-a-space rule only applies to a
raw `+` that was already on the wire — which is what `parse_str()` and `Request::query()` read it
as too, so flex-url never disagrees with the framework:

```php
FlexUrl::make('/contacts')->filter('phone', '+34600123456')->toString();
// "/contacts?filter[phone]=%2B34600123456"  — same as any <form> or URLSearchParams
FlexUrl::make('/contacts?filter[phone]=%2B34600123456')->getFilter('phone'); // "+34600123456"

FlexUrl::make('/contacts?filter[phone]=+34600123456')->getFilter('phone');   // " 34600123456"
// a hand-written raw "+" — parse_str() and Laravel read that as a space as well
```

## `search()` vs. `searchFilter()`

`search($term)` sets the top-level `q=term`. `searchFilter($attribute, $values)` narrows the
search via `q[filter][attribute]=`. A single value uses the plain key; **multiple** values use
apiable's repeated-`[]` `whereIn()` convention rather than a comma list:

```php
FlexUrl::make('/posts')->search('laravel')->searchFilter('status', 'published')->toString();
// "/posts?q=laravel&q[filter][status]=published"

FlexUrl::make('/posts')->search('laravel')->searchFilter('status', ['published', 'draft'])->toString();
// "/posts?q=laravel&q[filter][status][]=published&q[filter][status][]=draft"
```

## Server-driven tables: `toQuery()` and `toRequestUri()`

Neither method depends on illuminate/http, but both are shaped to match it — useful for dispatching
an in-kernel sub-request against an apiable endpoint from server-rendered UI (e.g. a Livewire
component driving `/api/v1/projects`):

```php
$flexUrl = FlexUrl::make('/api/v1/projects')->filter('status', 'active')->sort('name')->page(2);

$flexUrl->toQuery();
// ['filter' => ['status' => 'active'], 'sort' => 'name', 'page' => ['number' => '2']]
// — same shape `Illuminate\Http\Request::query()` would hold (built via `parse_str()`).

$flexUrl->toRequestUri();
// "/api/v1/projects?filter[status]=active&sort=name&page[number]=2"

$request = Illuminate\Http\Request::create($flexUrl->toRequestUri(), 'GET');
$response = app(Illuminate\Contracts\Http\Kernel::class)->handle($request);
```

`toQuery()` is the one method with no TypeScript counterpart: it is `parse_str()` semantics
(what Laravel itself will see), whereas `toParams()` is grammar-aware. Nothing in a browser asks
that question, so the TypeScript package doesn't answer it.

### `toRelativeUrl()` for redirects and `href`s

`toRequestUri()` drops the fragment, because fragments are never sent to the server. When you're
producing a link or a redirect target rather than a request, use `toRelativeUrl()` — same string,
fragment preserved, still no origin:

```php
$flexUrl = FlexUrl::make('https://app.example.com/projects#activity')->filter('status', 'active');

$flexUrl->toRelativeUrl(); // "/projects?filter[status]=active#activity"
$flexUrl->toRequestUri();  // "/projects?filter[status]=active"

return redirect()->to($flexUrl->toRelativeUrl());
```

The TypeScript package has the same method with the same semantics, for `router.visit()` and
`history.pushState()`.

## Accepting PSR-7 / requests

`FlexUrl::from()` accepts a plain `string` or anything `Stringable` — this covers PSR-7's
`UriInterface` (it declares `__toString(): string`, which PHP treats as implementing `Stringable`
automatically) without adding `psr/http-message` as a dependency:

```php
FlexUrl::from($psrUri);                 // any PSR-7 UriInterface
FlexUrl::from($request->fullUrl());     // Illuminate\Http\Request — pass the string, stay framework-free
```

## Migrating from the TypeScript package's 0.x / 1.x

This package has no 1.x line, but it shares v2's wire format. If you are moving a frontend off
`flex-url` 0.x/1.x at the same time, [MIGRATION.md](../../MIGRATION.md) documents the
query-string changes both sides must agree on.

## Test parity

This package is tested against the same [shared JSON fixtures](../../fixtures/SCHEMA.md) as the
TypeScript core, so the two implementations can't silently drift apart.
