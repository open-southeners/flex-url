import {parseKey, type FlexUrlOptions} from './encoding.js';
import {parseInput} from './input.js';
import {
  buildQueryString,
  clearAll,
  clearBucket,
  emptyState,
  hydrateFromSearch,
  isBucketId,
  addFilterValues,
  findRawParam,
  removeFilterValues,
  removeFilter as removeFilterFromState,
  removeRawParam,
  setFilter,
  setPage,
  setRawParam,
  setSearchFilter,
  setSearchTerm,
  setSort,
  addFields,
  addAppends,
  addIncludes,
  type FlexUrlState,
} from './state.js';
import type {
  AppendsAccessor,
  FilterEntry,
  EndpointSchema,
  FilterAttribute,
  FilterOperator,
  FilterOperatorFor,
  FilterScopeOptions,
  FieldsColumn,
  IncludeAttribute,
  ParamsObject,
  ResourceType,
  ScalarValue,
  SortAttribute,
  SortDirection,
  SortEntry,
} from './types.js';

/**
 * `'eq'`/`'neq'` are DX aliases for the canonical `'equal'`/`'not_equal'`
 * operators — see the `FilterOperator` doc comment in `types.ts` for why the
 * long forms are what actually reach the wire and the `EndpointSchema`
 * contract.
 */
const OPERATOR_ALIASES: Readonly<Record<string, string>> = {eq: 'equal', neq: 'not_equal'};

function normaliseOperator(operator: string): string {
  return OPERATOR_ALIASES[operator] ?? operator;
}

function toValueList(value: ScalarValue | ScalarValue[]): string[] {
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * A stored page value only becomes a number when it actually *is* one. A URL
 * is user-supplied, so `page[number]=abc` is entirely possible; `Number()`
 * would hand back `NaN` (and `(int)` on the PHP side would hand back `0`, or
 * `20` for `page[size]=20%`), silently poisoning arithmetic downstream. Both
 * mirrors return "absent" instead.
 */
function toInteger(value: string | undefined): number | undefined {
  return value !== undefined && /^-?\d+$/.test(value) ? Number(value) : undefined;
}

/**
 * Set a value at a dot-free nested path inside a plain object, creating
 * intermediate objects as needed. Used by `toParams()` to mirror the wire's
 * bracket nesting (`filter[due_at][gte]` → `{filter: {due_at: {gte: ...}}}`).
 */
function setDeep(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor = target;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i] ?? '';
    const existing = cursor[segment];

    if (typeof existing !== 'object' || existing === null) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[path[path.length - 1] ?? ''] = value;
}

/**
 * Merge one `filter[attribute][operator]=value` pair into `toParams()`'s
 * `filter` object. The first (operator-less) entry for an attribute is kept
 * as a plain string; a second entry for the same attribute promotes it to an
 * operator-keyed object (with the plain value moving under the `''` key).
 */
function mergeFilterParam(target: Record<string, unknown>, attribute: string, operator: string, value: string): void {
  const existing = target[attribute];

  if (existing === undefined && operator === '') {
    target[attribute] = value;
    return;
  }

  const asObject: Record<string, string> =
    typeof existing === 'object' && existing !== null
      ? {...(existing as Record<string, string>)}
      : existing === undefined
        ? {}
        : {'': existing as string};

  asObject[operator] = value;
  target[attribute] = asObject;
}

/**
 * Immutable, fluent builder/parser for the apiable request-query grammar
 * (`filter`, `sort`, `include`, `fields`, `appends`, `page`, `q`). Every
 * mutator returns a *new* `FlexUrl` instance — the receiver is never
 * modified — see `state.ts` for the underlying functional core.
 *
 * Construct via `flexUrl()`/`url()` rather than `new FlexUrl()` directly.
 */
export class FlexUrl<S extends EndpointSchema | undefined = undefined> {
  private readonly state: FlexUrlState;
  private readonly schema?: EndpointSchema;
  private readonly options: Required<FlexUrlOptions>;

