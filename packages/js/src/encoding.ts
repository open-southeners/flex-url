/**
 * Encoding contract (mirrored by the PHP package — do not change without
 * updating both, plus `fixtures/cases.json`):
 *
 * - Structural brackets (`filter[attr][op]`) and the comma that separates
 *   multiple values in a list (`filter[status]=published,draft`) are emitted
 *   RAW on output — this matches apiable's own idiom and its generated
 *   pagination links.
 * - Every individual value is percent-encoded with `encodeURIComponent`
 *   *before* being joined into a list, so a literal bracket/space/`&`/`=`/`%`
 *   inside one value can never be confused with the structural characters.
 * - A COMMA IS ALWAYS A SEPARATOR in a list-valued param, whether it arrives
 *   raw or as `%2C`. Lists are decoded first and split afterwards, and a comma
 *   inside a value is emitted raw rather than escaped. apiable does the same
 *   thing — `explode(',', $decodedValue)` for `filter`, `sort`, `include`,
 *   `fields` and `appends` — so `%2C` and `,` were never distinguishable
 *   server-side, and pretending otherwise made flex-url report one opaque
 *   value for a URL the backend filters by several. It also could not survive
 *   a round-trip: Symfony's `normalizeQueryString()` (behind Laravel's
 *   `fullUrl()`, and so behind every Inertia response) rewrites `filter[a]=1,2`
 *   as `filter%5Ba%5D=1%2C2`. A comma inside a single value is therefore not
 *   representable — the same limitation as OpenAPI's `style: form,
 *   explode: false`. Scalar params (`q`, `page[...]`, `param()`) are
 *   unaffected: nothing splits them, so their commas stay literal.
 * - Keys are decoded as a whole before their bracket structure is parsed, so
 *   `filter[status]` and the percent-encoded `filter%5Bstatus%5D` (as used by
 *   apiable's own pagination links) both parse identically.
 * - `=` is never assumed inside a key/value pair until *after* splitting on
 *   the first raw `=` — decoding before splitting (a v1 bug) would let an
 *   encoded `%3D` inside a value be mistaken for the key/value separator.
 * - A raw `+` in a query key or value is a SPACE on input (form-urlencoding,
 *   matching `parse_str` / `Request::query()` / `URLSearchParams`); `%2B` is a
 *   literal plus. `+` → ` ` is applied *before* percent-decoding. Output never
 *   emits `+`. Invariant: re-serialising a parsed URL never changes what the
 *   server reads.
 * - Decoding never throws and never yields invalid UTF-8. A `%` that isn't
 *   followed by two hex digits is a literal `%` (so `20%`, `50%off` and `%zz`
 *   survive), and bytes that don't form valid UTF-8 become U+FFFD. The PHP
 *   mirror implements the same three steps over the same byte sequence, so
 *   both languages return identical strings for identical input — including
 *   malformed input.
 */

/**
 * Matches one percent-escape. A `%` not followed by two hex digits simply
 * doesn't match, and is therefore carried through as a literal `%`.
 */
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/g;

/** Non-fatal by contract: invalid byte sequences decode to U+FFFD instead of throwing. */
const UTF8_DECODER = new TextDecoder('utf-8');
const UTF8_ENCODER = new TextEncoder();

/**
 * Construction options accepted by `flexUrl()`/`FlexUrl` (and threaded down
 * into the list encode/decode helpers below). Mirrored by the PHP package —
 * do not add/rename a key here without updating both, plus `fixtures/SCHEMA.md`.
 */
export interface FlexUrlOptions {
  /**
   * Opt-in strict list encoding: a list value (`filter`/`sort`/`include`/
   * `fields`/`appends`) is split on a raw `,` only, decoding each resulting
   * piece afterwards — `%2C` is never treated as a separator, so a literal
   * comma can be sent inside one value. Default `false`, which keeps today's
   * lenient behaviour (decode first, then split on every comma however it
   * was encoded).
   */
  strictCommaEncoding?: boolean;
}

