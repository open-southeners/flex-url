/**
 * Regression tests for the v1 defects the design plan calls out by name
 * (file refs are from the v1 survey — see the plan for details):
 *
 *  - `FlexibleUrl` kept only `origin`, silently dropping the pathname (`flex-url.ts:23`).
 *  - `remove()` keeps-instead-of-removes on index, and index `0` is falsy (`query-params.ts:225-243`).
 *  - `get exists` iterated positions instead of stored indexes (`query-params.ts:144-147`).
 *  - `fromString` decoded before splitting `=` (`query-params.ts:41`).
 *  - Single-value filters never matched array-value checks (`filter-params.ts:21-23`).
 *  - Sort toggling left array holes, producing `sort=,foo`.
 *  - Encoding was inverted vs. apiable's idiom (commas percent-encoded, brackets raw).
 *  - Mutable aliased state (public `params` array, stateful getters) made instances unsafe to share.
 */
import {describe, expect, it} from 'vitest';

import {decodeList, encodeList} from '../src/encoding.js';
import {flexUrl} from '../src/index.js';

describe('v1 regressions', () => {
  it('preserves the pathname (v1 dropped everything but origin)', () => {
    const built = flexUrl('https://api.example.com/api/v1/posts').filter('status', 'published');

    expect(built.toString()).toBe('https://api.example.com/api/v1/posts?filter[status]=published');
  });

  it('renders an origin-relative URL for client-side navigation (v1 sent router.visit() to "/")', () => {
    // The shape an Inertia/vue-router app actually navigates with: v1 kept only
    // the origin, so `router.visit(url.toString())` landed on the domain root.
    const built = flexUrl('https://app.example.com/projects?page[number]=2#activity').filter('status', 'active');

    expect(built.toRelativeUrl()).toBe('/projects?page[number]=2&filter[status]=active#activity');
    expect(built.toRelativeUrl()).not.toContain('https://');

    // toRequestUri() is the same string minus the fragment — what reaches the server.
    expect(built.toRequestUri()).toBe('/projects?page[number]=2&filter[status]=active');
    expect(built.toRequestUri()).not.toContain('#');
  });

  it('renders just the pathname when there are no params (no dangling "?")', () => {
    expect(flexUrl('/posts').toRelativeUrl()).toBe('/posts');
    expect(flexUrl('/posts').toRequestUri()).toBe('/posts');
  });

  it('removes a filter by attribute regardless of registration order (no falsy-index bug)', () => {
    const withThree = flexUrl('/posts').filter('a', '1').filter('b', '2').filter('c', '3');

    // Removing the *first*-registered filter is the case a falsy-index (`0`) bug would break.
    const withoutFirst = withThree.removeFilter('a');

    expect(withoutFirst.hasFilter('a')).toBe(false);
    expect(withoutFirst.hasFilter('b')).toBe(true);
    expect(withoutFirst.hasFilter('c')).toBe(true);
    expect(withoutFirst.toString()).toBe('/posts?filter[b]=2&filter[c]=3');
  });

  it('hasFilter reflects the current instance only, not stale/aliased state from an earlier one', () => {
    const original = flexUrl('/posts').filter('status', 'published');
    const withoutStatus = original.removeFilter('status');

    // The receiver must be untouched by an operation performed on a derived instance.
    expect(original.hasFilter('status')).toBe(true);
    expect(withoutStatus.hasFilter('status')).toBe(false);
  });

  it('decodes a value only after splitting on the raw "=", not before (an encoded "=" in a value is not mistaken for the separator)', () => {
    const built = flexUrl('/posts').filter('code', 'a=b=c');
    const reparsed = flexUrl(built.toString());

    expect(reparsed.getFilter('code')).toBe('a=b=c');
  });

  it('treats a single-value filter and a one-element array filter identically', () => {
    const single = flexUrl('/posts').filter('status', 'published');
    const arrayOfOne = flexUrl('/posts').filter('status', ['published']);

    expect(single.toString()).toBe(arrayOfOne.toString());
    expect(single.getFilter('status')).toEqual(arrayOfOne.getFilter('status'));
    expect(single.hasFilter('status')).toBe(true);
  });

  it('never leaves array holes when sorts are cleared (no "sort=,foo")', () => {
    const cleared = flexUrl('/posts').sort('foo').removeParam('sort').sort('bar');

    expect(cleared.toString()).toBe('/posts?sort=bar');
    expect(cleared.toString()).not.toContain(',,');
    expect(cleared.toString()).not.toMatch(/sort=,/);
  });

  it('emits raw commas as the multi-value separator and raw brackets structurally (v1 had this inverted)', () => {
    const built = flexUrl('/posts').filter('status', ['published', 'draft']);

    expect(built.toString()).toBe('/posts?filter[status]=published,draft');
    expect(built.toString()).not.toContain('%2C');
    expect(built.toString()).not.toContain('%5B');
  });

  it('instances are immutable: every mutator returns a new instance, the receiver is never changed', () => {
    const base = flexUrl('/posts');
    const withFilter = base.filter('status', 'published');

    expect(base).not.toBe(withFilter);
    expect(base.toString()).toBe('/posts');
    expect(withFilter.toString()).toBe('/posts?filter[status]=published');
  });
});

describe('list encoding round-trips', () => {
  // `decodeList`/`encodeList` must be stable under repetition: whatever a value
  // decodes to has to survive being re-encoded and decoded again. Encoding a
  // comma as `%2C` broke this — it rendered `a%2Cb` once and `a,b` thereafter —
  // and nothing else in the suite would have caught it, because every fixture
  // starts from a canonical URL rather than an arbitrary one.
  const inputs = [
    'a,b', 'a%2Cb', 'a%2Cb,c', '', ',', ',,', 'a,,b', 'x%252Cy',
    'Smith%2C%20John', 'a+b,c', '20%,b', '%FF,a', 'é,ü', 'a%3Db,c',
  ];

  for (const input of inputs) {
    it(`is stable for ${JSON.stringify(input)}`, () => {
      const once = decodeList(input);
      const twice = decodeList(encodeList(once));

      expect(twice).toEqual(once);
      expect(encodeList(twice)).toBe(encodeList(once));
    });
  }
});

describe('flexUrl() with {strictCommaEncoding: true}', () => {
  it('applies the option through the public factory, round-tripping a literal comma inside a filter value', () => {
    const built = flexUrl('/posts', undefined, {strictCommaEncoding: true}).filter('title', 'foo,bar');

    expect(built.toString()).toBe('/posts?filter[title]=foo%2Cbar');

    const reparsed = flexUrl(built.toString(), undefined, {strictCommaEncoding: true});

    expect(reparsed.getFilter('title')).toBe('foo,bar');
  });

  it('leaves an existing two-arg flexUrl(url, schema) call source-compatible (options defaults to lenient)', () => {
    const built = flexUrl('/posts').filter('status', ['published', 'draft']);

    expect(built.toString()).toBe('/posts?filter[status]=published,draft');
    expect(built.getFilter('status')).toEqual(['published', 'draft']);
  });
});
