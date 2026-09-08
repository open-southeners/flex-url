/**
 * Functional core: `FlexUrlState` is a plain, immutable-by-convention data
 * structure and every `with*`/`without*` function below returns a *new*
 * state object rather than mutating its argument. The `FlexUrl` class
 * (`flex-url.ts`) is a thin, stateless wrapper around these functions — kept
 * separate so the state shape and its transformations stay tree-shakeable
 * and independently testable.
 */
import {buildKey, decodeList, decodeValue, encodeList, encodeValue, parseQueryString, type FlexUrlOptions} from './encoding.js';
import type {FilterEntry, SortDirection, SortEntry} from './types.js';

export interface PageState {
  number?: string;
  size?: string;
  cursor?: string;
}

export interface SearchFilterEntry {
  attribute: string;
  values: string[];
  /**
   * `true` when the wire used apiable's repeated-`[]` whereIn form. Tracked
   * separately from `values.length` because `q[filter][tag][]=x` carries one
   * value but still means "match against a list" — collapsing it to
   * `q[filter][tag]=x` on the way out would downgrade it to a scalar `where`.
   */
  whereIn: boolean;
}

export interface SearchState {
  term?: string;
  filters: SearchFilterEntry[];
}

export interface RawEntry {
  path: string[];
  values: string[];
}

/** The recognised top-level apiable buckets, in the order they're emitted when first populated. */
export type BucketId = 'filter' | 'sort' | 'include' | 'fields' | 'appends' | 'page' | 'q';

const BUCKET_IDS: readonly BucketId[] = ['filter', 'sort', 'include', 'fields', 'appends', 'page', 'q'];

/** Order entries: either a known bucket id, or `raw:<path>` for a custom/unrecognised param. */
export type OrderId = BucketId | `raw:${string}`;

export interface FlexUrlState {
  origin: string;
  pathname: string;
  hash: string;
  order: OrderId[];
  filters: FilterEntry[];
  sorts: SortEntry[];
  includes: string[];
  fields: Record<string, string[]>;
  fieldsOrder: string[];
  appends: Record<string, string[]>;
  appendsOrder: string[];
  page: PageState;
  search: SearchState;
  raw: RawEntry[];
}

export function emptyState(origin = '', pathname = '', hash = ''): FlexUrlState {
  return {
    origin,
    pathname,
    hash,
    order: [],
    filters: [],
    sorts: [],
    includes: [],
    fields: {},
    fieldsOrder: [],
    appends: {},
    appendsOrder: [],
    page: {},
    search: {filters: []},
    raw: [],
  };
}

function withOrder(order: OrderId[], id: OrderId): OrderId[] {
  return order.includes(id) ? order : [...order, id];
}