/** Percent-encode a single scalar value for the wire (space → `%20`, plus → `%2B`). */
export function encodeValue(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Percent-decode a single scalar value read off the wire, in three steps:
 * `+` → space, then each `%XX` → its byte, then the whole byte sequence →
 * UTF-8 (invalid sequences become U+FFFD).
 *
 * Deliberately not `decodeURIComponent`, which is all-or-nothing: it throws on
 * a single malformed escape, discarding the rest of an otherwise fine value,
 * and its failure mode doesn't line up with what PHP's byte-oriented
 * `rawurldecode` does — the two implementations diverged on every malformed
 * or non-UTF-8 input. Never throws.
 */
export function decodeValue(raw: string): string {
  const source = raw.replace(/\+/g, ' ');
  const bytes: number[] = [];
  let cursor = 0;

  const pushText = (text: string): void => {
    for (const byte of UTF8_ENCODER.encode(text)) bytes.push(byte);
  };

  for (const match of source.matchAll(PERCENT_ESCAPE)) {
    const start = match.index ?? 0;

    // Text between the previous escape and this one is literal — encode it as
    // UTF-8 in one go so surrogate pairs stay intact.
    if (start > cursor) pushText(source.slice(cursor, start));

    bytes.push(Number.parseInt(match[0].slice(1), 16));
    cursor = start + match[0].length;
  }

  if (cursor < source.length) pushText(source.slice(cursor));

  return UTF8_DECODER.decode(Uint8Array.from(bytes));
}

/**
 * Encode a list of values into their comma-joined wire representation.
 *
 * A comma inside a value is *not* escaped, because in list position there is
 * nothing to escape it from: the server splits the decoded value on every
 * comma, so `%2C` and `,` mean the same thing to it. Emitting the comma raw
 * keeps `toString()` idempotent — escaping it would render `a%2Cb` first and
 * `a,b` after a round-trip.
 */
export function encodeList(values: readonly string[], options?: FlexUrlOptions): string {
  if (options?.strictCommaEncoding) {
    return values.map(value => encodeValue(value)).join(',');
  }

  return values.map(value => encodeValue(value).replaceAll('%2C', ',')).join(',');
}

/**
 * Decode a raw value, then split it on every comma — a comma is a separator
 * however it was encoded. An empty raw string yields an empty list rather
 * than `['']`.
 *
 * With `{strictCommaEncoding: true}` this instead splits the still-encoded
 * `raw` string on a literal `,` first, decoding each resulting piece
 * afterwards — a `%2C` inside a piece is never treated as a separator, which
 * is what lets a literal comma survive inside one list value.
 */
export function decodeList(raw: string, options?: FlexUrlOptions): string[] {
  if (raw === '') return [];

  if (options?.strictCommaEncoding) {
    return raw.split(',').map(piece => decodeValue(piece));
  }

  return decodeValue(raw).split(',');
}

/** Encode a single key segment (attribute/type/operator name) for use inside brackets. */
export function encodeKeySegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Build a bracketed wire key, e.g. `buildKey('filter', ['due_at', 'gte'])` →
 * `"filter[due_at][gte]"`. An empty `path` yields the base key unchanged.
 */
export function buildKey(base: string, path: readonly string[] = []): string {
  return path.reduce((key, segment) => `${key}[${encodeKeySegment(segment)}]`, encodeKeySegment(base));
}

/**
 * Parse a fully-decoded key string into its base segment and bracket path,
 * e.g. `"filter[due_at][gte]"` → `{ base: 'filter', path: ['due_at', 'gte'] }`.
 * Malformed bracket structure degrades gracefully to `{ base: key, path: [] }`.
 */
export function parseKey(decodedKey: string): { base: string; path: string[] } {
  const match = /^([^[\]]+)((?:\[[^[\]]*])*)$/.exec(decodedKey);

  if (!match) {
    return { base: decodedKey, path: [] };
  }

  const [, base = decodedKey, bracketSegment = ''] = match;
  const path = Array.from(bracketSegment.matchAll(/\[([^[\]]*)]/g)).map(segmentMatch => segmentMatch[1] ?? '');

  return { base, path };
}

/** A single raw `key=value` pair extracted from a query string, key already decoded. */
export interface ParsedQueryEntry {
  base: string;
  path: string[];
  /** Still percent-encoded — callers choose `decodeValue` or `decodeList` based on context. */
  rawValue: string;
}

/** Parse a full query string (with or without a leading `?`) into ordered entries. */
export function parseQueryString(search: string): ParsedQueryEntry[] {
  const trimmed = search.startsWith('?') ? search.slice(1) : search;

  if (!trimmed) return [];

  return trimmed
    .split('&')
    .filter(pair => pair !== '')
    .map(pair => {
      const equalsIndex = pair.indexOf('=');
      const rawKey = equalsIndex === -1 ? pair : pair.slice(0, equalsIndex);
      const rawValue = equalsIndex === -1 ? '' : pair.slice(equalsIndex + 1);
      const { base, path } = parseKey(decodeValue(rawKey));

      return { base, path, rawValue };
    });
}
