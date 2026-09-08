/**
 * Unit coverage for `encodeList`/`decodeList`'s opt-in `strictCommaEncoding`
 * option (see `encoding.ts`'s encoding-contract doc comment). Strict mode
 * splits the *raw*, still-percent-encoded string on a literal `,` only,
 * decoding each resulting piece afterwards — `%2C` is never treated as a
 * separator, unlike the lenient default which decodes first and splits on
 * whatever commas fall out.
 */
import {describe, expect, it} from 'vitest';

import {decodeList, encodeList} from '../src/encoding.js';

describe('decodeList/encodeList with {strictCommaEncoding: true}', () => {
  it('decodes an empty string to an empty list', () => {
    expect(decodeList('', {strictCommaEncoding: true})).toEqual([]);
  });

  it('decodes a value with no comma to a single-element list', () => {
    expect(decodeList('foo', {strictCommaEncoding: true})).toEqual(['foo']);
  });

  it('splits on a raw comma', () => {
    expect(decodeList('foo,bar', {strictCommaEncoding: true})).toEqual(['foo', 'bar']);
  });

  it('keeps a %2C as literal content rather than splitting on it', () => {
    expect(decodeList('foo%2Cbar', {strictCommaEncoding: true})).toEqual(['foo,bar']);
  });

  it('mixes a literal comma (kept) and a raw comma (a separator) in the same value', () => {
    expect(decodeList('foo%2Cbar,baz', {strictCommaEncoding: true})).toEqual(['foo,bar', 'baz']);
  });

  it('encodeList does not unescape %2C back to a raw comma', () => {
    const encoded = encodeList(['foo,bar'], {strictCommaEncoding: true});

    expect(encoded).toBe('foo%2Cbar');
    expect(encoded).not.toContain(',');
  });

  it('encodeList still raw-joins multiple values with a comma', () => {
    expect(encodeList(['published', 'draft'], {strictCommaEncoding: true})).toBe('published,draft');
  });

  it('round-trips a literal comma through encodeList -> decodeList', () => {
    const values = ['foo,bar', 'baz'];
    const encoded = encodeList(values, {strictCommaEncoding: true});

    expect(decodeList(encoded, {strictCommaEncoding: true})).toEqual(values);
  });
});

describe('decodeList/encodeList without the option (regression guard)', () => {
  // Omitting the option entirely, or passing `undefined` explicitly, must be
  // byte-identical to the lenient default — strict mode is opt-in only.
  const decodeInputs = ['', 'foo', 'foo,bar', 'foo%2Cbar', 'foo%2Cbar,baz', 'a+b,c', '%FF,a'];

  for (const input of decodeInputs) {
    it(`decodeList(${JSON.stringify(input)}) is unchanged by an absent/undefined option`, () => {
      const noArg = decodeList(input);
      const explicitUndefined = decodeList(input, undefined);
      const emptyOptions = decodeList(input, {});

      expect(explicitUndefined).toEqual(noArg);
      expect(emptyOptions).toEqual(noArg);
    });
  }

  const encodeInputs: string[][] = [[], ['foo'], ['foo,bar'], ['published', 'draft'], ['foo,bar', 'baz']];

  for (const values of encodeInputs) {
    it(`encodeList(${JSON.stringify(values)}) is unchanged by an absent/undefined option`, () => {
      const noArg = encodeList(values);
      const explicitUndefined = encodeList(values, undefined);
      const emptyOptions = encodeList(values, {});

      expect(explicitUndefined).toBe(noArg);
      expect(emptyOptions).toBe(noArg);
    });
  }
});
