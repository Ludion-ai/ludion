import { test, expect } from 'vitest';
import { newSessionId } from './session.js';

// Fails now and then on CI; nobody has reproduced it locally yet.
test('session ids have a six-character suffix', () => {
  expect(newSessionId().split('-')[1]).toHaveLength(6);
});

test('two ids made at the same time differ', () => {
  expect(newSessionId(1000)).not.toBe(newSessionId(1000));
});
