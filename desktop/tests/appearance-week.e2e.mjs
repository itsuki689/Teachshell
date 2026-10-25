/** Real Electron UI, disposable library; never reads or edits the user's native library. */
import { _electron } from 'playwright';
import { Repository } from '../electron/services/storage/repository.ts';
import electron from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-appearance-')));
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR || path.join(root, 'screenshots');
await fs.mkdir(evidence, { recursive: true });
const checks = [],
  errors = [];
let app, page;
const button = (name) => page.getByRole('button', { name, exact: true });
const nav = (name) => page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
const snapshot = () => page.evaluate(() => window.teachshelf.snapshot());
async function until(read, predicate) {
  for (let n = 0; n < 100; n++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Condition did not settle');
}
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log('PASS', name);
}
async function launch() {
  app = await _electron.launch({
    executablePath: process.env.TEACHSHELF_EXECUTABLE || electron,
    args: process.env.TEACHSHELF_EXECUTABLE ? [] : [desktop],
    env: { ...process.env, TEACHSHELF_TEST_ROOT: root },
    cwd: desktop,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForSelector('.app-body');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1260, height: 800 }),
  );
}
async function settings() {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByRole('tab', { name: '外观', exact: true }).click();
}
async function settled(mode) {
  await page.waitForFunction(
    (mode) =>
      document.documentElement.dataset.theme === mode &&
      !document.querySelector('.appearance-curtain'),
    mode,
  );
}
async function capture(name) {
  await page.mouse.move(10, 40);
  await page
    .locator('.day-night-art')
    .evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  await page.waitForSelector('.appearance-curtain', { state: 'detached' });
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.ok(await page.locator('.workspace:visible').count());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, 'appearance-' + name + '.png') });
}
try {
  await launch();
  await check(
    'Default plans entry renders seven real civil days without an academic timetable',
    async () => {
      await nav('计划');
      await page.locator('.timeline-board').waitFor();
      assert.equal(await page.locator('.timeline-day').count(), 7);
      assert.equal((await snapshot()).state.timetableTerms.length, 0);
      assert.ok(
        (await page.locator('.timeline-day').first().getAttribute('data-day')).match(
          /^\d{4}-\d{2}-\d{2}$/,
        ),
      );
      const before = await page.getByLabel('跳转日期').inputValue();
      await button('下一周').click();
      assert.notEqual(await page.getByLabel('跳转日期').inputValue(), before);
      await button('本周').click();
      assert.equal(await page.getByLabel('跳转日期').inputValue(), before);
      const box = await page.locator('.timeline-board').boundingBox();
      assert.ok(box.y + box.height <= (await page.evaluate(() => innerHeight)) - 20);
      await capture('week-empty');
    },
  );
  await check(
    'Local week plans create, keyboard move, double-click edit and preserve linked metadata',
    async () => {
      await page.getByLabel('跳转日期').fill('2026-10-26');
      await page.getByLabel('选择日期 2026-10-27', { exact: true }).click();
      await button('新建计划').click();
      const dialog = page.getByRole('dialog', { name: '新建计划', exact: true });
      await dialog.getByLabel('计划名称', { exact: true }).fill('离线周计划');
      assert.match(await dialog.getByLabel(/开始时间/).inputValue(), /^2026-10-27T09:00/);
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      const event = page.locator('.timeline-event').filter({ hasText: '离线周计划' });
      await event.waitFor();
      const before = await snapshot();
      await event.click();
      await page.keyboard.press('ArrowDown');
      await until(snapshot, (s) => s.revision !== before.revision);
      assert.equal(await event.getAttribute('data-start'), '550');
      await event.dblclick();
      const edit = page.getByRole('dialog', { name: '编辑计划', exact: true });
      await edit.getByLabel('计划名称', { exact: true }).fill('离线周计划已编辑');
      await edit.getByRole('button', { name: '保存', exact: true }).click();
      await page.locator('.timeline-event').filter({ hasText: '离线周计划已编辑' }).waitFor();
      await capture('week-local-plan');
    },
  );
  await check(
    'Month/day choice is remembered while plan list remains a separate entry',
    async () => {
      await page
        .getByRole('group', { name: '计划视图', exact: true })
        .getByRole('button', { name: '月', exact: true })
        .click();
      await page.locator('.month-board').waitFor();
      await nav('全部资料');
      await nav('计划');
      await page.locator('.month-board').waitFor();
      await button('查看课表').click();
      await button('计划列表').click();
      await page.locator('.plan-list-workspace').waitFor();
      await nav('全部资料');
      await nav('计划');
      await page.locator('.timeline-board').waitFor();
    },
  );
  await check(
    'Accent presets preview throughout the window, invalid hex cannot save, cancel reverts bytes',
    async () => {
      await settings();
      const before = await fs.readFile(path.join(root, 'library/library.json'), 'utf8');
      await button('调整颜色…').click();
      const dialog = page.getByRole('dialog', { name: '强调色', exact: true });
      assert.equal((await dialog.boundingBox()).width, 500);
      assert.equal(await dialog.locator('.accent-presets button').count(), 12);
      await dialog.getByRole('button', { name: '晴空蓝', exact: true }).click();
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--accent-source'),
        ),
        '#3B72B8',
      );
      await dialog.getByLabel('强调色 HEX').fill('oops');
      assert.equal(
        await dialog.getByRole('button', { name: '保存', exact: true }).isEnabled(),
        false,
      );
      await dialog.getByLabel('强调色 HEX').fill('aBcDef');
      await capture('accent-preview');
      await page.keyboard.press('Escape');
      assert.equal(await fs.readFile(path.join(root, 'library/library.json'), 'utf8'), before);
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--accent-source'),
        ),
        (await snapshot()).state.accentColor,
      );
    },
  );
  await check(
    'Accent, course borders and animation settings persist in Swift fields, IPC rejects invalid writes',
    async () => {
      await button('调整颜色…').click();
      const dialog = page.getByRole('dialog', { name: '强调色', exact: true });
      await dialog.getByRole('button', { name: '晴空蓝', exact: true }).click();
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await until(snapshot, (s) => s.state.accentColor === '#3B72B8');
      await page.getByLabel('课程色边框', { exact: true }).uncheck();
      await until(snapshot, (s) => s.state.showCourseBorders === false);
      await button('从右侧').click();
      await until(snapshot, (s) => s.state.appearanceTransition.direction === 'right');
      await button('彩虹十色').click();
      await until(snapshot, (s) => s.state.appearanceTransition.colorMode === 'rainbow');
      const rejected = await page.evaluate(async () => {
        const s = await window.teachshelf.snapshot();
        try {
          await window.teachshelf.saveAppearance(
            { accentColor: 'red', courses: [] },
            { root: s.root, revision: s.revision },
          );
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(rejected, true);
      const wrongRoot = await page.evaluate(async () => {
        const s = await window.teachshelf.snapshot();
        try {
          await window.teachshelf.saveAppearance(
            { appearance: 'dark' },
            { root: s.root + '-stale', revision: s.revision },
          );
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(wrongRoot, true);
    },
  );
  await check(
    'Unrelated file updates preserve transition HEX drafts; context menu exposes system mode',
    async () => {
      await button('单色').click();
      await until(snapshot, (s) => s.state.appearanceTransition.colorMode === 'solid');
      await page.getByLabel('动效颜色 HEX').fill('unfinished');
      await page.evaluate(() => window.teachshelf.createCourse({ name: '外观兼容课程' }));
      assert.equal(await page.getByLabel('动效颜色 HEX').inputValue(), 'unfinished');
      await page.getByLabel('动效颜色 HEX').fill('#808080');
      await button('彩虹十色').click();
      await until(snapshot, (s) => s.state.appearanceTransition.colorMode === 'rainbow');
      await page.locator('.day-night-toggle').click({ button: 'right' });
      await page.getByRole('menuitemradio', { name: '跟随系统', exact: true }).click();
      await settled('system');
    },
  );
  await check(
    'Preview paints ten strips without saving; rapid day/night toggles settle on the last request',
    async () => {
      const before = (await snapshot()).revision;
      await button('预览动效').click();
      await page.locator('.appearance-curtain').waitFor();
      assert.equal(await page.locator('.appearance-curtain > div').count(), 10);
      assert.equal(
        await page.locator('.appearance-curtain').getAttribute('data-direction'),
        'right',
      );
      await page.screenshot({ path: path.join(evidence, 'appearance-transition.png') });
      await page.waitForSelector('.appearance-curtain', { state: 'detached' });
      assert.equal((await snapshot()).revision, before);
      await button('深色显示模式').click();
      await settled('dark');
      assert.equal(await button('切换浅色外观').count(), 1);
      await button('切换浅色外观').click();
      await button('切换深色外观').click();
      await button('切换浅色外观').click();
      await settled('light');
      await until(snapshot, (s) => s.state.appearance === 'light');
      const disk = JSON.parse(await fs.readFile(path.join(root, 'library/library.json'), 'utf8'));
      assert.equal(disk.appearance, 'light');
    },
  );
  await check(
    'Reduced motion and disabled effects skip the curtain; follow-system responds to OS appearance',
    async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await button('深色显示模式').click();
      await settled('dark');
      assert.equal(await page.locator('.appearance-curtain').count(), 0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByLabel('启用切换动效', { exact: true }).uncheck();
      await until(snapshot, (s) => !s.state.appearanceTransition.isEnabled);
      await button('浅色显示模式').click();
      await settled('light');
      assert.equal(await page.locator('.appearance-curtain').count(), 0);
      await button('跟随系统显示模式').click();
      await settled('system');
      await page.emulateMedia({ colorScheme: 'dark' });
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
        'dark',
      );
      await page.emulateMedia({ colorScheme: 'light' });
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
        'light',
      );
    },
  );
  await check(
    'Every settings tab and workspace renders at normal/light and minimum/dark sizes',
    async () => {
      for (const [mode, width, height] of [
        ['light', 1260, 800],
        ['dark', 1020, 680],
      ]) {
        await button(mode === 'dark' ? '深色显示模式' : '浅色显示模式').click();
        await settled(mode);
        await app.evaluate(
          ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds),
          { width, height },
        );
        for (const tab of ['外观', '顶栏', '资料库', '备份', 'AI 助手', 'MCP', '关于']) {
          await page.getByRole('tab', { name: tab, exact: true }).click();
          await capture(mode + '-settings-' + tab);
        }
        for (const route of [
          '全部资料',
          '我的收藏',
          '最近打开',
          '未分类',
          '作业文件夹',
          '待完成计划',
          '计划',
          'AI 助手',
        ]) {
          await nav(route);
          await capture(mode + '-' + route);
        }
        await settings();
      }
    },
  );
  await check(
    'Restart retains preferences; switching libraries applies their appearance without an animation',
    async () => {
      await page.evaluate(async () => {
        const s = await window.teachshelf.snapshot(),
          guard = { root: s.root, revision: s.revision };
        for (const appearance of ['light', 'dark', 'light', 'dark'])
          void window.teachshelf.saveAppearance({ appearance }, guard).catch(() => {});
      });
      await app.close();
      await launch();
      await settled('dark');
      await nav('计划');
      await page.locator('.timeline-board').waitFor();
      const saved = await snapshot();
      assert.equal(saved.state.accentColor, '#3B72B8');
      assert.equal(saved.state.showCourseBorders, false);
      const other = path.join(root, 'other');
      const otherRepository = await Repository.open(other, { create: true });
      await otherRepository.close();
      const index = {
        ...saved.state,
        appearance: 'light',
        accentColor: '#AE567C',
        appearanceTransition: { ...saved.state.appearanceTransition, isEnabled: true },
      };
      await fs.writeFile(path.join(other, 'library.json'), JSON.stringify(index));
      await app.evaluate(({ dialog }, other) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] });
      }, other);
      await page.evaluate(() => window.teachshelf.openLibrary());
      await until(snapshot, (s) => s.root === other);
      await settled('light');
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--accent-source'),
        ),
        '#AE567C',
      );
      assert.equal(
        JSON.parse(await fs.readFile(path.join(root, 'library/library.json'), 'utf8')).appearance,
        'dark',
      );
    },
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, 'appearance-week-report.json'),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, evidence, root }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(evidence, 'appearance-failure.png') }).catch(() => {});
    console.error(
      await page
        .locator('body')
        .innerText()
        .catch(() => ''),
    );
  }
  console.error(errors);
  console.error(error);
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
}
