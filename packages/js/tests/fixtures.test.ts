/**
 * Replays `fixtures/cases.json` — the language-neutral contract shared with
 * the PHPUnit suite (see `fixtures/SCHEMA.md`). Every case's `build` steps
 * are applied in order to a fresh builder from `base`, the result is
 * compared against `url`, and (when present) every `reads` assertion is
 * checked against a fresh builder parsed straight back from that `url`.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {flexUrl, type FlexUrlOptions} from '../src/index.js';

interface FixtureOperation {
  op: string;
  args: unknown[];
}

interface FixtureRead extends FixtureOperation {
  equals: unknown;
}

interface FixtureCase {
  name: string;
  base: string;
  /** Construction options passed to `flexUrl()` alongside `base`/`url`. Defaults to `{}` (today's lenient behaviour). */
  options?: FlexUrlOptions;
  build: FixtureOperation[];
  url: string;
  /** Which URL `reads` is checked against — see `fixtures/SCHEMA.md`. Defaults to `'url'`. */
  readsFrom?: 'base' | 'url';
  reads?: FixtureRead[];
}

const fixturesPath = fileURLToPath(new URL('../../../fixtures/cases.json', import.meta.url));
const cases = JSON.parse(readFileSync(fixturesPath, 'utf8')) as FixtureCase[];

// A generic runner necessarily calls methods dynamically by name — indexing with `any` is the point here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBuilder = any;

describe('shared fixtures (fixtures/cases.json)', () => {
  it('is not empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) {
    it(testCase.name, () => {
      let builder: AnyBuilder = flexUrl(testCase.base, undefined, testCase.options);

      for (const step of testCase.build) {
        builder = builder[step.op](...step.args);
      }

      expect(builder.toString()).toBe(testCase.url);

      // Re-parsing the canonical output must reproduce it byte for byte. Asserted
      // for every case rather than a chosen few: it is the invariant that breaks
      // first when encoding and parsing stop being exact inverses of each other.
      expect(flexUrl(testCase.url, undefined, testCase.options).toString()).toBe(testCase.url);

      if (!testCase.reads) return;

      const reader: AnyBuilder = flexUrl(testCase.readsFrom === 'base' ? testCase.base : testCase.url, undefined, testCase.options);

      for (const read of testCase.reads) {
        // A fixture's `null` means "absent"; PHP returns null where we return
        // undefined, and no fixture should have to care which. See SCHEMA.md.
        const actual = reader[read.op](...read.args);

        expect(actual === undefined ? null : actual).toEqual(read.equals);
      }
    });
  }
});
