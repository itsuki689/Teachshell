import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materialSearchMatches,
  readDisplayPreferences,
  selectionRange,
} from '../shared/workspace-ui.ts';

test('material search matches every whitespace-separated word across title, tags, notes and course', () => {
  assert.equal(
    materialSearchMatches(' 极限\t复习\nMATH ', ['函数极限', '期末复习', undefined, 'Math 101']),
    true,
  );
  assert.equal(materialSearchMatches('极限 缺少', ['函数极限', '期末复习']), false);
  assert.equal(materialSearchMatches(' \n\t ', []), true);
});
test('display preferences accept only supported display modes and discard extra fields', () => {
  assert.deepEqual(
    readDisplayPreferences({
      libraryLayout: 'grid',
      planMode: 'month',
      timetableMode: 'timeline',
      root: '/private/library',
      day: '2026-09-16',
    }),
    { libraryLayout: 'grid', planMode: 'month', timetableMode: 'timeline' },
  );
  assert.deepEqual(
    readDisplayPreferences({ libraryLayout: 'unexpected', planMode: false, timetableMode: [] }),
    readDisplayPreferences(null),
  );
});
test('range selection grows and shrinks around the original anchor in both directions', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(selectionRange(ids, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(selectionRange(ids, 'b', 'c'), ['b', 'c']);
  assert.deepEqual(selectionRange(ids, 'c', 'a'), ['a', 'b', 'c']);
  assert.deepEqual(selectionRange(ids, 'removed', 'c'), ['c']);
  assert.deepEqual(selectionRange(ids, 'b', 'removed'), []);
});
