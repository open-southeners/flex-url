<?php

declare(strict_types=1);

namespace OpenSoutheners\FlexUrl\Internal;

/**
 * Functional core: `State` is an immutable value object and every `with*`
 * static method below returns a *new* instance rather than mutating its
 * argument — mirrors the TypeScript core's `state.ts`. `FlexUrl` (the public
 * API) is a thin, stateless wrapper around these pure transformations.
 *
 * @internal
 *
 * @phpstan-type FilterEntry array{attribute: string, operator: string, values: list<string>}
 * @phpstan-type SortEntry array{attribute: string, direction: string}
 * @phpstan-type SearchFilterEntry array{attribute: string, values: list<string>, whereIn: bool}
 * @phpstan-type SearchState array{term?: string, filters: list<SearchFilterEntry>}
 * @phpstan-type PageState array{number?: string, size?: string, cursor?: string}
 * @phpstan-type RawEntry array{path: list<string>, values: list<string>}
 *
 * @SuppressWarnings("PHPMD.StaticAccess")
 */
final readonly class State
{
    /** The recognised top-level apiable buckets, in the order they're emitted when first populated. */
    public const BUCKET_IDS = ['filter', 'sort', 'include', 'fields', 'appends', 'page', 'q'];

    /**
     * @param  list<string>  $order  Either a known bucket id, or `raw:<path>` for a custom/unrecognised param.
     * @param  list<FilterEntry>  $filters
     * @param  list<SortEntry>  $sorts
     * @param  list<string>  $includes
     * @param  array<string, list<string>>  $fields
     * @param  list<string>  $fieldsOrder
     * @param  array<string, list<string>>  $appends
     * @param  list<string>  $appendsOrder
     * @param  PageState  $page
     * @param  SearchState  $search
     * @param  list<RawEntry>  $raw
     */
    public function __construct(
        public string $origin = '',
        public string $pathname = '',
        public string $hash = '',
        public array $order = [],
        public array $filters = [],
        public array $sorts = [],
        public array $includes = [],
        public array $fields = [],
        public array $fieldsOrder = [],
        public array $appends = [],
        public array $appendsOrder = [],
        public array $page = [],
        public array $search = ['filters' => []],
        public array $raw = [],
    ) {}

    public static function empty(string $origin = '', string $pathname = '', string $hash = ''): self
    {
        return new self(origin: $origin, pathname: $pathname, hash: $hash);
    }

    public static function isBucketId(string $value): bool
    {
        return in_array($value, self::BUCKET_IDS, true);
    }

    // -----------------------------------------------------------------
    // Filters
    // -----------------------------------------------------------------

    /**
     * Builder-driven upsert: replaces any existing entry for the same
     * (attribute, operator) pair.
     *
     * @param  list<string>  $values
     */
    public static function setFilter(self $state, string $attribute, string $operator, array $values): self
    {
        $filters = $state->filters;
        $index = self::findFilterIndex($filters, $attribute, $operator);
        $entry = ['attribute' => $attribute, 'operator' => $operator, 'values' => $values];

        if ($index === null) {
            $filters[] = $entry;
        } else {
            $filters[$index] = $entry;
        }

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'filter'),
            filters: $filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    /**
     * Parse-driven accumulation: merges into any existing entry for the same
     * (attribute, operator) pair.
     *
     * @param  list<string>  $values
     */
    public static function mergeFilterFromParse(self $state, string $attribute, string $operator, array $values): self
    {
        $filters = $state->filters;
        $index = self::findFilterIndex($filters, $attribute, $operator);

        if ($index === null) {
            $filters[] = ['attribute' => $attribute, 'operator' => $operator, 'values' => $values];
        } else {
            $filters[$index] = [
                'attribute' => $filters[$index]['attribute'],
                'operator' => $filters[$index]['operator'],
                'values' => [...$filters[$index]['values'], ...$values],
            ];
        }

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'filter'),
            filters: $filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    /**
     * Adds values to a filter's existing list, skipping ones already there, and
     * creating the entry when it doesn't exist yet. Operates on the
     * bracket-less entry — a multi-value list and a comparison operator don't
     * combine.
     *
     * @param  list<string>  $values
     */
    public static function addFilterValues(self $state, string $attribute, array $values): self
    {
        $index = self::findFilterIndex($state->filters, $attribute, '');

        if ($index === null) {
            return self::setFilter($state, $attribute, '', $values);
        }

        $merged = $state->filters[$index]['values'];

        foreach ($values as $value) {
            if (! in_array($value, $merged, true)) {
                $merged[] = $value;
            }
        }

        return self::withFilterValuesAt($state, $index, $attribute, $merged);
    }

    /**
     * Drops values from a filter's list, removing the whole entry once nothing
     * is left — "unticking the last checkbox clears the filter", which is what
     * every multi-select UI wants and what callers otherwise hand-roll.
     *
     * @param  list<string>  $values
     */
    public static function removeFilterValues(self $state, string $attribute, array $values): self
    {
        $index = self::findFilterIndex($state->filters, $attribute, '');

        if ($index === null) {
            return $state;
        }

        $remaining = array_values(array_filter(
            $state->filters[$index]['values'],
            static fn (string $value): bool => ! in_array($value, $values, true),
        ));

        return $remaining === []
            ? self::removeFilter($state, $attribute, '')
            : self::withFilterValuesAt($state, $index, $attribute, $remaining);
    }

    /**
     * A copy of `$state` with the values of the plain filter at `$index`
     * swapped out.
     *
     * @param  list<string>  $values
     */
    private static function withFilterValuesAt(self $state, int $index, string $attribute, array $values): self
    {
        $filters = $state->filters;
        $filters[$index] = ['attribute' => $attribute, 'operator' => '', 'values' => $values];

        return self::withFilters($state, $filters);
    }

    /**
     * Removes a filter. `$operator === null` removes every entry for the
     * attribute regardless of operator; `$operator === ''` removes only the
     * plain (bracket-less) entry.
     */
    public static function removeFilter(self $state, string $attribute, ?string $operator): self
    {
        $filters = array_values(array_filter(
            $state->filters,
            static function (array $entry) use ($attribute, $operator): bool {
                if ($entry['attribute'] !== $attribute) {
                    return true;
                }

                return $operator === null ? false : $entry['operator'] !== $operator;
            },
        ));

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: $state->order,
            filters: $filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    /**
     * A copy of `$state` with `$filters` swapped in and everything else kept.
     * Only for updates to entries that already exist, so `order` is untouched.
     *
     * @param  list<FilterEntry>  $filters
     */
    private static function withFilters(self $state, array $filters): self
    {
        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: $state->order,
            filters: $filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    /**
     * @param  list<FilterEntry>  $filters
     */
    private static function findFilterIndex(array $filters, string $attribute, string $operator): ?int
    {
        foreach ($filters as $index => $entry) {
            if ($entry['attribute'] === $attribute && $entry['operator'] === $operator) {
                return $index;
            }
        }

        return null;
    }

    // -----------------------------------------------------------------
    // Sorts
    // -----------------------------------------------------------------

    public static function setSort(self $state, string $attribute, string $direction): self
    {
        $sorts = $state->sorts;
        $index = null;

        foreach ($sorts as $i => $entry) {
            if ($entry['attribute'] === $attribute) {
                $index = $i;
                break;
            }
        }

        $entry = ['attribute' => $attribute, 'direction' => $direction];

        if ($index === null) {
            $sorts[] = $entry;
        } else {
            $sorts[$index] = $entry;
        }

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'sort'),
            filters: $state->filters,
            sorts: $sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    // -----------------------------------------------------------------
    // Includes
    // -----------------------------------------------------------------

    /**
     * @param  list<string>  $relationships
     */
    public static function addIncludes(self $state, array $relationships): self
    {
        $includes = $state->includes;

        foreach ($relationships as $relationship) {
            if (! in_array($relationship, $includes, true)) {
                $includes[] = $relationship;
            }
        }

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'include'),
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    // -----------------------------------------------------------------
    // Fields / appends (structurally identical — one resource type -> column list)
    // -----------------------------------------------------------------

    /**
     * @param  array<string, list<string>>  $bucket
     * @param  list<string>  $order
     * @param  list<string>  $values
     * @return array{bucket: array<string, list<string>>, order: list<string>}
     */
    private static function addToTypeList(array $bucket, array $order, string $type, array $values): array
    {
        $merged = $bucket[$type] ?? [];

        foreach ($values as $value) {
            if (! in_array($value, $merged, true)) {
                $merged[] = $value;
            }
        }

        $bucket[$type] = $merged;

        if (! in_array($type, $order, true)) {
            $order[] = $type;
        }

        return ['bucket' => $bucket, 'order' => $order];
    }

    /**
     * @param  list<string>  $columns
     */
    public static function addFields(self $state, string $type, array $columns): self
    {
        $result = self::addToTypeList($state->fields, $state->fieldsOrder, $type, $columns);

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'fields'),
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $result['bucket'],
            fieldsOrder: $result['order'],
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    /**
     * @param  list<string>  $accessors
     */
    public static function addAppends(self $state, string $type, array $accessors): self
    {
        $result = self::addToTypeList($state->appends, $state->appendsOrder, $type, $accessors);

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'appends'),
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $result['bucket'],
            appendsOrder: $result['order'],
            page: $state->page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    // -----------------------------------------------------------------
    // Page
    // -----------------------------------------------------------------

    public static function setPage(self $state, string $key, string $value): self
    {
        $page = $state->page;
        $page[$key] = $value;

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'page'),
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $page,
            search: $state->search,
            raw: $state->raw,
        );
    }

    // -----------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------

    public static function setSearchTerm(self $state, string $term): self
    {
        $search = $state->search;
        $search['term'] = $term;

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'q'),
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $search,
            raw: $state->raw,
        );
    }

    /**
     * `$whereIn` records that the wire used apiable's repeated-`[]` form.
     * Tracked separately from `count($values)` because `q[filter][tag][]=x`
     * carries one value but still means "match against a list" — collapsing it
     * to `q[filter][tag]=x` on the way out would downgrade it to a scalar
     * `where`.
     *
     * @param  list<string>  $values
     */
    public static function setSearchFilter(self $state, string $attribute, array $values, bool $whereIn = false): self
    {
        $filters = $state->search['filters'];
        $index = null;

        foreach ($filters as $i => $entry) {
            if ($entry['attribute'] === $attribute) {
                $index = $i;
                break;
            }
        }

        $entry = ['attribute' => $attribute, 'values' => $values, 'whereIn' => $whereIn];

        if ($index === null) {
            $filters[] = $entry;
        } else {
            $filters[$index] = $entry;
        }

        $search = $state->search;
        $search['filters'] = $filters;

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, 'q'),
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $search,
            raw: $state->raw,
        );
    }

    // -----------------------------------------------------------------
    // Raw escape hatch
    // -----------------------------------------------------------------

    /**
     * @param  list<string>  $path
     * @param  list<string>  $other
     */
    private static function samePath(array $path, array $other): bool
    {
        return $path === $other;
    }

    /**
     * True when `$prefix` is `$path` itself or an ancestor of it.
     *
     * @param  list<string>  $prefix
     * @param  list<string>  $path
     */
    private static function isPathPrefix(array $prefix, array $path): bool
    {
        return array_slice($path, 0, count($prefix)) === $prefix;
    }

    /**
     * @param  list<string>  $path
     */
    private static function rawOrderId(array $path): string
    {
        return 'raw:'.implode('.', $path);
    }

    /**
     * @param  list<string>  $path
     * @param  list<string>  $values
     */
    public static function setRawParam(self $state, array $path, array $values): self
    {
        $raw = $state->raw;
        $index = null;

        foreach ($raw as $i => $entry) {
            if (self::samePath($entry['path'], $path)) {
                $index = $i;
                break;
            }
        }

        $entry = ['path' => $path, 'values' => $values];

        if ($index === null) {
            $raw[] = $entry;
        } else {
            $raw[$index] = $entry;
        }

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: self::withOrder($state->order, self::rawOrderId($path)),
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $raw,
        );
    }

    /**
     * @param  list<string>  $path
     */
    public static function mergeRawParamFromParse(self $state, array $path, string $value): self
    {
        $index = null;

        foreach ($state->raw as $i => $entry) {
            if (self::samePath($entry['path'], $path)) {
                $index = $i;
                break;
            }
        }

        if ($index === null) {
            return self::setRawParam($state, $path, [$value]);
        }

        $raw = $state->raw;
        $raw[$index] = [
            'path' => $raw[$index]['path'],
            'values' => [...$raw[$index]['values'], $value],
        ];

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: $state->order,
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $raw,
        );
    }

    /**
     * Finds a raw param entry by exact path, or `null` when there isn't one.
     *
     * @param  list<string>  $path
     * @return RawEntry|null
     */
    public static function findRawParam(self $state, array $path): ?array
    {
        foreach ($state->raw as $entry) {
            if (self::samePath($entry['path'], $path)) {
                return $entry;
            }
        }

        return null;
    }

    /**
     * Removes raw params by path. With `$includeNested`, `$path` is treated as
     * a prefix, so `['custom_sort']` also removes `custom_sort[lang]` — which
     * is what a caller passing a bare key means, since a bare key is how a
     * whole bucket is cleared elsewhere in this API.
     *
     * @param  list<string>  $path
     */
    public static function removeRawParam(self $state, array $path, bool $includeNested = false): self
    {
        $matches = static fn (array $entry): bool => $includeNested
            ? self::isPathPrefix($path, $entry['path'])
            : self::samePath($entry['path'], $path);

        // Every removed entry takes its own order id with it — a prefix removal
        // can drop several at once, so the ids can't be derived from `$path`.
        $removedIds = [];

        foreach ($state->raw as $entry) {
            if ($matches($entry)) {
                $removedIds[] = self::rawOrderId($entry['path']);
            }
        }

        $raw = array_values(array_filter($state->raw, static fn (array $entry): bool => ! $matches($entry)));
        $order = array_values(array_filter(
            $state->order,
            static fn (string $id): bool => ! in_array($id, $removedIds, true),
        ));

        return new self(
            origin: $state->origin,
            pathname: $state->pathname,
            hash: $state->hash,
            order: $order,
            filters: $state->filters,
            sorts: $state->sorts,
            includes: $state->includes,
            fields: $state->fields,
            fieldsOrder: $state->fieldsOrder,
            appends: $state->appends,
            appendsOrder: $state->appendsOrder,
            page: $state->page,
            search: $state->search,
            raw: $raw,
        );
    }

    // -----------------------------------------------------------------
    // Whole-bucket / whole-state clears
    // -----------------------------------------------------------------

    public static function clearBucket(self $state, string $bucket): self
    {
        $order = array_values(array_filter($state->order, static fn (string $id): bool => $id !== $bucket));

        return match ($bucket) {
            'filter' => new self(
                origin: $state->origin,
                pathname: $state->pathname,
                hash: $state->hash,
                order: $order,
                filters: [],
                sorts: $state->sorts,
                includes: $state->includes,
                fields: $state->fields,
                fieldsOrder: $state->fieldsOrder,
                appends: $state->appends,
                appendsOrder: $state->appendsOrder,
                page: $state->page,
                search: $state->search,
                raw: $state->raw,
            ),
            'sort' => new self(
                origin: $state->origin,
                pathname: $state->pathname,
                hash: $state->hash,
                order: $order,
                filters: $state->filters,
                sorts: [],
                includes: $state->includes,
                fields: $state->fields,
                fieldsOrder: $state->fieldsOrder,
                appends: $state->appends,
                appendsOrder: $state->appendsOrder,
                page: $state->page,
                search: $state->search,
                raw: $state->raw,
            ),
            'include' => new self(
                origin: $state->origin,
                pathname: $state->pathname,
                hash: $state->hash,
                order: $order,
                filters: $state->filters,
                sorts: $state->sorts,
                includes: [],
                fields: $state->fields,
                fieldsOrder: $state->fieldsOrder,
                appends: $state->appends,
                appendsOrder: $state->appendsOrder,
                page: $state->page,
                search: $state->search,
                raw: $state->raw,
            ),
            'fields' => new self(
                origin: $state->origin,
                pathname: $state->pathname,
                hash: $state->hash,
                order: $order,
                filters: $state->filters,
                sorts: $state->sorts,
                includes: $state->includes,
                fields: [],
                fieldsOrder: [],
                appends: $state->appends,
                appendsOrder: $state->appendsOrder,
                page: $state->page,
                search: $state->search,
                raw: $state->raw,
            ),
            'appends' => new self(
                origin: $state->origin,
                pathname: $state->pathname,
                hash: $state->hash,
                order: $order,
                filters: $state->filters,
                sorts: $state->sorts,
                includes: $state->includes,
                fields: $state->fields,
                fieldsOrder: $state->fieldsOrder,
                appends: [],
                appendsOrder: [],
                page: $state->page,
                search: $state->search,
                raw: $state->raw,
            ),
            'page' => new self(
                origin: $state->origin,
                pathname: $state->pathname,
                hash: $state->hash,
                order: $order,
                filters: $state->filters,
                sorts: $state->sorts,
                includes: $state->includes,
                fields: $state->fields,
                fieldsOrder: $state->fieldsOrder,
                appends: $state->appends,
                appendsOrder: $state->appendsOrder,
                page: [],
                search: $state->search,
                raw: $state->raw,
            ),
            'q' => new self(
                origin: $state->origin,
                pathname: $state->pathname,
                hash: $state->hash,
                order: $order,
                filters: $state->filters,
                sorts: $state->sorts,
                includes: $state->includes,
                fields: $state->fields,
                fieldsOrder: $state->fieldsOrder,
                appends: $state->appends,
                appendsOrder: $state->appendsOrder,
                page: $state->page,
                search: ['filters' => []],
                raw: $state->raw,
            ),
            default => $state,
        };
    }

    public static function clearAll(self $state): self
    {
        return self::empty($state->origin, $state->pathname, $state->hash);
    }

    // -----------------------------------------------------------------
    // Parsing an existing query string into state
    // -----------------------------------------------------------------

    public static function hydrateFromSearch(self $state, string $search): self
    {
        $next = $state;

        foreach (Encoding::parseQueryString($search) as $entry) {
            $base = $entry['base'];
            $path = $entry['path'];
            $rawValue = $entry['rawValue'];

            if ($base === 'filter' && count($path) >= 1) {
                $attribute = $path[0];
                $operator = $path[1] ?? '';

                $next = self::mergeFilterFromParse($next, $attribute, $operator, Encoding::decodeList($rawValue));

                continue;
            }

            if ($base === 'sort' && count($path) === 0) {
                foreach (Encoding::decodeList($rawValue) as $token) {
                    if ($token === '') {
                        continue;
                    }

                    $desc = str_starts_with($token, '-');

                    $next = self::setSort($next, $desc ? substr($token, 1) : $token, $desc ? 'desc' : 'asc');
                }

                continue;
            }

            if ($base === 'include' && count($path) === 0) {
                $relationships = array_values(array_filter(
                    Encoding::decodeList($rawValue),
                    static fn (string $token): bool => $token !== '',
                ));

                $next = self::addIncludes($next, $relationships);

                continue;
            }

            if ($base === 'fields' && count($path) === 1) {
                $next = self::addFields($next, $path[0], Encoding::decodeList($rawValue));

                continue;
            }

            if ($base === 'appends' && count($path) === 1) {
                $next = self::addAppends($next, $path[0], Encoding::decodeList($rawValue));

                continue;
            }

            $pageKey = $path[0] ?? null;

            if ($base === 'page' && count($path) === 1 && in_array($pageKey, ['number', 'size', 'cursor'], true)) {
                $next = self::setPage($next, $pageKey, Encoding::decodeValue($rawValue));

                continue;
            }

            if ($base === 'q' && count($path) === 0) {
                $next = self::setSearchTerm($next, Encoding::decodeValue($rawValue));

                continue;
            }

            // q[filter][attribute]=value (single) or q[filter][attribute][]=value (repeated, whereIn semantics).
            if ($base === 'q' && $path[0] === 'filter' && count($path) >= 2) {
                $attribute = $path[1];
                $value = Encoding::decodeValue($rawValue);
                $existing = null;

                foreach ($next->search['filters'] as $candidate) {
                    if ($candidate['attribute'] === $attribute) {
                        $existing = $candidate;
                        break;
                    }
                }

                // `q[filter][tag][]` parses to the path ['filter', 'tag', ''] — the empty
                // third segment is the `[]` marker, and it sticks once any pair carried it.
                $whereIn = (count($path) >= 3 && $path[2] === '') || ($existing['whereIn'] ?? false);

                $next = self::setSearchFilter($next, $attribute, $existing ? [...$existing['values'], $value] : [$value], $whereIn);

                continue;
            }

            // Unrecognised top-level key (or unrecognised shape of a known one): preserve verbatim.
            $next = self::mergeRawParamFromParse($next, [$base, ...$path], Encoding::decodeValue($rawValue));
        }

        return $next;
    }

    // -----------------------------------------------------------------
    // Serialising state back into a query string
    // -----------------------------------------------------------------

    public static function buildQueryString(self $state): string
    {
        $pairs = [];

        foreach ($state->order as $id) {
            if ($id === 'filter') {
                foreach ($state->filters as $entry) {
                    $path = $entry['operator'] === '' ? [$entry['attribute']] : [$entry['attribute'], $entry['operator']];

                    $pairs[] = Encoding::buildKey('filter', $path).'='.Encoding::encodeList($entry['values']);
                }

                continue;
            }

            if ($id === 'sort') {
                if ($state->sorts === []) {
                    continue;
                }

                $tokens = array_map(
                    static fn (array $entry): string => $entry['direction'] === 'desc' ? "-{$entry['attribute']}" : $entry['attribute'],
                    $state->sorts,
                );

                $pairs[] = 'sort='.Encoding::encodeList($tokens);

                continue;
            }

            if ($id === 'include') {
                if ($state->includes === []) {
                    continue;
                }

                $pairs[] = 'include='.Encoding::encodeList($state->includes);

                continue;
            }

            if ($id === 'fields') {
                foreach ($state->fieldsOrder as $type) {
                    $pairs[] = Encoding::buildKey('fields', [$type]).'='.Encoding::encodeList($state->fields[$type] ?? []);
                }

                continue;
            }

            if ($id === 'appends') {
                foreach ($state->appendsOrder as $type) {
                    $pairs[] = Encoding::buildKey('appends', [$type]).'='.Encoding::encodeList($state->appends[$type] ?? []);
                }

                continue;
            }

            if ($id === 'page') {
                foreach (['number', 'size', 'cursor'] as $key) {
                    $value = $state->page[$key] ?? null;

                    if ($value !== null) {
                        $pairs[] = Encoding::buildKey('page', [$key]).'='.Encoding::encodeValue($value);
                    }
                }

                continue;
            }

            if ($id === 'q') {
                if (isset($state->search['term'])) {
                    $pairs[] = 'q='.Encoding::encodeValue($state->search['term']);
                }

                foreach ($state->search['filters'] as $entry) {
                    $key = Encoding::buildKey('q', ['filter', $entry['attribute']]);

                    // A single value uses the plain key; multiple values (or a single one that
                    // arrived under an explicit `[]`) use apiable's repeated-`[]` whereIn()
                    // convention rather than the comma-list used elsewhere in the grammar.
                    if (count($entry['values']) <= 1 && ! $entry['whereIn']) {
                        $pairs[] = "{$key}=".Encoding::encodeValue($entry['values'][0] ?? '');
                    } else {
                        foreach ($entry['values'] as $value) {
                            $pairs[] = "{$key}[]=".Encoding::encodeValue($value);
                        }
                    }
                }

                continue;
            }

            // raw:<path>
            $entry = null;

            foreach ($state->raw as $candidate) {
                if (self::rawOrderId($candidate['path']) === $id) {
                    $entry = $candidate;
                    break;
                }
            }

            if ($entry === null) {
                continue;
            }

            $key = Encoding::buildKey($entry['path'][0] ?? '', array_slice($entry['path'], 1));

            if (count($entry['values']) <= 1) {
                $pairs[] = "{$key}=".Encoding::encodeValue($entry['values'][0] ?? '');
            } else {
                foreach ($entry['values'] as $value) {
                    $pairs[] = "{$key}=".Encoding::encodeValue($value);
                }
            }
        }

        return implode('&', $pairs);
    }

    /**
     * @param  list<string>  $order
     * @return list<string>
     */
    private static function withOrder(array $order, string $id): array
    {
        return in_array($id, $order, true) ? $order : [...$order, $id];
    }
}