  constructor(state: FlexUrlState, schema?: EndpointSchema, options?: FlexUrlOptions) {
    this.state = state;
    this.schema = schema;
    this.options = {strictCommaEncoding: options?.strictCommaEncoding ?? false};
  }

  private withState(state: FlexUrlState): FlexUrl<S> {
    return new FlexUrl<S>(state, this.schema, this.options);
  }

  /**
   * Dev-mode-only guard: logs a warning (never throws, never changes
   * behaviour) when a schema was supplied and `check(schema)` returns
   * `true`. Schema narrowing is otherwise compile-time only. `check` is
   * only invoked when a schema is actually present, so call sites can
   * freely read schema properties inside it.
   */
  private warnIfUnknown(check: (schema: EndpointSchema) => boolean, message: string): void {
    if (this.schema && check(this.schema)) {
      console.warn(`[flex-url] ${message} (endpoint: ${this.schema.resource})`);
    }
  }

  // ---------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------

  filter<A extends FilterAttribute<S>>(attribute: A, value: ScalarValue | ScalarValue[]): FlexUrl<S>;
  filter<A extends FilterAttribute<S>>(attribute: A, operator: FilterOperatorFor<S, A>, value: ScalarValue | ScalarValue[]): FlexUrl<S>;
  filter(attribute: string, operatorOrValue: unknown, maybeValue?: unknown): FlexUrl<S> {
    const hasOperator = maybeValue !== undefined;
    const operator = hasOperator ? normaliseOperator(operatorOrValue as string) : '';
    const values = toValueList((hasOperator ? maybeValue : operatorOrValue) as ScalarValue | ScalarValue[]);

    this.warnIfUnknown(schema => !schema.filters[attribute], `Unknown filter attribute "${attribute}"`);

    return this.withState(setFilter(this.state, attribute, operator, values));
  }

  /** Sugar for `filter(attribute, 'gte', min).filter(attribute, 'lte', max)`. */
  between<A extends FilterAttribute<S>>(attribute: A, min: ScalarValue, max: ScalarValue): FlexUrl<S> {
    const withMin = setFilter(this.state, attribute, 'gte', [String(min)]);
    const withBoth = setFilter(withMin, attribute, 'lte', [String(max)]);

    return this.withState(withBoth);
  }

  /**
   * Scoped filter: `filterScope('published')` sends a truthy toggle
   * (`filter[published]=1`); `filterScope('between', {min: 10, max: 50})`
   * sends named scope arguments (`filter[between][min]=10&...`). Pass
   * `{scoped: true}` to append the `_scoped` suffix apiable's
   * `enforce_scoped_names` config expects (`filter[published_scoped]=1`).
   */
  filterScope(name: string, args?: Record<string, ScalarValue>, options?: FilterScopeOptions): FlexUrl<S> {
    const scopedName = options?.scoped ? `${name}_scoped` : name;

    if (!args) {
      return this.withState(setFilter(this.state, scopedName, '', ['1']));
    }

    let state = this.state;

    for (const [key, value] of Object.entries(args)) {
      state = setFilter(state, scopedName, key, [String(value)]);
    }

    return this.withState(state);
  }

  /**
   * Removes a filter. Omit `operator` to remove every operator/scope-arg
   * entry for the attribute. `operator` is a plain `string` (not narrowed to
   * `FilterOperatorInput`) because it also has to accept `filterScope()`
   * named-argument keys (e.g. `"min"`), which aren't comparison operators.
   */
  removeFilter(attribute: string, operator?: string): FlexUrl<S> {
    const op = operator === undefined ? undefined : normaliseOperator(operator);

    return this.withState(removeFilterFromState(this.state, attribute, op));
  }

