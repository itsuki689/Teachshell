import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { observationSource, readObservation } from '../electron/services/website/observation.ts';

const urlA = 'https://selearning.nju.edu.cn/mod/assign/view.php?id=10';
const urlB = 'https://selearning.nju.edu.cn/mod/assign/view.php?id=11';
const parser =
  '(document, href) => JSON.stringify({ accountID: "7", title: document.title, href })';

test('teaching observation samples source URL, title, and payload in one execution', () => {
  const observation = vm.runInNewContext(observationSource(parser, 'teaching'), {
    document: { title: '作业 A' },
    location: { href: urlA },
  });
  assert.deepEqual(readObservation(observation, 'teaching', urlA, urlA), {
    url: urlA,
    title: '作业 A',
    data: { accountID: '7', title: '作业 A', href: urlA },
  });
});

test('navigation during parser loading cannot label assignment B contents as assignment A', () => {
  const observation = vm.runInNewContext(observationSource(parser, 'teaching'), {
    document: { title: '作业 B' },
    location: { href: urlB },
  });
  assert.throws(() => readObservation(observation, 'teaching', urlA, urlB), /已导航/);
  // Even navigating back to A before the IPC result arrives cannot hide the mismatch.
  assert.throws(() => readObservation(observation, 'teaching', urlA, urlA), /已导航/);
});

test('navigation after observation but before main-process validation invalidates the result', () => {
  const observation = vm.runInNewContext(observationSource(parser, 'teaching'), {
    document: { title: '作业 A' },
    location: { href: urlA },
  });
  assert.throws(() => readObservation(observation, 'teaching', urlA, urlB), /已导航/);
});

test('parser-time location changes are rejected inside the isolated execution', () => {
  const source = `(document) => { location.href = ${JSON.stringify(urlB)}; return '{}'; }`;
  assert.throws(
    () =>
      vm.runInNewContext(observationSource(source, 'teaching'), {
        document: { title: '作业 A' },
        location: { href: urlA },
      }),
    /已导航/,
  );
});

test('timetable parser comments, trailing semicolon, and URI-encoded JSON remain supported', () => {
  const source =
    '/* preserved parser header */\n(() => encodeURIComponent(JSON.stringify({ name: "秋季" })))();\n';
  const observation = vm.runInNewContext(observationSource(source, 'timetable'), {
    document: { title: '课程表' },
    location: { href: urlA },
  });
  assert.deepEqual(readObservation(observation, 'timetable', urlA, urlA).data, { name: '秋季' });
});

test('malformed or oversized observation payloads are rejected before parsing', () => {
  for (const invalid of [
    null,
    'raw',
    { href: urlA, title: 'A', raw: {} },
    { href: urlA, title: 'A', raw: 'x'.repeat(2 * 1024 * 1024 + 1) },
  ])
    assert.throws(() => readObservation(invalid, 'teaching', urlA, urlA), /无效/);
});
