import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleTimeline,
  movedRange,
  timelineDrop,
  timelineLanes,
  resizedRange,
  shiftedRange,
} from '../shared/schedule-drag.ts';

test('Swift timeline preserves early/lunch/night and collapses short breaks', () => {
  const t = scheduleTimeline(528, 11, []);
  assert.deepEqual(t.lunch, { start: 720, end: 840 });
  assert.ok(t.y(480) > 0);
  assert.equal(t.y(530), t.y(540));
  assert.ok(t.y(840) > t.y(720));
  assert.ok(t.y(1440) > t.y(1280));
  assert.equal(t.minute(t.y(540)), 540);
  assert.equal(t.minute(-1), undefined);
  assert.equal(t.minute(528), undefined);
});
test('timeline uses actual supplied school times and minute overrides without section rounding', () => {
  const t = scheduleTimeline(528, 2, [
    { section: 1, startMinute: 485, endMinute: 536 },
    { section: 2, startMinute: 546, endMinute: 597 },
  ]);
  const rect = t.rect({ start: 487, end: 589 });
  assert.equal(rect.top, t.y(487));
  assert.equal(rect.height, t.y(589) - t.y(487));
  assert.equal(t.minute(t.y(487)), 487);
});
test('movement snaps the start to ten minutes and retains exact odd-minute duration', () => {
  assert.deepEqual(movedRange({ start: 487, end: 598 }, 613), { start: 610, end: 721 });
  assert.deepEqual(movedRange({ start: 487, end: 598 }, 1439), { start: 1320, end: 1431 });
  assert.equal(movedRange({ start: 1440, end: 1450 }, 800), undefined);
  assert.equal(movedRange({ start: 10, end: 0 }, 800), undefined);
});
test('drop respects grab offset, date boundary and current day constraints', () => {
  const t = scheduleTimeline(528, 11, []);
  const input = {
    x: 250,
    y: t.y(610) + 15,
    width: 700,
    height: 528,
    grabOffset: 15,
    days: [1, 2, 3, 4, 5, undefined, undefined],
    range: { start: 480, end: 590 },
  };
  assert.deepEqual(timelineDrop(input, t), {
    date: 3,
    dayIndex: 2,
    range: { start: 610, end: 720 },
  });
  for (const patch of [{ x: -1 }, { x: 700 }, { x: Infinity }, { y: -1 }, { y: 528 }, { x: 550 }])
    assert.equal(timelineDrop({ ...input, ...patch }, t), undefined);
});
test('rendered overlap groups use occurrence identity and reuse free lanes', () => {
  const placements = timelineLanes([
    { id: 'same-meeting-week1', top: 0, height: 200 },
    { id: 'same-meeting-week2', top: 40, height: 40 },
    { id: 'next', top: 90, height: 40 },
    { id: 'adjacent', top: 200, height: 50 },
  ]);
  assert.equal(placements[0].laneCount, 2);
  assert.equal(placements[1].lane, placements[2].lane);
  assert.notEqual(placements[0].lane, placements[1].lane);
  assert.equal(placements[3].laneCount, 1);
});
test('tiny activities in compressed lunch never exceed the lunch bounds', () => {
  const t = scheduleTimeline(528, 11, []),
    r = t.rect({ start: 838, end: 839 }, 30);
  assert.ok(r.top + r.height <= t.y(840));
});
test('keyboard minute shifts preserve duration and refuse crossing civil midnight', () => {
  assert.deepEqual(shiftedRange({ start: 490, end: 601 }, -10), { start: 480, end: 591 });
  assert.deepEqual(shiftedRange({ start: 490, end: 601 }, 1), { start: 491, end: 602 });
  assert.equal(shiftedRange({ start: 0, end: 60 }, -1), undefined);
  assert.equal(shiftedRange({ start: 1380, end: 1440 }, 1), undefined);
  assert.equal(shiftedRange({ start: 1380, end: 1440 }, Infinity), undefined);
});
test('Swift resize snaps only the edited edge and cannot cross the opposite edge', () => {
  assert.deepEqual(resizedRange({ start: 487, end: 598 }, 'start', 523), { start: 520, end: 598 });
  assert.deepEqual(resizedRange({ start: 487, end: 598 }, 'end', 633), { start: 487, end: 630 });
  assert.deepEqual(resizedRange({ start: 487, end: 598 }, 'start', 1000), { start: 590, end: 598 });
  assert.deepEqual(resizedRange({ start: 487, end: 598 }, 'end', 0), { start: 487, end: 490 });
});
test('precise edge keys allow a one-minute duration and inclusive 24:00 end', () => {
  assert.deepEqual(resizedRange({ start: 487, end: 598 }, 'start', 700, 1), {
    start: 597,
    end: 598,
  });
  assert.deepEqual(resizedRange({ start: 487, end: 598 }, 'end', 0, 1), { start: 487, end: 488 });
  assert.deepEqual(resizedRange({ start: 1380, end: 1439 }, 'end', 1500, 1), {
    start: 1380,
    end: 1440,
  });
  assert.deepEqual(resizedRange({ start: 1, end: 60 }, 'start', -10, 1), { start: 0, end: 60 });
  assert.equal(resizedRange({ start: 10, end: 20 }, 'end', NaN), undefined);
});