  /**
   * Adds one or more values to a filter's existing list rather than replacing
   * it (`filter[char]=A` + `B` → `filter[char]=A,B`), creating the filter when
   * absent and skipping values already present.
   *
   * `filter()` replaces; this accumulates. Operates on the plain
   * (bracket-less) entry — a multi-value list and a comparison operator don't
   * combine.
   */
  addFilterValue(attribute: string, value: ScalarValue | ScalarValue[]): FlexUrl<S> {
    return this.withState(addFilterValues(this.state, attribute, toValueList(value)));
  }

  /**
   * Drops one or more values from a filter's list, removing the filter
   * entirely once nothing is left.
   *
   * This is the "remove one chip" operation. Note it is *not* what
   * {@link removeFilter} does: that one's second argument is an operator, so
   * `removeFilter(attribute, someValue)` silently matches nothing.
   */
  removeFilterValue(attribute: string, value: ScalarValue | ScalarValue[]): FlexUrl<S> {
    return this.withState(removeFilterValues(this.state, attribute, toValueList(value)));
  }

  /** Adds the value if the filter doesn't already carry it, removes it if it does. */
  toggleFilterValue(attribute: string, value: ScalarValue): FlexUrl<S> {
    const values = this.state.filters.find(entry => entry.attribute === attribute && entry.operator === '')?.values ?? [];

    return values.includes(String(value)) ? this.removeFilterValue(attribute, value) : this.addFilterValue(attribute, value);
  }

  // ---------------------------------------------------------------------
  // Sorts
  // ---------------------------------------------------------------------

  /** `sort('title')` sorts ascending, `sort('-title')` descending. Repeated calls accumulate. */
  sort<A extends SortAttribute<S>>(attribute: A | `-${string & A}`): FlexUrl<S> {
    const raw = attribute as string;
    const descending = raw.startsWith('-');
    const bareAttribute = descending ? raw.slice(1) : raw;

    this.warnIfUnknown(schema => !(schema.sorts as string[]).includes(bareAttribute), `Unknown sort attribute "${bareAttribute}"`);

    return this.withState(setSort(this.state, bareAttribute, (descending ? 'desc' : 'asc') satisfies SortDirection));
  }

  sortDesc<A extends SortAttribute<S>>(attribute: A): FlexUrl<S> {
    return this.sort(`-${attribute as string}` as A | `-${string & A}`);
  }

  // ---------------------------------------------------------------------
  // Includes / fields / appends
  // ---------------------------------------------------------------------

  include<A extends IncludeAttribute<S>>(...relationships: A[]): FlexUrl<S> {
    for (const relationship of relationships) {
      this.warnIfUnknown(schema => !(schema.includes as string[]).includes(relationship), `Unknown include "${relationship}"`);
    }

    return this.withState(addIncludes(this.state, relationships as string[]));
  }

  fields<T extends ResourceType<S, 'fields'>>(type: T, ...columns: Array<FieldsColumn<S, T>>): FlexUrl<S> {
    this.warnIfUnknown(schema => !schema.fields[type], `Unknown fields resource type "${type}"`);

    return this.withState(addFields(this.state, type, columns as string[]));
  }

  append<T extends ResourceType<S, 'appends'>>(type: T, ...accessors: Array<AppendsAccessor<S, T>>): FlexUrl<S> {
    this.warnIfUnknown(schema => !schema.appends[type], `Unknown appends resource type "${type}"`);

    return this.withState(addAppends(this.state, type, accessors as string[]));
  }

  // ---------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------

  page(number: number | string): FlexUrl<S> {
    return this.withState(setPage(this.state, 'number', String(number)));
  }

  pageSize(size: number | string): FlexUrl<S> {
    return this.withState(setPage(this.state, 'size', String(size)));
  }

  pageCursor(cursor: string): FlexUrl<S> {
    return this.withState(setPage(this.state, 'cursor', cursor));
  }

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------

  search(term: string): FlexUrl<S> {
    return this.withState(setSearchTerm(this.state, term));
  }