function rawOrderId(path: readonly string[]): OrderId {
  return `raw:${path.join('.')}`;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Builder-driven upsert: replaces any existing entry for the same (attribute, operator) pair. */
export function setFilter(state: FlexUrlState, attribute: string, operator: string, values: string[]): FlexUrlState {
  const index = state.filters.findIndex(entry => entry.attribute === attribute && entry.operator === operator);
  const entry: FilterEntry = {attribute, operator, values};

  const filters =
    index === -1
      ? [...state.filters, entry]
      : state.filters.map((existing, i) => (i === index ? entry : existing));

  return {...state, filters, order: withOrder(state.order, 'filter')};
}

/** Parse-driven accumulation: merges into any existing entry for the same (attribute, operator) pair. */
export function mergeFilterFromParse(state: FlexUrlState, attribute: string, operator: string, values: string[]): FlexUrlState {
  const index = state.filters.findIndex(entry => entry.attribute === attribute && entry.operator === operator);

  if (index === -1) {
    return {...state, filters: [...state.filters, {attribute, operator, values}], order: withOrder(state.order, 'filter')};
  }

  const filters = state.filters.map((existing, i) =>
    i === index ? {...existing, values: [...existing.values, ...values]} : existing,
  );

  return {...state, filters};
}

/**
 * Adds values to a filter's existing list, skipping ones already there, and
 * creating the entry when it doesn't exist yet. Operates on the bracket-less
 * entry — a multi-value list and a comparison operator don't combine.
 */
/** Index of the plain (bracket-less) entry for an attribute, or `-1`. */
function plainFilterIndex(state: FlexUrlState, attribute: string): number {
  return state.filters.findIndex(entry => entry.attribute === attribute && entry.operator === '');
}

/** A copy of `state` with the values of the filter at `index` swapped out. */
function withFilterValuesAt(state: FlexUrlState, index: number, values: string[]): FlexUrlState {
  return {...state, filters: state.filters.map((entry, i) => (i === index ? {...entry, values} : entry))};
}

export function addFilterValues(state: FlexUrlState, attribute: string, values: readonly string[]): FlexUrlState {
  const index = plainFilterIndex(state, attribute);

  if (index === -1) {
    return setFilter(state, attribute, '', [...values]);
  }

  const merged = [...(state.filters[index]?.values ?? [])];

  for (const value of values) {
    if (!merged.includes(value)) merged.push(value);
  }

  return withFilterValuesAt(state, index, merged);
}

/**
 * Drops values from a filter's list, removing the whole entry once nothing is
 * left — "unticking the last checkbox clears the filter", which is what every
 * multi-select UI wants and what callers otherwise hand-roll.
 */
export function removeFilterValues(state: FlexUrlState, attribute: string, values: readonly string[]): FlexUrlState {
  const index = plainFilterIndex(state, attribute);

  if (index === -1) return state;

  const remaining = (state.filters[index]?.values ?? []).filter(value => !values.includes(value));

  return remaining.length === 0 ? removeFilter(state, attribute, '') : withFilterValuesAt(state, index, remaining);
}

export function removeFilter(state: FlexUrlState, attribute: string, operator?: string): FlexUrlState {
  const filters = state.filters.filter(entry => {
    if (entry.attribute !== attribute) return true;

    return operator === undefined ? false : entry.operator !== operator;
  });

  return {...state, filters};
}

// ---------------------------------------------------------------------------
// Sorts
// ---------------------------------------------------------------------------

export function setSort(state: FlexUrlState, attribute: string, direction: SortDirection): FlexUrlState {
  const index = state.sorts.findIndex(entry => entry.attribute === attribute);
  const entry: SortEntry = {attribute, direction};

  const sorts = index === -1 ? [...state.sorts, entry] : state.sorts.map((existing, i) => (i === index ? entry : existing));

  return {...state, sorts, order: withOrder(state.order, 'sort')};
}

// ---------------------------------------------------------------------------
// Includes
// ---------------------------------------------------------------------------

export function addIncludes(state: FlexUrlState, relationships: readonly string[]): FlexUrlState {
  const includes = [...state.includes];

  for (const relationship of relationships) {
    if (!includes.includes(relationship)) includes.push(relationship);
  }

  return {...state, includes, order: withOrder(state.order, 'include')};
}

// ---------------------------------------------------------------------------
// Fields / appends (structurally identical — one resource type -> column list)
// ---------------------------------------------------------------------------

function addToTypeList(
  bucket: Record<string, string[]>,
  order: string[],
  type: string,
  values: readonly string[],
): {bucket: Record<string, string[]>; order: string[]} {
  const existing = bucket[type] ?? [];
  const merged = [...existing];

  for (const value of values) {
    if (!merged.includes(value)) merged.push(value);
  }

  return {
    bucket: {...bucket, [type]: merged},
    order: order.includes(type) ? order : [...order, type],
  };
}

export function addFields(state: FlexUrlState, type: string, columns: readonly string[]): FlexUrlState {
  const {bucket, order} = addToTypeList(state.fields, state.fieldsOrder, type, columns);

  return {...state, fields: bucket, fieldsOrder: order, order: withOrder(state.order, 'fields')};
}

export function addAppends(state: FlexUrlState, type: string, accessors: readonly string[]): FlexUrlState {
  const {bucket, order} = addToTypeList(state.appends, state.appendsOrder, type, accessors);

  return {...state, appends: bucket, appendsOrder: order, order: withOrder(state.order, 'appends')};
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function setPage(state: FlexUrlState, key: keyof PageState, value: string): FlexUrlState {
  return {...state, page: {...state.page, [key]: value}, order: withOrder(state.order, 'page')};
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function setSearchTerm(state: FlexUrlState, term: string): FlexUrlState {
  return {...state, search: {...state.search, term}, order: withOrder(state.order, 'q')};
}

export function setSearchFilter(state: FlexUrlState, attribute: string, values: string[], whereIn = false): FlexUrlState {
  const index = state.search.filters.findIndex(entry => entry.attribute === attribute);
  const entry: SearchFilterEntry = {attribute, values, whereIn};

  const filters =
    index === -1
      ? [...state.search.filters, entry]
      : state.search.filters.map((existing, i) => (i === index ? entry : existing));

  return {...state, search: {...state.search, filters}, order: withOrder(state.order, 'q')};
}

// ---------------------------------------------------------------------------
// Raw escape hatch
// ---------------------------------------------------------------------------

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}

/** True when `prefix` is `path` itself or an ancestor of it. */
function isPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, i) => segment === path[i]);
}

