import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  AppearanceCurtain,
  accentPresets,
  contrastColor,
  contrastRatio,
  defaultTransition,
  normalizeHex,
  rainbow,
  transitionSettings,
  validateAppearancePatch,
} from '../shared/appearance.ts';
import { Repository } from '../electron/services/storage/repository.ts';
import { decodeLibrary } from '../shared/model.ts';
import { readDisplayPreferences } from '../shared/workspace-ui.ts';

test('Swift appearance defaults and palette are retained; plan entry defaults to week', () => {
  assert.deepEqual(transitionSettings(undefined), defaultTransition);
  assert.equal(
    transitionSettings({ direction: 'left', speed: 2, colorMode: 'rainbow', colorHex: '#abcdef' })
      .isEnabled,
    true,
  );
  assert.equal(normalizeHex(' abcDef '), '#ABCDEF');
  for (const invalid of ['#fff', '#GG0000', 'red', null, '#1234567'])
    assert.equal(normalizeHex(invalid), undefined);
  assert.equal(accentPresets.length, 12);
  assert.equal(rainbow.length, 10);
  assert.equal(readDisplayPreferences(null).scheduleMode, 'week');
  assert.equal(readDisplayPreferences({ scheduleMode: 'month' }).scheduleMode, 'month');
});
test('untrusted appearance patches reject bad values, extra fields and nonfinite speeds', () => {
  for (const patch of [
    {},
    { appearance: 'black' },
    { accentColor: 'url(file:)' },
    { showCourseBorders: 1 },
    { courses: [] },
    ...[NaN, Infinity, 0.4, 2.1].map((speed) => ({
      appearanceTransition: { ...defaultTransition, speed },
    })),
    { appearanceTransition: { ...defaultTransition, direction: 'diagonal' } },
  ])
    assert.throws(() => validateAppearancePatch(patch));
  assert.deepEqual(validateAppearancePatch({ accentColor: ' fFFFFf ' }), {
    accentColor: '#FFFFFF',
  });
});
test('readable accent ink and white-label controls meet Swift contrast in both appearances', () => {
  for (const hex of [...accentPresets.map((x) => x[1]), '#FFFFFF', '#000000', '#FFFF00']) {
    for (const [background, rgb] of [
      ['#FFFFFF', [1, 1, 1]],
      ['#242628', [36 / 255, 38 / 255, 40 / 255]],
    ] as const) {
      for (const minimum of [4.5, 7])
        assert.ok(
          contrastRatio(contrastColor(hex, background, minimum), [...rgb]) >= minimum - 1e-10,
        );
    }
  }
});
test('ten strips cover before appearance changes, hold, reveal and reverse continuously', () => {
  const applied: string[] = [],
    c = new AppearanceCurtain((mode) => applied.push(mode));
  c.request('dark', defaultTransition, 0, true);
  c.tick(100);
  assert.equal(applied.length, 0);
  assert.ok(c.opacity[0] > c.opacity[9]);
  c.request('light', { ...defaultTransition, speed: 2, direction: 'left' }, 100, true);
  assert.equal(c.settings.speed, 1);
  assert.equal(c.settings.direction, 'top');
  c.tick(296);
  assert.equal(applied.at(-1), 'light');
  assert.ok(c.opacity.every((x) => x === 1));
  c.tick(500);
  assert.equal(c.phase, 'reveal');
  const before = [...c.opacity];
  c.request('dark', defaultTransition, 500, true);
  c.tick(500);
  assert.deepEqual(c.opacity, before);
  c.tick(796);
  assert.equal(applied.at(-1), 'dark');
  c.tick(1240);
  assert.equal(c.phase, 'idle');
  assert.ok(c.opacity.every((x) => x === 0));
});
test('preview is transient; disabled/reduced-motion requests commit immediately', () => {
  const applied: string[] = [],
    c = new AppearanceCurtain((mode) => applied.push(mode));
  c.request('dark', defaultTransition, 0, true, true);
  c.tick(1000);
  assert.deepEqual(applied, []);
  c.request('light', defaultTransition, 1000, false);
  assert.deepEqual(applied, ['light']);
  assert.equal(c.phase, 'idle');
  c.request('dark', { ...defaultTransition, isEnabled: false }, 1100, true);
  assert.equal(applied.at(-1), 'dark');
});
test('Swift library appearance round-trips atomically, preserves future fields, refuses stale edits', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'appearance-data-'));
  let repo = await Repository.open(path.join(root, 'Library'), { create: true });
  t.after(async () => {
    await repo.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await repo.createCourse({ name: '保留课程', colorHex: '#8058A1' });
  const file = path.join(root, '原始课件.txt');
  await fs.writeFile(file, '不得丢失');
  await repo.importFiles([file], {});
  const index = path.join(repo.root, 'library.json');
  const source = JSON.parse(await fs.readFile(index, 'utf8'));
  source.futurePreference = { untouched: true };
  source.appearanceTransition.futureField = 'retain';
  await repo.close();
  await fs.writeFile(index, JSON.stringify(source));
  repo = await Repository.open(path.dirname(index));
  const before = repo.snapshot();
  await repo.saveAppearance(
    {
      appearance: 'dark',
      accentColor: ' aBcDef ',
      showCourseBorders: false,
      appearanceTransition: {
        ...defaultTransition,
        speed: 1.7,
        direction: 'right',
        colorMode: 'rainbow',
      },
    },
    before.revision,
  );
  await assert.rejects(
    repo.saveAppearance({ accentColor: '#FFFFFF' }, before.revision),
    /资料库已变化/,
  );
  const disk = JSON.parse(await fs.readFile(index, 'utf8'));
  assert.equal(decodeLibrary(disk).appearance, 'dark');
  assert.equal(disk.accentColor, '#ABCDEF');
  assert.equal(disk.appearanceTransition.futureField, 'retain');
  assert.deepEqual(disk.futurePreference, { untouched: true });
  assert.deepEqual(disk.courses, before.state.courses);
  assert.deepEqual(disk.materials, before.state.materials);
  assert.equal(await fs.readFile(file, 'utf8'), '不得丢失');
  await repo.close();
  repo = await Repository.open(path.dirname(index));
  assert.equal(repo.state.appearance, 'dark');
});
