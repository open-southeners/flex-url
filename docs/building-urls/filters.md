---
description: Build filter[] query parameters, including operators, scoped filters, and multi-value lists.
---

# Filters

## Basic filters

A plain `filter(attribute, value)` (no operator) sends a bracket-less `filter[attribute]=value`,
matching whichever operator apiable has registered first for that attribute.

{% tabs %}
{% tab title="TypeScript" %}
```ts
flexUrl('/posts').filter('status', 'published');
// /posts?filter[status]=published

flexUrl('/posts').filter('status', ['published', 'draft']);
// /posts?filter[status]=published,draft
```
{% endtab %}

{% tab title="PHP" %}
```php
FlexUrl::make('/posts')->filter('status', 'published');
// /posts?filter[status]=published

FlexUrl::make('/posts')->filter('status', ['published', 'draft']);
// /posts?filter[status]=published,draft
```
{% endtab %}
{% endtabs %}

`filter()` **replaces** an attribute's values on every call — see
[Multi-value filters](#multi-value-filters) below for the accumulating operations.

## Operators

`filter(attribute, operator, value)` accepts the canonical apiable operator keys — matching what
`laravel-apiable` expects on the wire (`filter[attr][equal]=value`):

| Operator | Wire key |
|---|---|
| Equal | `equal` |
| Like | `like` |
| Greater than | `gt` |
| Greater than or equal | `gte` |
| Less than | `lt` |
| Less than or equal | `lte` |
| Not equal | `not_equal` |
| Not like | `not_like` |

{% hint style="info" %}
`eq` and `neq` are accepted as DX aliases for `equal` and `not_equal`, and always normalise to
the long form before reaching the URL, `toParams()`, or a schema's operator list — sending an
alias on the wire is dropped by apiable as an unregistered operator key, so flex-url never
emits one.
{% endhint %}

{% hint style="warning" %}
`not_equal` and `not_like` are part of this grammar, but your backend still has to register
them for the attribute like any other operator. An operator key that isn't registered is
**rejected**, not applied — so the filter is dropped (or the request fails validation) rather
than silently matching the wrong rows. Check the server side before reaching for them.
{% endhint %}

{% tabs %}
{% tab title="TypeScript" %}
```ts
flexUrl('/posts').filter('status', 'not_equal', 'draft');
// /posts?filter[status][not_equal]=draft

flexUrl('/posts').filter('status', 'neq', 'draft');
// /posts?filter[status][not_equal]=draft — the alias never reaches the wire
```
{% endtab %}

{% tab title="PHP" %}
```php
FlexUrl::make('/posts')->filter('status', 'not_equal', 'draft');
// /posts?filter[status][not_equal]=draft

FlexUrl::make('/posts')->filter('status', 'neq', 'draft');
// /posts?filter[status][not_equal]=draft — the alias never reaches the wire
```
{% endtab %}
{% endtabs %}

{% hint style="warning" %}
A negated operator with several values is worth thinking about twice. apiable combines the
values of one comma list with `OR`, so `filter[status][not_equal]=draft,archived` asks for
`status != 'draft' OR status != 'archived'` — true for every row. Negation needs the values
combined with `AND` instead (De Morgan), which is a server-side concern flex-url cannot fix from
the URL. Send one value per negated filter until your backend states otherwise.
{% endhint %}

{% tabs %}
{% tab title="TypeScript" %}
```ts
flexUrl('/posts').filter('title', 'like', 'laravel');
// /posts?filter[title][like]=laravel

flexUrl('/posts').filter('price', 'eq', 100);
// /posts?filter[price][equal]=100
```
{% endtab %}

{% tab title="PHP" %}
```php
FlexUrl::make('/posts')->filter('title', 'like', 'laravel');
// /posts?filter[title][like]=laravel

FlexUrl::make('/posts')->filter('price', 'eq', 100);
// /posts?filter[price][equal]=100
```
{% endtab %}
{% endtabs %}

### Range filters with `between()`

`between(attribute, min, max)` is sugar for `filter(attribute, 'gte', min).filter(attribute, 'lte', max)`:

{% tabs %}
{% tab title="TypeScript" %}
```ts
flexUrl('/posts').between('due_at', '2024-01-01', '2024-01-31');
// /posts?filter[due_at][gte]=2024-01-01&filter[due_at][lte]=2024-01-31
```
{% endtab %}

{% tab title="PHP" %}
```php
FlexUrl::make('/posts')->between('due_at', '2024-01-01', '2024-01-31');
// /posts?filter[due_at][gte]=2024-01-01&filter[due_at][lte]=2024-01-31
```
{% endtab %}
{% endtabs %}

## Scoped filters

`filterScope()` targets apiable's `AllowedFilter::scoped()` filters. Called with no arguments, it
sends a truthy toggle (`filter[name]=1`); called with named arguments, it sends them as
scope sub-parameters:

{% tabs %}
{% tab title="TypeScript" %}
```ts
flexUrl('/posts').filterScope('overdue');
// /posts?filter[overdue]=1

flexUrl('/posts').filterScope('between', {min: 10, max: 50});
// /posts?filter[between][min]=10&filter[between][max]=50
```
{% endtab %}

{% tab title="PHP" %}
```php
FlexUrl::make('/posts')->filterScope('overdue');
// /posts?filter[overdue]=1

FlexUrl::make('/posts')->filterScope('between', ['min' => 10, 'max' => 50]);
// /posts?filter[between][min]=10&filter[between][max]=50
```
{% endtab %}
{% endtabs %}

Pass `{scoped: true}` (TS) / `['scoped' => true]` (PHP) as the third argument to append the
`_scoped` suffix apiable's `requests.filters.enforce_scoped_names` config expects:

{% tabs %}
{% tab title="TypeScript" %}
```ts
flexUrl('/posts').filterScope('published', undefined, {scoped: true});
// /posts?filter[published_scoped]=1
```
{% endtab %}

{% tab title="PHP" %}
```php
FlexUrl::make('/posts')->filterScope('published', null, ['scoped' => true]);
// /posts?filter[published_scoped]=1
```
{% endtab %}
{% endtabs %}

## Multi-value filters

`filter()` replaces an attribute's values. For the checkbox/chip UIs that build a list one value
at a time, three operations work on the values themselves instead:

{% tabs %}
{% tab title="TypeScript" %}
```ts
flexUrl('/posts?filter[char]=A').addFilterValue('char', 'B');     // filter[char]=A,B
flexUrl('/posts?filter[char]=A,B').removeFilterValue('char', 'B'); // filter[char]=A
flexUrl('/posts?filter[char]=A').removeFilterValue('char', 'A');   // filter dropped entirely
flexUrl('/posts?filter[char]=A').toggleFilterValue('char', 'A');   // present → removed
```
{% endtab %}

{% tab title="PHP" %}
```php
FlexUrl::make('/posts?filter[char]=A')->addFilterValue('char', 'B');     // filter[char]=A,B
FlexUrl::make('/posts?filter[char]=A,B')->removeFilterValue('char', 'B'); // filter[char]=A
FlexUrl::make('/posts?filter[char]=A')->removeFilterValue('char', 'A');   // filter dropped entirely
FlexUrl::make('/posts?filter[char]=A')->toggleFilterValue('char', 'A');   // present → removed
```
{% endtab %}
{% endtabs %}

Removing the last value removes the filter entirely, which is what "untick the last checkbox"
should do.

{% hint style="warning" %}
These three operations act on the **plain (bracket-less) entry** — a multi-value list and a
comparison operator don't combine. This is the distinction `removeFilter()` does *not* make: its
second argument is an **operator**, so `removeFilter('char', 'B')` matches nothing and silently
changes nothing. Use `removeFilterValue()` to drop a value from the list.
{% endhint %}

## Removing filters

`removeFilter(attribute, operator?)` removes a filter. Omit `operator` to remove every
operator/scope-arg entry for the attribute:

{% tabs %}
{% tab title="TypeScript" %}
```ts
flexUrl('/posts').filter('status', 'published').removeFilter('status');       // drop one filter
flexUrl('/posts').filter('due_at', 'gte', '1').removeFilter('due_at', 'gte'); // drop one operator entry
```
{% endtab %}

{% tab title="PHP" %}
```php
FlexUrl::make('/posts')->filter('status', 'published')->removeFilter('status');       // drop one filter
FlexUrl::make('/posts')->filter('due_at', 'gte', '1')->removeFilter('due_at', 'gte'); // drop one operator entry
```
{% endtab %}
{% endtabs %}

See [Raw Params & Clearing](raw-params-and-clearing.md) for clearing the whole `filter` bucket at
once, or every param on the builder.

## Reading filters back

`hasFilter()`, `getFilter()`, and `getFilters()` read filters off a parsed URL — see
[Reading State Back](../reading-urls/reading-state.md#filters).
