import {describe, expect, it} from 'vitest';

import {VERSION} from '../src/index.js';

describe('package scaffold', () => {
  it('exports the current version', () => {
    expect(VERSION).toBe('2.0.0');
  });
});