export function setRawParam(state: FlexUrlState, path: readonly string[], values: string[]): FlexUrlState {
  const index = state.raw.findIndex(entry => samePath(entry.path, path));
  const entry: RawEntry = {path: [...path], values};

  const raw = index === -1 ? [...state.raw, entry] : state.raw.map((existing, i) => (i === index ? entry : existing));

  return {...state, raw, order: withOrder(state.order, rawOrderId(path))};
}

export function mergeRawParamFromParse(state: FlexUrlState, path: readonly string[], value: string): FlexUrlState {
  const index = state.raw.findIndex(entry => samePath(entry.path, path));

  if (index === -1) return setRawParam(state, path, [value]);

  const raw = state.raw.map((existing, i) => (i === index ? {...existing, values: [...existing.values, value]} : existing));

  return {...state, raw};
}

/**
 * Removes raw params by path. With `includeNested`, `path` is treated as a
 * prefix, so `['custom_sort']` also removes `custom_sort[lang]` — which is
 * what a caller passing a bare key means, since a bare key is how a whole
 * bucket is cleared elsewhere in this API.
 */
/** Finds a raw param entry by exact path, or `undefined` when there isn't one. */
export function findRawParam(state: FlexUrlState, path: readonly string[]): RawEntry | undefined {
  return state.raw.find(entry => samePath(entry.path, path));
}

export function removeRawParam(state: FlexUrlState, path: readonly string[], includeNested = false): FlexUrlState {
  const matches = (entry: RawEntry): boolean =>
    includeNested ? isPathPrefix(path, entry.path) : samePath(entry.path, path);

  // Every removed entry takes its own order id with it — a prefix removal can
  // drop several at once, so the ids can't be derived from `path` alone.
  const removedIds = new Set(state.raw.filter(matches).map(entry => rawOrderId(entry.path)));

  return {
    ...state,
    raw: state.raw.filter(entry => !matches(entry)),
    order: state.order.filter(id => !removedIds.has(id)),
  };
}

// ---------------------------------------------------------------------------
// Whole-bucket / whole-state clears
// ---------------------------------------------------------------------------

export function clearBucket(state: FlexUrlState, bucket: BucketId): FlexUrlState {
  const order = state.order.filter(id => id !== bucket);

  switch (bucket) {
    case 'filter':
      return {...state, filters: [], order};
    case 'sort':
      return {...state, sorts: [], order};
    case 'include':
      return {...state, includes: [], order};
    case 'fields':
      return {...state, fields: {}, fieldsOrder: [], order};
    case 'appends':
      return {...state, appends: {}, appendsOrder: [], order};
    case 'page':
      return {...state, page: {}, order};
    case 'q':
      return {...state, search: {filters: []}, order};
    default:
      return state;
  }
}

export function clearAll(state: FlexUrlState): FlexUrlState {
  return emptyState(state.origin, state.pathname, state.hash);
}