  /** Narrows a search within `q[filter][attribute]=`. Multiple values use apiable's `whereIn()` (repeated `[]`) form. */
  searchFilter(attribute: string, values: ScalarValue | ScalarValue[]): FlexUrl<S> {
    return this.withState(setSearchFilter(this.state, attribute, toValueList(values)));
  }

  // ---------------------------------------------------------------------
  // Raw escape hatch
  // ---------------------------------------------------------------------

  /** Sets an arbitrary top-level param outside the typed grammar. Multiple values are sent as repeated keys. */
  param(key: string, value: ScalarValue | ScalarValue[]): FlexUrl<S> {
    return this.withState(setRawParam(this.state, [key], toValueList(value)));
  }

  /**
   * Removes a raw param, or (when `key` is one of
   * `filter|sort|include|fields|appends|page|q`) clears that whole bucket.
   *
   * Bracket syntax addresses a nested raw param: `removeParam('custom_sort[lang]')`
   * removes exactly that entry, while the bare `removeParam('custom_sort')`
   * removes every `custom_sort[...]` under it — the same "bare key clears the
   * whole thing" rule the bucket names follow.
   */
  removeParam(key: string): FlexUrl<S> {
    const {base, path} = parseKey(key);

    if (path.length === 0 && isBucketId(base)) {
      return this.withState(clearBucket(this.state, base));
    }

    // A bare key removes the whole family; a bracketed one targets a single entry.
    return this.withState(removeRawParam(this.state, [base, ...path], path.length === 0));
  }

  /** Clears every param (filters, sorts, includes, fields, appends, page, search, raw). Keeps origin/pathname/hash. */
  clear(): FlexUrl<S> {
    return this.withState(clearAll(this.state));
  }

  // ---------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------

  /** `pathname?query` — shared by the three output forms below. */
  private renderPathAndQuery(): string {
    const query = buildQueryString(this.state, this.options);

    return `${this.state.pathname}${query ? `?${query}` : ''}`;
  }

  /**
   * The full URL, including the origin when the builder was constructed from
   * one. This is the round-trip form: `flexUrl(x).toString()` parses back to
   * the same state. For client-side navigation use {@link toRelativeUrl}.
   */
  toString(): string {
    return `${this.state.origin}${this.renderPathAndQuery()}${this.state.hash}`;
  }

  /**
   * `pathname?query` — never scheme/host/fragment. The part that actually
   * reaches the server, for `fetch()`, log lines and cache keys. Mirrors the
   * PHP package's `toRequestUri()` exactly, so a fixture can assert one value
   * for both. When you're navigating rather than requesting, you want
   * {@link toRelativeUrl} — this one drops the hash.
   */
  toRequestUri(): string {
    return this.renderPathAndQuery();
  }

  /**
   * `pathname?query#hash` — the origin-relative form for client-side
   * navigation: Inertia's `router.visit()`, `history.pushState()`, vue-router
   * and `<a href>`.
   *
   * Prefer this over `toString()` when navigating. `history.pushState()`
   * throws a `SecurityError` when the origin differs from the document's,
   * which is exactly what happens once you build from an API URL
   * (`flexUrl('https://api.example.com/posts')`) and want the app's own
   * address bar to reflect the filters.
   */
  toRelativeUrl(): string {
    return `${this.renderPathAndQuery()}${this.state.hash}`;
  }

