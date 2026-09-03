/**
 * `flex-url` — an immutable, fluent URL builder/parser for
 * the apiable request-query grammar (`filter`, `sort`, `include`, `fields`,
 * `appends`, `page`, `q`).
 *
 * ```ts
 * import {url} from 'flex-url';
 *
 * url('https://api.example.com/posts')
 *   .filter('status', 'published')
 *   .sort('-created_at')
 *   .include('tags', 'author')
 *   .page(1)
 *   .toString();
 * // => "https://api.example.com/posts?filter[status]=published&sort=-created_at&include=tags,author&page[number]=1"
 * ```
 *
 * The `links(doc)`/`meta(doc)`/`nextUrl(doc)`/`prevUrl(doc)` JSON:API
 * pagination helpers live at the `flex-url/links` subpath
 * so they can be tree-shaken out when unused.
 */
export {FlexUrl, flexUrl, url} from './flex-url.js';

export type {
  AppendsAccessor,
  EndpointSchema,
  FieldsColumn,
  FilterAttribute,
  FilterOperator,
  FilterOperatorFor,
  FilterOperatorInput,
  FilterScopeOptions,
  IncludeAttribute,
  ParamsObject,
  ResourceType,
  ScalarValue,
  SortAttribute,
  SortDirection,
  SortEntry,
} from './types.js';

export const VERSION = '2.0.0';