export function isBucketId(value: string): value is BucketId {
  return (BUCKET_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Parsing an existing query string into state
// ---------------------------------------------------------------------------

export function hydrateFromSearch(state: FlexUrlState, search: string, options?: FlexUrlOptions): FlexUrlState {
  let next = state;

  for (const {base, path, rawValue} of parseQueryString(search)) {
    if (base === 'filter' && path.length >= 1) {
      const [attribute = '', operator = ''] = path;

      next = mergeFilterFromParse(next, attribute, operator, decodeList(rawValue, options));
      continue;
    }

    if (base === 'sort' && path.length === 0) {
      for (const token of decodeList(rawValue, options)) {
        if (token === '') continue;

        const desc = token.startsWith('-');

        next = setSort(next, desc ? token.slice(1) : token, desc ? 'desc' : 'asc');
      }

      continue;
    }

    if (base === 'include' && path.length === 0) {
      next = addIncludes(next, decodeList(rawValue, options).filter(token => token !== ''));
      continue;
    }

    if (base === 'fields' && path.length === 1) {
      next = addFields(next, path[0] ?? '', decodeList(rawValue, options));
      continue;
    }

    if (base === 'appends' && path.length === 1) {
      next = addAppends(next, path[0] ?? '', decodeList(rawValue, options));
      continue;
    }

    const [pageKey] = path;

    if (base === 'page' && path.length === 1 && (pageKey === 'number' || pageKey === 'size' || pageKey === 'cursor')) {
      next = setPage(next, pageKey, decodeValue(rawValue));
      continue;
    }

    if (base === 'q' && path.length === 0) {
      next = setSearchTerm(next, decodeValue(rawValue));
      continue;
    }

    // q[filter][attribute]=value (single) or q[filter][attribute][]=value (repeated, whereIn semantics).
    if (base === 'q' && path[0] === 'filter' && path.length >= 2) {
      const attribute = path[1] ?? '';
      const value = decodeValue(rawValue);
      const existing = next.search.filters.find(entry => entry.attribute === attribute);
      // `q[filter][tag][]` parses to the path ['filter', 'tag', ''] — the empty
      // third segment is the `[]` marker, and it sticks once any pair carried it.
      const whereIn = (path.length >= 3 && path[2] === '') || existing?.whereIn === true;

      next = setSearchFilter(next, attribute, existing ? [...existing.values, value] : [value], whereIn);
      continue;
    }

    // Unrecognised top-level key (or unrecognised shape of a known one): preserve verbatim.
    next = mergeRawParamFromParse(next, [base, ...path], decodeValue(rawValue));
  }

  return next;
}

// ---------------------------------------------------------------------------
// Serialising state back into a query string
// ---------------------------------------------------------------------------

export function buildQueryString(state: FlexUrlState, options?: FlexUrlOptions): string {
  const pairs: string[] = [];

  for (const id of state.order) {
    if (id === 'filter') {
      for (const entry of state.filters) {
        const path = entry.operator === '' ? [entry.attribute] : [entry.attribute, entry.operator];

        pairs.push(`${buildKey('filter', path)}=${encodeList(entry.values, options)}`);
      }

      continue;
    }

    if (id === 'sort') {
      if (state.sorts.length === 0) continue;

      const tokens = state.sorts.map(entry => (entry.direction === 'desc' ? `-${entry.attribute}` : entry.attribute));

      pairs.push(`sort=${encodeList(tokens, options)}`);
      continue;
    }

    if (id === 'include') {
      if (state.includes.length === 0) continue;

      pairs.push(`include=${encodeList(state.includes, options)}`);
      continue;
    }

    if (id === 'fields') {
      for (const type of state.fieldsOrder) {
        pairs.push(`${buildKey('fields', [type])}=${encodeList(state.fields[type] ?? [], options)}`);
      }

      continue;
    }

    if (id === 'appends') {
      for (const type of state.appendsOrder) {
        pairs.push(`${buildKey('appends', [type])}=${encodeList(state.appends[type] ?? [], options)}`);
      }

      continue;
    }

    if (id === 'page') {
      for (const key of ['number', 'size', 'cursor'] as const) {
        const value = state.page[key];

        if (value !== undefined) pairs.push(`${buildKey('page', [key])}=${encodeValue(value)}`);
      }

      continue;
    }

    if (id === 'q') {
      if (state.search.term !== undefined) pairs.push(`q=${encodeValue(state.search.term)}`);

      for (const entry of state.search.filters) {
        const key = buildKey('q', ['filter', entry.attribute]);

        // A single value uses the plain key; multiple values (or a single one that
        // arrived under an explicit `[]`) use apiable's repeated-`[]` whereIn()
        // convention rather than the comma-list used elsewhere in the grammar.
        if (entry.values.length <= 1 && !entry.whereIn) {
          pairs.push(`${key}=${encodeValue(entry.values[0] ?? '')}`);
        } else {
          for (const value of entry.values) pairs.push(`${key}[]=${encodeValue(value)}`);
        }
      }

      continue;
    }

    // raw:<path>
    const entry = state.raw.find(candidate => rawOrderId(candidate.path) === id);

    if (!entry) continue;

    const key = buildKey(entry.path[0] ?? '', entry.path.slice(1));

    if (entry.values.length <= 1) {
      pairs.push(`${key}=${encodeValue(entry.values[0] ?? '')}`);
    } else {
      for (const value of entry.values) pairs.push(`${key}=${encodeValue(value)}`);
    }
  }

  return pairs.join('&');
}
