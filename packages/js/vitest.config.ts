import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      // `lcov` alongside `clover` because Codecov reads the two differently.
      // istanbul's clover writes a conditional as
      // `truecount="<branches covered>" falsecount="<branches uncovered>"`,
      // while Codecov reads those as "times true"/"times false" — so a fully
      // covered branch (`truecount="2" falsecount="0"`) is reported as a
      // *partial*. lcov's `BRDA:` records carry a hit count per path and are
      // read correctly. See `.github/workflows/tests.yml` for which file is
      // uploaded.
      reporter: ['clover', 'lcov'],
    },
  },
});
