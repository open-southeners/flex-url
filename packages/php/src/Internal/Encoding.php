<?php

declare(strict_types=1);

namespace OpenSoutheners\FlexUrl\Internal;

use OpenSoutheners\FlexUrl\FlexUrlOptions;

/**
 * Encoding contract (mirrored from the TypeScript core's `encoding.ts` — do
 * not change without updating both, plus `fixtures/cases.json`):
 *
 * - Structural brackets (`filter[attr][op]`) and the comma that separates
 *   multiple values in a list (`filter[status]=published,draft`) are emitted
 *   RAW on output — this matches apiable's own idiom and its generated
 *   pagination links.
 * - Every individual value is percent-encoded the same way JavaScript's
 *   `encodeURIComponent` would *before* being joined into a list, so a literal
 *   bracket/space/`%`/`=`/`&` inside one value can never be confused with the
 *   structural characters.
 * - A COMMA IS ALWAYS A SEPARATOR in a list-valued param, whether it arrives
 *   raw or as `%2C`. Lists are decoded first and split afterwards, and a comma
 *   inside a value is emitted raw rather than escaped. apiable does the same
 *   thing — `explode(',', $decodedValue)` for `filter`, `sort`, `include`,
 *   `fields` and `appends` — so `%2C` and `,` were never distinguishable
 *   server-side, and pretending otherwise made flex-url report one opaque
 *   value for a URL the backend filters by several. It also could not survive
 *   a round-trip: Symfony's `normalizeQueryString()` (behind `fullUrl()`, and
 *   so behind every Inertia response) rewrites `filter[a]=1,2` as
 *   `filter%5Ba%5D=1%2C2`. A comma inside a single value is therefore not
 *   representable. Scalar params (`q`, `page[...]`, `param()`) are unaffected:
 *   nothing splits them, so their commas stay literal.
 * - Keys are decoded as a whole before their bracket structure is parsed, so
 *   `filter[status]` and the percent-encoded `filter%5Bstatus%5D` (as used
 *   by apiable's own pagination links) both parse identically.
 * - `=` is never assumed inside a key/value pair until *after* splitting on
 *   the first raw `=` — decoding before splitting would let an encoded
 *   `%3D` inside a value be mistaken for the key/value separator.
 * - A raw `+` in a query key or value is a SPACE on input (form-urlencoding,
 *   matching `parse_str` / `Request::query()` / `URLSearchParams`); `%2B` is a
 *   literal plus. `+` -> ` ` is applied *before* percent-decoding. Output never
 *   emits `+`. Invariant: re-serialising a parsed URL never changes what the
 *   server reads.
 * - Decoding never throws and never yields invalid UTF-8. A `%` that isn't
 *   followed by two hex digits is a literal `%` (so `20%`, `50%off` and `%zz`
 *   survive), and bytes that don't form valid UTF-8 become U+FFFD. The
 *   TypeScript mirror implements the same three steps over the same byte
 *   sequence, so both languages return identical strings for identical input
 *   — including malformed input.
 *
 * @internal
 *
 * @SuppressWarnings("PHPMD.StaticAccess")
 */
final class Encoding
{
    /** Characters `rawurlencode()` (RFC 3986) escapes that `encodeURIComponent` (JS) does not. */
    private const UNRESERVED_MARKS = [
        '%21' => '!',
        '%27' => "'",
        '%28' => '(',
        '%29' => ')',
        '%2A' => '*',
    ];

    private function __construct() {}

    /**
     * Percent-encode a single scalar value for the wire, matching
     * `encodeURIComponent` (space -> `%20`, plus -> `%2B`).
     */
    public static function encodeValue(string $value): string
    {
        return strtr(rawurlencode($value), self::UNRESERVED_MARKS);
    }

    /**
     * Percent-decode a single scalar value read off the wire, in three steps:
     * `+` -> space, then each `%XX` -> its byte, then the whole byte sequence
     * -> UTF-8 (invalid sequences become U+FFFD).
     *
     * Deliberately not `rawurldecode()`/`urldecode()`: those return raw bytes,
     * so a latin-1 or truncated escape yields a string that isn't valid UTF-8
     * — which makes `json_encode()` return `false` and Laravel's
     * `response()->json()` throw "Malformed UTF-8 characters" on nothing worse
     * than a `?name=%FF` in the query. Never throws.
     */
    public static function decodeValue(string $raw): string
    {
        $source = str_replace('+', ' ', $raw);

        $bytes = preg_replace_callback(
            '/%([0-9A-Fa-f]{2})/',
            static fn (array $matches): string => chr((int) hexdec($matches[1])),
            $source,
        );

        return Utf8::scrub($bytes ?? $source);
    }