  /**
   * Nested object form of the current query state, mirroring the wire's
   * bracket structure:
   *
   * - `filter[status]=published` → `{filter: {status: 'published'}}`
   * - `filter[due_at][gte]=X&filter[due_at][lte]=Y` →
   *   `{filter: {due_at: {gte: 'X', lte: 'Y'}}}`
   * - `sort=a,-b` → `{sort: 'a,-b'}`; `include=a,b` → `{include: 'a,b'}`
   * - `fields[post]=title,body` → `{fields: {post: 'title,body'}}` (same shape for `appends`)
   * - `page[number]=1&page[size]=25` → `{page: {number: '1', size: '25'}}`
   * - `q=term` → `{q: 'term'}`; with search filters → `{q: {value: 'term', filter: {...}}}`
   *   (no term → `{q: {filter: {...}}}`)
   * - Raw/unknown params are set at their own (possibly nested) path.
   */
  toParams(): ParamsObject {
    const params: ParamsObject = {};

    if (this.state.filters.length > 0) {
      const filter: Record<string, unknown> = {};

      for (const entry of this.state.filters) {
        mergeFilterParam(filter, entry.attribute, entry.operator, entry.values.join(','));
      }

      params.filter = filter;
    }

    if (this.state.sorts.length > 0) {
      params.sort = this.state.sorts.map(entry => (entry.direction === 'desc' ? `-${entry.attribute}` : entry.attribute)).join(',');
    }

    if (this.state.includes.length > 0) {
      params.include = this.state.includes.join(',');
    }

    if (this.state.fieldsOrder.length > 0) {
      params.fields = Object.fromEntries(this.state.fieldsOrder.map(type => [type, (this.state.fields[type] ?? []).join(',')]));
    }

    if (this.state.appendsOrder.length > 0) {
      params.appends = Object.fromEntries(this.state.appendsOrder.map(type => [type, (this.state.appends[type] ?? []).join(',')]));
    }

    if (Object.keys(this.state.page).length > 0) {
      params.page = {...this.state.page};
    }

    const hasTerm = this.state.search.term !== undefined;
    const hasSearchFilters = this.state.search.filters.length > 0;

    if (hasTerm || hasSearchFilters) {
      if (!hasSearchFilters) {
        params.q = this.state.search.term;
      } else {
        const filter = Object.fromEntries(
          this.state.search.filters.map(entry => [
            entry.attribute,
            entry.values.length === 1 && !entry.whereIn ? entry.values[0] : entry.values,
          ]),
        );

        params.q = hasTerm ? {value: this.state.search.term, filter} : {filter};
      }
    }

    for (const entry of this.state.raw) {
      setDeep(params, entry.path, entry.values.length === 1 ? entry.values[0] : entry.values);
    }

    return params;
  }

  // ---------------------------------------------------------------------
  // Readers
  // ---------------------------------------------------------------------

  /**
   * Checks a filter. Omit `operator` to check the plain (bracket-less)
   * `filter[attribute]=` entry. `operator` is a plain `string` (not narrowed
   * to `FilterOperatorInput`) so it also accepts `filterScope()`
   * named-argument keys (e.g. `"min"`).
   */
  hasFilter(attribute: string, operator?: string): boolean {
    const op = operator === undefined ? '' : normaliseOperator(operator);

    return this.state.filters.some(entry => entry.attribute === attribute && entry.operator === op);
  }

  /**
   * Reads a filter's value(s). Omit `operator` to read the plain
   * (bracket-less) entry. `operator` is a plain `string` for the same reason
   * as {@link hasFilter}.
   */
  getFilter(attribute: string, operator?: string): string | string[] | undefined {
    const op = operator === undefined ? '' : normaliseOperator(operator);
    const entry = this.state.filters.find(candidate => candidate.attribute === attribute && candidate.operator === op);

    if (!entry) return undefined;

    return entry.values.length === 1 ? entry.values[0] : [...entry.values];
  }

  /**
   * Every filter on the URL, in wire order — the plural counterpart to
   * {@link getFilter}, mirroring `getSorts()`.
   *
   * Returns entries rather than a keyed object so nothing is lost: an
   * attribute can appear more than once under different operators
   * (`filter[due][gte]`, `filter[due][lte]`), which a `Record` keyed by
   * attribute cannot represent.
   */
  getFilters(): FilterEntry[] {
    return this.state.filters.map(entry => ({...entry, values: [...entry.values]}));
  }

