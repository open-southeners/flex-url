<?php

declare(strict_types=1);

namespace OpenSoutheners\FlexUrl;

use OpenSoutheners\FlexUrl\Internal\Encoding;
use OpenSoutheners\FlexUrl\Internal\Input;
use OpenSoutheners\FlexUrl\Internal\State;
use Stringable;

/**
 * `open-southeners/flex-url` — an immutable, fluent URL builder/parser for
 * the apiable request-query grammar (`filter`, `sort`, `include`, `fields`,
 * `appends`, `page`, `q`). PHP mirror of `@open-southeners/flex-url`'s
 * `FlexUrl` class — method names/semantics are kept identical on purpose, see
 * `packages/js/src/flex-url.ts`.
 *
 * ```php
 * use function OpenSoutheners\FlexUrl\flex_url;
 *
 * flex_url('https://api.example.com/posts')
 *     ->filter('status', 'published')
 *     ->sort('-created_at')
 *     ->include('tags', 'author')
 *     ->page(1)
 *     ->toString();
 * // => "https://api.example.com/posts?filter[status]=published&sort=-created_at&include=tags,author&page[number]=1"
 * ```
 *
 * Every mutator returns a *new* instance — the receiver is never modified.
 *
 * `State`, `Encoding` and `Input` are stateless functional cores called
 * statically by design (see their own docblocks), so PHPMD's StaticAccess rule
 * does not apply here. Declaring that once keeps it from re-reporting on
 * whichever lines a given pull request happens to touch.
 *
 * @phpstan-import-type FilterEntry from State
 *
 * @SuppressWarnings("PHPMD.StaticAccess")
 */
