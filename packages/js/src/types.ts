/**
 * Filter comparison operators accepted by `filter()`/`between()`.
 *
 * `'equal'` is the canonical wire key laravel-apiable expects for
 * `AllowedFilter::EXACT` (`filter[attr][equal]=value`) — sending `eq` on the
 * wire is silently dropped by apiable as an unregistered operator key.
 * `'eq'` is still accepted as an *input* alias (see {@link normaliseOperator})
 * for ergonomics, but always normalises to `'equal'` before it reaches the
 * wire, `toParams()`, or the `EndpointSchema` operator union below.
 *
 * `'not_equal'`/`'not_like'` are the negations of `'equal'`/`'like'`. They are
 * part of this grammar, but a given backend has to register them for the
 * attribute like any other operator — an unregistered operator key is rejected
 * rather than applied, so check the server side before reaching for them.
 */
export type FilterOperator = 'equal' | 'like' | 'gt' | 'gte' | 'lt' | 'lte' | 'not_equal' | 'not_like';

/**
 * Operator identifiers accepted as *input* to `filter()`/`between()`.
 * `'eq'`/`'neq'` are DX aliases for `'equal'`/`'not_equal'` — see
 * {@link FilterOperator}.
 */
export type FilterOperatorInput = FilterOperator | 'eq' | 'neq';

/**
 * Sort direction as exposed by the read API (`getSorts()`).
 */
export type SortDirection = 'asc' | 'desc';

/**
 * A single accumulated sort entry, in call order.
 */
export interface SortEntry {
  attribute: string;
  direction: SortDirection;
}

/** One `filter[attribute][operator]=values` entry, as returned by `getFilters()`. */
export interface FilterEntry {
  attribute: string;
  /** `''` for a plain `filter[attribute]=value` with no operator bracket. */
  operator: string;
  values: string[];
}

/**
 * Options accepted by `filterScope()`.
 */
export interface FilterScopeOptions {
  /**
   * Append the `_scoped` suffix to the scope name on the wire
   * (`filter[published_scoped]=1`), matching apiable's
   * `requests.filters.enforce_scoped_names` config.
   */
  scoped?: boolean;
}

/**
 * A value acceptable anywhere flex-url expects a single scalar (coerced to
 * string via `String()` before encoding).
 */
export type ScalarValue = string | number | boolean;

/**
 * Describes a single endpoint's allowed request-query vocabulary, as emitted
 * by apiable's `apiable:types` exporter. This is the generation contract
 * shared between the TS core, the PHP mirror, and the exporter — the exact
 * shape below must not be deviated from by any consumer.
 *
 * Every array/record-of-array property is declared `readonly` so that a
 * consumer's generated schema module — typically exported `as const` for
 * literal narrowing, as apiable's exporter does — structurally satisfies
 * this interface directly. TypeScript allows a mutable array to widen into a
 * `readonly` one but never the reverse, so a *mutable* `EndpointSchema`
 * would reject any `as const` schema object outright, forcing consumers into
 * an `as`-cast workaround. A plain hand-authored (non-`const`) schema object
 * literal still satisfies this interface unchanged, since object literals'
 * mutable array properties are assignable to `readonly` ones.
 */
export interface EndpointSchema {
  resource: string;
  path: string;
  filters: Readonly<Record<string, { operators: ReadonlyArray<'equal' | 'like' | 'gt' | 'gte' | 'lt' | 'lte' | 'not_equal' | 'not_like' | 'scope'>; values?: readonly string[] }>>;
  sorts: readonly string[];
  includes: readonly string[];
  fields: Readonly<Record<string, readonly string[]>>;
  appends: Readonly<Record<string, readonly string[]>>;
  defaultSort?: string;
  defaultFilters?: Readonly<Record<string, string>>;
}

/**
 * Guards every schema-narrowing conditional below against the no-schema
 * default.
 *
 * `FlexUrl`'s generic defaults to `undefined`, and each conditional falls back
 * to "any attribute name" for that case. That fallback works only under
 * `strictNullChecks`: with it off, `undefined` is assignable to every type, so
 * `undefined extends EndpointSchema` is *true*, the schema branch is taken, and
 * `keyof undefined['filters']` collapses the argument to `never` — no untyped
 * `filter()` call compiles at all. Settling the no-schema case first stops the
 * schema test from misfiring.
 *
 * The tuple wrapper keeps the check from distributing over a union.
 */
type WithoutSchema<S> = [S] extends [undefined] ? true : false;

/** Narrows the filter `attribute` argument to a schema's allowed keys. */
export type FilterAttribute<S> = WithoutSchema<S> extends true
  ? string
  : S extends EndpointSchema
    ? Extract<keyof S['filters'], string>
    : string;

/** Narrows the filter `operator` argument for a given attribute, given a schema. */
export type FilterOperatorFor<S, A extends string> = WithoutSchema<S> extends true
  ? FilterOperatorInput
  : S extends EndpointSchema
    ? A extends keyof S['filters']
      ? Exclude<S['filters'][A]['operators'][number], 'scope'> | 'eq' | 'neq'
      : FilterOperatorInput
    : FilterOperatorInput;

/** Narrows the `sort()`/`sortDesc()` attribute argument to a schema's allowed sorts. */
export type SortAttribute<S> = WithoutSchema<S> extends true
  ? string
  : S extends EndpointSchema
    ? S['sorts'][number]
    : string;

/** Narrows the `include()` argument(s) to a schema's allowed relationships. */
export type IncludeAttribute<S> = WithoutSchema<S> extends true
  ? string
  : S extends EndpointSchema
    ? S['includes'][number]
    : string;

/** Narrows the `fields()`/`append()` resource-type argument to a schema's known types. */
export type ResourceType<S, K extends 'fields' | 'appends'> = WithoutSchema<S> extends true
  ? string
  : S extends EndpointSchema
    ? Extract<keyof S[K], string>
    : string;

/** Narrows the `fields(type, ...cols)` column arguments for a given resource type. */
export type FieldsColumn<S, T extends string> = WithoutSchema<S> extends true
  ? string
  : S extends EndpointSchema
    ? T extends keyof S['fields']
      ? S['fields'][T][number]
      : string
    : string;

/** Narrows the `append(type, ...accessors)` accessor arguments for a given resource type. */
export type AppendsAccessor<S, T extends string> = WithoutSchema<S> extends true
  ? string
  : S extends EndpointSchema
    ? T extends keyof S['appends']
      ? S['appends'][T][number]
      : string
    : string;

/**
 * Nested object form produced by `toParams()`. Mirrors the bracket structure
 * used on the wire; see the `toParams()` doc comment on `FlexUrl` for the
 * exact shape rules.
 */
export type ParamsObject = Record<string, unknown>;