  /**
   * Reads a raw param set with {@link param} — the counterpart that made the
   * escape hatch write-only. Bracket syntax reads a nested one
   * (`getParam('custom_sort[lang]')`).
   *
   * Grammar buckets are not raw params, so `getParam('filter')` is
   * `undefined`; use `getFilter()`/`getSorts()`/`getPage()` for those.
   */
  getParam(key: string): string | string[] | undefined {
    const {base, path} = parseKey(key);
    const entry = findRawParam(this.state, [base, ...path]);

    if (!entry) return undefined;

    return entry.values.length === 1 ? entry.values[0] : [...entry.values];
  }

  getSorts(): SortEntry[] {
    return this.state.sorts.map(entry => ({...entry}));
  }

  getIncludes(): string[] {
    return [...this.state.includes];
  }

  /** `undefined` when absent *or* when the URL carried a non-integer (`page[number]=abc`). */
  getPage(): number | undefined {
    return toInteger(this.state.page.number);
  }

  /** `undefined` when absent *or* when the URL carried a non-integer (`page[size]=20%`). */
  getPageSize(): number | undefined {
    return toInteger(this.state.page.size);
  }

  getPageCursor(): string | undefined {
    return this.state.page.cursor;
  }

  getFields(): Record<string, string[]>;
  getFields(type: string): string[] | undefined;
  getFields(type?: string): Record<string, string[]> | string[] | undefined {
    if (type === undefined) {
      return Object.fromEntries(this.state.fieldsOrder.map(t => [t, [...(this.state.fields[t] ?? [])]]));
    }

    return this.state.fields[type] ? [...this.state.fields[type]] : undefined;
  }

  getAppends(): Record<string, string[]>;
  getAppends(type: string): string[] | undefined;
  getAppends(type?: string): Record<string, string[]> | string[] | undefined {
    if (type === undefined) {
      return Object.fromEntries(this.state.appendsOrder.map(t => [t, [...(this.state.appends[t] ?? [])]]));
    }

    return this.state.appends[type] ? [...this.state.appends[type]] : undefined;
  }

  getSearch(): string | undefined {
    return this.state.search.term;
  }

  getSearchFilter(attribute: string): string | string[] | undefined {
    const entry = this.state.search.filters.find(candidate => candidate.attribute === attribute);

    if (!entry) return undefined;

    // An explicit `[]` on the wire stays a list even with one value — see `SearchFilterEntry.whereIn`.
    return entry.values.length === 1 && !entry.whereIn ? entry.values[0] : [...entry.values];
  }
}

/**
 * Creates a `FlexUrl` builder/parser.
 *
 * - `flexUrl()` — a bare builder that renders just a query string.
 * - `flexUrl('/posts')` / `flexUrl('https://api.example.com/posts?foo=bar')`
 *   — hydrates from a path or full URL (pathname/port/hash/existing params
 *   all preserved — "parse = build").
 * - `flexUrl('/api/v1/issues', issuesSchema)` — `S` is inferred from the
 *   `schema` argument, narrowing `filter()`/`sort()`/`include()`/etc.
 * - `flexUrl<IssuesSchema>('/api/v1/issues')` — explicit generic, schema
 *   narrowing with no runtime schema object (and therefore no dev warnings).
 * - `flexUrl('/posts', schema, {strictCommaEncoding: true})` — opts into
 *   strict list encoding (see {@link FlexUrlOptions}), so a literal comma
 *   inside one filter/sort/include/fields/appends value round-trips instead
 *   of being treated as another separator. Default `false`.
 */
export function flexUrl<S extends EndpointSchema | undefined = undefined>(
  input?: string | URL,
  schema?: S,
  options?: FlexUrlOptions,
): FlexUrl<S> {
  const {origin, pathname, search, hash} = parseInput(input);
  const state = hydrateFromSearch(emptyState(origin, pathname, hash), search, options);

  return new FlexUrl<S>(state, schema, options);
}

/** Alias for `flexUrl()`. */
export const url = flexUrl;

export type {FilterOperator, FlexUrlOptions};