final readonly class FlexUrl implements Stringable
{
    private function __construct(private State $state) {}

    /**
     * Creates a `FlexUrl` builder/parser.
     *
     * - `FlexUrl::make()` — a bare builder that renders just a query string.
     * - `FlexUrl::make('/posts')` / `FlexUrl::make('https://api.example.com/posts?foo=bar')`
     *   — hydrates from a path or full URL (pathname/port/hash/existing params
     *   all preserved — "parse = build").
     */
    public static function make(?string $url = null): self
    {
        return self::from($url ?? '');
    }

    /**
     * Builds/parses from a string or any `Stringable` value — this covers
     * PSR-7's `UriInterface` (it declares `__toString(): string`, which PHP
     * treats as implementing `Stringable` automatically) without requiring
     * `psr/http-message` as a dependency. For `Illuminate\Http\Request`,
     * pass `$request->fullUrl()` — flex-url stays framework-free.
     */
    public static function from(string|Stringable $input): self
    {
        $parts = Input::parse((string) $input);
        $state = State::hydrateFromSearch(
            State::empty($parts['origin'], $parts['pathname'], $parts['hash']),
            $parts['search'],
        );

        return new self($state);
    }

    private function withState(State $state): self
    {
        return new self($state);
    }

    // ---------------------------------------------------------------------
    // Filters
    // ---------------------------------------------------------------------

    /**
     * `filter($attribute, $value)` sends a bracket-less `filter[attribute]=value`.
     * `filter($attribute, $operator, $value)` sends `filter[attribute][operator]=value`
     * using the canonical apiable operator keys (`equal`, `like`, `gt`, `gte`,
     * `lt`, `lte` — `eq` is accepted as an alias for `equal`).
     *
     * @param  string|int|bool|list<string|int|bool>  $operatorOrValue
     * @param  string|int|bool|list<string|int|bool>|null  $value
     */
    public function filter(string $attribute, string|int|bool|array $operatorOrValue, string|int|bool|array|null $value = null): self
    {
        if ($value !== null) {
            /** @var string $operatorOrValue */
            $operator = self::normaliseOperator($operatorOrValue);
            $values = self::toValueList($value);
        } else {
            $operator = '';
            $values = self::toValueList($operatorOrValue);
        }

        return $this->withState(State::setFilter($this->state, $attribute, $operator, $values));
    }

    /** Sugar for `filter($attribute, 'gte', $min)->filter($attribute, 'lte', $max)`. */
    public function between(string $attribute, string|int|bool $min, string|int|bool $max): self
    {
        $withMin = State::setFilter($this->state, $attribute, 'gte', [self::stringifyScalar($min)]);
        $withBoth = State::setFilter($withMin, $attribute, 'lte', [self::stringifyScalar($max)]);

        return $this->withState($withBoth);
    }

    /**
     * Scoped filter: `filterScope('published')` sends a truthy toggle
     * (`filter[published]=1`); `filterScope('between', ['min' => 10, 'max' => 50])`
     * sends named scope arguments (`filter[between][min]=10&...`). Pass
     * `['scoped' => true]` as `$options` to append the `_scoped` suffix
     * apiable's `enforce_scoped_names` config expects (`filter[published_scoped]=1`).
     *
     * @param  array<string, string|int|bool>|null  $args
     * @param  array{scoped?: bool}  $options
     */
    public function filterScope(string $name, ?array $args = null, array $options = []): self
    {
        $scopedName = ($options['scoped'] ?? false) ? "{$name}_scoped" : $name;

        if ($args === null) {
            return $this->withState(State::setFilter($this->state, $scopedName, '', ['1']));
        }

        $state = $this->state;

        foreach ($args as $key => $value) {
            $state = State::setFilter($state, $scopedName, $key, [self::stringifyScalar($value)]);
        }

        return $this->withState($state);
    }

    /**
     * Removes a filter. Omit `$operator` to remove every operator/scope-arg
     * entry for the attribute. `$operator` isn't narrowed to the comparison
     * operators because it also has to accept `filterScope()` named-argument
     * keys (e.g. `"min"`).
     */
    public function removeFilter(string $attribute, ?string $operator = null): self
    {
        $op = $operator === null ? null : self::normaliseOperator($operator);

        return $this->withState(State::removeFilter($this->state, $attribute, $op));
    }

    /**
     * Adds one or more values to a filter's existing list rather than
     * replacing it (`filter[char]=A` + `B` -> `filter[char]=A,B`), creating the
     * filter when absent and skipping values already present.
     *
     * `filter()` replaces; this accumulates. Operates on the plain
     * (bracket-less) entry — a multi-value list and a comparison operator
     * don't combine.
     *
     * @param  string|int|bool|list<string|int|bool>  $value
     */
    public function addFilterValue(string $attribute, string|int|bool|array $value): self
    {
        return $this->withState(State::addFilterValues($this->state, $attribute, self::toValueList($value)));
    }

    /**
     * Drops one or more values from a filter's list, removing the filter
     * entirely once nothing is left.
     *
     * This is the "remove one chip" operation. Note it is *not* what
     * `removeFilter()` does: that one's second argument is an operator, so
     * `removeFilter($attribute, $someValue)` silently matches nothing.
     *
     * @param  string|int|bool|list<string|int|bool>  $value
     */
    public function removeFilterValue(string $attribute, string|int|bool|array $value): self
    {
        return $this->withState(State::removeFilterValues($this->state, $attribute, self::toValueList($value)));
    }

    /** Adds the value if the filter doesn't already carry it, removes it if it does. */
    public function toggleFilterValue(string $attribute, string|int|bool $value): self
    {
        $values = [];

        foreach ($this->state->filters as $entry) {
            if ($entry['attribute'] === $attribute && $entry['operator'] === '') {
                $values = $entry['values'];
                break;
            }
        }

        return in_array(self::stringifyScalar($value), $values, true)
            ? $this->removeFilterValue($attribute, $value)
            : $this->addFilterValue($attribute, $value);
    }

    // ---------------------------------------------------------------------
    // Sorts
    // ---------------------------------------------------------------------

    /** `sort('title')` sorts ascending, `sort('-title')` descending. Repeated calls accumulate. */
    public function sort(string $attribute): self
    {
        $descending = str_starts_with($attribute, '-');
        $bareAttribute = $descending ? substr($attribute, 1) : $attribute;

        return $this->withState(State::setSort($this->state, $bareAttribute, $descending ? 'desc' : 'asc'));
    }

    public function sortDesc(string $attribute): self
    {
        return $this->sort("-{$attribute}");
    }

    // ---------------------------------------------------------------------
    // Includes / fields / appends
    // ---------------------------------------------------------------------

    public function include(string ...$relationships): self
    {
        return $this->withState(State::addIncludes($this->state, array_values($relationships)));
    }

    public function fields(string $type, string ...$columns): self
    {
        return $this->withState(State::addFields($this->state, $type, array_values($columns)));
    }

    /** Note the plural `appends[type]=` wire key. */
    public function append(string $type, string ...$accessors): self
    {
        return $this->withState(State::addAppends($this->state, $type, array_values($accessors)));
    }

    // ---------------------------------------------------------------------
    // Pagination
    // ---------------------------------------------------------------------

    public function page(int|string $number): self
    {
        return $this->withState(State::setPage($this->state, 'number', (string) $number));
    }

    public function pageSize(int|string $size): self
    {
        return $this->withState(State::setPage($this->state, 'size', (string) $size));
    }

    public function pageCursor(string $cursor): self
    {
        return $this->withState(State::setPage($this->state, 'cursor', $cursor));
    }

    // ---------------------------------------------------------------------
    // Search
    // ---------------------------------------------------------------------

    public function search(string $term): self
    {
        return $this->withState(State::setSearchTerm($this->state, $term));
    }

    /**
     * Narrows a search within `q[filter][attribute]=`. Multiple values use apiable's `whereIn()` (repeated `[]`) form.
     *
     * @param  string|int|bool|list<string|int|bool>  $values
     */
    public function searchFilter(string $attribute, string|int|bool|array $values): self
    {
        return $this->withState(State::setSearchFilter($this->state, $attribute, self::toValueList($values)));
    }

    // ---------------------------------------------------------------------
    // Raw escape hatch
    // ---------------------------------------------------------------------

    /**
     * Sets an arbitrary top-level param outside the typed grammar.
     *
     * @param  string|int|bool|list<string|int|bool>  $value
     */
    public function param(string $key, string|int|bool|array $value): self
    {
        return $this->withState(State::setRawParam($this->state, [$key], self::toValueList($value)));
    }

    /** Removes a raw param, or (when `$key` is one of `filter|sort|include|fields|appends|page|q`) clears that whole bucket. */
    public function removeParam(string $key): self
    {
        ['base' => $base, 'path' => $path] = Encoding::parseKey($key);

        if ($path === [] && State::isBucketId($base)) {
            return $this->withState(State::clearBucket($this->state, $base));
        }

        // A bare key removes the whole family; a bracketed one targets a single entry.
        return $this->withState(State::removeRawParam($this->state, [$base, ...$path], $path === []));
    }

    /** Clears every param (filters, sorts, includes, fields, appends, page, search, raw). Keeps origin/pathname/hash. */
    public function clear(): self
    {
        return $this->withState(State::clearAll($this->state));
    }

    // ---------------------------------------------------------------------
    // Output
    // ---------------------------------------------------------------------

    /** `pathname?query` — shared by the three output forms. */
    private function renderPathAndQuery(): string
    {
        $query = State::buildQueryString($this->state);

        return $this->state->pathname.($query !== '' ? "?{$query}" : '');
    }

    /**
     * The full URL, including the origin when the builder was constructed
     * from one. This is the round-trip form: `FlexUrl::make($x)->toString()`
     * parses back to the same state. For a `href`/redirect target use
     * `toRelativeUrl()`.
     */
    public function toString(): string
    {
        return $this->state->origin.$this->renderPathAndQuery().$this->state->hash;
    }

    public function __toString(): string
    {
        return $this->toString();
    }

    /**
     * Nested array form of the current query state, mirroring the wire's
     * bracket structure — see the TypeScript core's `toParams()` doc comment
     * for the exact shape rules (`filter[due_at][gte]=X&filter[due_at][lte]=Y`
     * -> `['filter' => ['due_at' => ['gte' => 'X', 'lte' => 'Y']]]`, etc.).
     *
     * @return array<string, mixed>
     */
    public function toParams(): array
    {
        $params = [];

        if ($this->state->filters !== []) {
            $filter = [];

            foreach ($this->state->filters as $entry) {
                $filter = self::mergeFilterParam($filter, $entry['attribute'], $entry['operator'], implode(',', $entry['values']));
            }

            $params['filter'] = $filter;
        }

        if ($this->state->sorts !== []) {
            $params['sort'] = implode(',', array_map(
                static fn (array $entry): string => $entry['direction'] === 'desc' ? "-{$entry['attribute']}" : $entry['attribute'],
                $this->state->sorts,
            ));
        }

        if ($this->state->includes !== []) {
            $params['include'] = implode(',', $this->state->includes);
        }

        if ($this->state->fieldsOrder !== []) {
            $params['fields'] = array_combine(
                $this->state->fieldsOrder,
                array_map(fn (string $type): string => implode(',', $this->state->fields[$type] ?? []), $this->state->fieldsOrder),
            );
        }

        if ($this->state->appendsOrder !== []) {
            $params['appends'] = array_combine(
                $this->state->appendsOrder,
                array_map(fn (string $type): string => implode(',', $this->state->appends[$type] ?? []), $this->state->appendsOrder),
            );
        }

        if ($this->state->page !== []) {
            $params['page'] = $this->state->page;
        }

        $hasTerm = isset($this->state->search['term']);
        $hasSearchFilters = $this->state->search['filters'] !== [];

        if ($hasTerm || $hasSearchFilters) {
            if (! $hasSearchFilters) {
                $params['q'] = $this->state->search['term'];
            } else {
                $filter = [];

                foreach ($this->state->search['filters'] as $entry) {
                    $filter[$entry['attribute']] = count($entry['values']) === 1 && ! $entry['whereIn']
                        ? $entry['values'][0]
                        : $entry['values'];
                }

                $params['q'] = $hasTerm ? ['value' => $this->state->search['term'], 'filter' => $filter] : ['filter' => $filter];
            }
        }

        foreach ($this->state->raw as $entry) {
            self::setDeep($params, $entry['path'], count($entry['values']) === 1 ? $entry['values'][0] : $entry['values']);
        }

        return $params;
    }

    /**
     * Flat query array in the shape `Illuminate\Http\Request::query()` (i.e.
     * PHP's native `parse_str()`) would hold — nested `[]` params become
     * nested arrays, unlike `toParams()`'s grammar-aware flattening. Useful
     * for building a `Request` for an in-kernel sub-request without a hard
     * dependency on illuminate/http here.
     *
     * @return array<array-key, mixed>
     */
    public function toQuery(): array
    {
        parse_str(State::buildQueryString($this->state), $result);

        return $result;
    }

    /**
     * `pathname?query` (no scheme/host/fragment — fragments are never sent
     * to the server), matching `Illuminate\Http\Request::getRequestUri()`'s
     * shape. Pair with `toQuery()` to dispatch an in-kernel sub-request.
     *
     * For the fragment-preserving form (a Blade `href`, a redirect target)
     * use `toRelativeUrl()`.
     */
    public function toRequestUri(): string
    {
        return $this->renderPathAndQuery();
    }

    /**
     * `pathname?query#hash` — origin-relative, fragment preserved. The form
     * to hand to `redirect()->to()` or a Blade `href`, where the fragment is
     * client-side navigation and must survive. Mirrors the TypeScript
     * package's `toRelativeUrl()` exactly.
     */
    public function toRelativeUrl(): string
    {
        return $this->renderPathAndQuery().$this->state->hash;
    }

    // ---------------------------------------------------------------------
    // Readers
    // ---------------------------------------------------------------------

    /**
     * Checks a filter. Omit `$operator` to check the plain (bracket-less)
     * `filter[attribute]=` entry.
     */
    public function hasFilter(string $attribute, ?string $operator = null): bool
    {
        $op = $operator === null ? '' : self::normaliseOperator($operator);

        foreach ($this->state->filters as $entry) {
            if ($entry['attribute'] === $attribute && $entry['operator'] === $op) {
                return true;
            }
        }

        return false;
    }

    /**
     * Reads a filter's value(s). Omit `$operator` to read the plain
     * (bracket-less) entry.
     *
     * @return string|list<string>|null
     */
    public function getFilter(string $attribute, ?string $operator = null): string|array|null
    {
        $op = $operator === null ? '' : self::normaliseOperator($operator);

        foreach ($this->state->filters as $entry) {
            if ($entry['attribute'] === $attribute && $entry['operator'] === $op) {
                return count($entry['values']) === 1 ? $entry['values'][0] : $entry['values'];
            }
        }

        return null;
    }

    /**
     * Every filter on the URL, in wire order — the plural counterpart to
     * `getFilter()`, mirroring `getSorts()`.
     *
     * Returns entries rather than a keyed array so nothing is lost: an
     * attribute can appear more than once under different operators
     * (`filter[due][gte]`, `filter[due][lte]`), which an array keyed by
     * attribute cannot represent.
     *
     * @return list<FilterEntry>
     */
    public function getFilters(): array
    {
        return $this->state->filters;
    }

    /**
     * Reads a raw param set with `param()` — the counterpart that made the
     * escape hatch write-only. Bracket syntax reads a nested one
     * (`getParam('custom_sort[lang]')`).
     *
     * Grammar buckets are not raw params, so `getParam('filter')` is `null`;
     * use `getFilter()`/`getSorts()`/`getPage()` for those.
     *
     * @return string|list<string>|null
     */
    public function getParam(string $key): string|array|null
    {
        ['base' => $base, 'path' => $path] = Encoding::parseKey($key);
        $entry = State::findRawParam($this->state, [$base, ...$path]);

        if ($entry === null) {
            return null;
        }

        return count($entry['values']) === 1 ? $entry['values'][0] : $entry['values'];
    }

    /** @return list<array{attribute: string, direction: string}> */
    public function getSorts(): array
    {
        return $this->state->sorts;
    }

    /** @return list<string> */
    public function getIncludes(): array
    {
        return $this->state->includes;
    }

    /** `null` when absent *or* when the URL carried a non-integer (`page[number]=abc`). */
    public function getPage(): ?int
    {
        return self::toInteger($this->state->page['number'] ?? null);
    }

    /** `null` when absent *or* when the URL carried a non-integer (`page[size]=20%`). */
    public function getPageSize(): ?int
    {
        return self::toInteger($this->state->page['size'] ?? null);
    }

    /**
     * A stored page value only becomes a number when it actually *is* one. A
     * URL is user-supplied, so `page[number]=abc` is entirely possible; `(int)`
     * would hand back `0` (and `20` for `page[size]=20%`, quietly discarding
     * the `%`), silently poisoning arithmetic downstream. Both mirrors return
     * "absent" instead.
     */
    private static function toInteger(?string $value): ?int
    {
        return $value !== null && preg_match('/^-?\d+$/', $value) === 1 ? (int) $value : null;
    }

    public function getPageCursor(): ?string
    {
        return $this->state->page['cursor'] ?? null;
    }

    /**
     * @return ($type is null ? array<string, list<string>> : list<string>|null)
     */
    public function getFields(?string $type = null): ?array
    {
        if ($type === null) {
            $result = [];

            foreach ($this->state->fieldsOrder as $t) {
                $result[$t] = $this->state->fields[$t] ?? [];
            }

            return $result;
        }

        return $this->state->fields[$type] ?? null;
    }

    /**
     * @return ($type is null ? array<string, list<string>> : list<string>|null)
     */
    public function getAppends(?string $type = null): ?array
    {
        if ($type === null) {
            $result = [];

            foreach ($this->state->appendsOrder as $t) {
                $result[$t] = $this->state->appends[$t] ?? [];
            }

            return $result;
        }

        return $this->state->appends[$type] ?? null;
    }

    public function getSearch(): ?string
    {
        return $this->state->search['term'] ?? null;
    }

    /** @return string|list<string>|null */
    public function getSearchFilter(string $attribute): string|array|null
    {
        foreach ($this->state->search['filters'] as $entry) {
            if ($entry['attribute'] === $attribute) {
                // An explicit `[]` on the wire stays a list even with one value.
                return count($entry['values']) === 1 && ! $entry['whereIn']
                    ? $entry['values'][0]
                    : $entry['values'];
            }
        }

        return null;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /**
     * `'eq'` is a DX alias for the canonical `'equal'` operator — sending
     * `eq` on the wire is silently dropped by apiable as an unregistered
     * operator key.
     */
    private static function normaliseOperator(string $operator): string
    {
        return $operator === 'eq' ? 'equal' : $operator;
    }

    /**
     * @param  string|int|bool|list<string|int|bool>  $value
     * @return list<string>
     */
    private static function toValueList(string|int|bool|array $value): array
    {
        if (is_array($value)) {
            return array_map(self::stringifyScalar(...), $value);
        }

        return [self::stringifyScalar($value)];
    }

    /** Mirrors JavaScript's `String()` coercion for booleans (`'true'`/`'false'`, not `'1'`/`''`). */
    private static function stringifyScalar(string|int|bool $value): string
    {
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        return (string) $value;
    }

    /**
     * Set a value at a dot-free nested path inside a plain array, creating
     * intermediate arrays as needed. Used by `toParams()` to mirror the
     * wire's bracket nesting (`filter[due_at][gte]` -> `['filter' => ['due_at' => ['gte' => ...]]]`).
     *
     * @param  array<string, mixed>  $target
     * @param  list<string>  $path
     */
    private static function setDeep(array &$target, array $path, mixed $value): void
    {
        $cursor = &$target;

        foreach (array_slice($path, 0, -1) as $segment) {
            if (! isset($cursor[$segment]) || ! is_array($cursor[$segment])) {
                $cursor[$segment] = [];
            }

            $cursor = &$cursor[$segment];
        }

        $cursor[$path[count($path) - 1] ?? ''] = $value;
    }

    /**
     * Merge one `filter[attribute][operator]=value` pair into `toParams()`'s
     * `filter` array. The first (operator-less) entry for an attribute is
     * kept as a plain string; a second entry for the same attribute promotes
     * it to an operator-keyed array (with the plain value moving under the
     * `''` key).
     *
     * @param  array<string, mixed>  $target
     * @return array<string, mixed>
     */
    private static function mergeFilterParam(array $target, string $attribute, string $operator, string $value): array
    {
        $existing = $target[$attribute] ?? null;

        if ($existing === null && $operator === '') {
            $target[$attribute] = $value;

            return $target;
        }

        $asArray = match (true) {
            is_array($existing) => $existing,
            $existing === null => [],
            default => ['' => $existing],
        };

        $asArray[$operator] = $value;
        $target[$attribute] = $asArray;

        return $target;
    }
}