    /**
     * Encode a list of values into their comma-joined wire representation.
     *
     * By default (lenient, `$options->strictCommaEncoding === false`), a
     * comma inside a value is *not* escaped, because in list position there
     * is nothing to escape it from: the server splits the decoded value on
     * every comma, so `%2C` and `,` mean the same thing to it. Emitting the
     * comma raw keeps `toString()` idempotent.
     *
     * With `strictCommaEncoding` enabled, a literal comma inside a value is
     * kept percent-encoded (`%2C`) rather than unescaped, so it survives as
     * part of the value instead of being read back as a separator — see
     * `decodeList()`.
     *
     * @param  list<string>  $values
     */
    public static function encodeList(array $values, FlexUrlOptions $options = new FlexUrlOptions): string
    {
        if ($options->strictCommaEncoding) {
            return implode(',', array_map(self::encodeValue(...), $values));
        }

        $encoded = array_map(
            static fn (string $value): string => str_replace('%2C', ',', self::encodeValue($value)),
            $values,
        );

        return implode(',', $encoded);
    }

    /**
     * Decode a raw value, then split it on every comma — a comma is a
     * separator however it was encoded. An empty raw string yields an empty
     * list rather than `['']`.
     *
     * With `strictCommaEncoding` enabled, the *raw* (still percent-encoded)
     * string is split on a literal `,` first, and each resulting piece is
     * decoded afterwards — so a `%2C` inside a value is preserved as a
     * literal comma rather than treated as a separator, restoring the
     * ability to send a literal comma inside a single value.
     *
     * @return list<string>
     */
    public static function decodeList(string $raw, FlexUrlOptions $options = new FlexUrlOptions): array
    {
        if ($raw === '') {
            return [];
        }

        if ($options->strictCommaEncoding) {
            return array_map(self::decodeValue(...), explode(',', $raw));
        }

        return explode(',', self::decodeValue($raw));
    }

    /** Encode a single key segment (attribute/type/operator name) for use inside brackets. */
    public static function encodeKeySegment(string $segment): string
    {
        return self::encodeValue($segment);
    }

    /**
     * Build a bracketed wire key, e.g. `buildKey('filter', ['due_at', 'gte'])`
     * -> `"filter[due_at][gte]"`. An empty `path` yields the base key unchanged.
     *
     * @param  list<string>  $path
     */
    public static function buildKey(string $base, array $path = []): string
    {
        $key = self::encodeKeySegment($base);

        foreach ($path as $segment) {
            $key .= '['.self::encodeKeySegment($segment).']';
        }

        return $key;
    }

    /**
     * Parse a fully-decoded key string into its base segment and bracket
     * path, e.g. `"filter[due_at][gte]"` -> `['base' => 'filter', 'path' =>
     * ['due_at', 'gte']]`. Malformed bracket structure degrades gracefully to
     * `['base' => $decodedKey, 'path' => []]`.
     *
     * @return array{base: string, path: list<string>}
     */
    public static function parseKey(string $decodedKey): array
    {
        if (preg_match('/^([^\[\]]+)((?:\[[^\[\]]*])*)$/', $decodedKey, $matches) !== 1) {
            return ['base' => $decodedKey, 'path' => []];
        }

        $path = [];

        if (preg_match_all('/\[([^\[\]]*)]/', $matches[2], $pathMatches) > 0) {
            $path = $pathMatches[1];
        }

        return ['base' => $matches[1], 'path' => $path];
    }

    /**
     * Parse a full query string (with or without a leading `?`) into ordered
     * entries.
     *
     * @return list<array{base: string, path: list<string>, rawValue: string}>
     */
    public static function parseQueryString(string $search): array
    {
        $trimmed = str_starts_with($search, '?') ? substr($search, 1) : $search;

        if ($trimmed === '') {
            return [];
        }

        $entries = [];

        foreach (explode('&', $trimmed) as $pair) {
            if ($pair === '') {
                continue;
            }

            $equalsIndex = strpos($pair, '=');
            $rawKey = $equalsIndex === false ? $pair : substr($pair, 0, $equalsIndex);
            $rawValue = $equalsIndex === false ? '' : substr($pair, $equalsIndex + 1);
            $keyParts = self::parseKey(self::decodeValue($rawKey));

            $entries[] = [
                'base' => $keyParts['base'],
                'path' => $keyParts['path'],
                'rawValue' => $rawValue,
            ];
        }

        return $entries;
    }
}
