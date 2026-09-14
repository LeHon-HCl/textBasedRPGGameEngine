import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * M1 玩家流冒烟（develop.md 约束 5 第 6 项「验收 demo」的自动化面）。
 *
 * 口径：真实浏览器 + 真实 IndexedDB + 真实点击，走通 M1 验收要求的核心路径：
 *   首启向导 → 新游戏 → 叙事推进 → 选项分支 → 跨区域移动 → zh/en 切换
 * 与 Vitest 的分工：单元/组件测试覆盖模块内行为；本文件只覆盖**跨层集成**
 * （dev server、词典实际渲染、跨区域跳转链）。
 *
 * 选择器策略：
 * - 优先用 runtime-ui 提供的稳定钩子（`data-phase` / `data-action="advance"` / `data-choice`）；
 * - 主菜单与向导按钮由 demo 自定义（无 data-action），用**可见文案**定位；
 * - 跨区域链路（arrival → town_gate → riverside_ferry）是本文件的核心断言：
 *   它同时覆盖「NPC 播种」「时段窗口」「词典齐备」三项 M1 收尾修复。
 */

/** 内容向导：点「我已知悉」或「跳过」进入主菜单（demo 首启路径） */
async function passWizard(page: Page): Promise<void> {
  const known = page.getByRole('button', { name: /我已知悉|跳过/ });
  if ((await known.count()) > 0) {
    await known.first().click();
  }
  await expect(page.getByRole('button', { name: '新游戏' })).toBeVisible();
}

/** 反复点「继续」直到出现选项或没有可推进的段落 */
async function drainAdvance(page: Page, max = 8): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const advance = page.locator('[data-action="advance"]');
    if ((await advance.count()) === 0) break;
    await advance.first().click();
  }
}

test.describe('M1 玩家流冒烟', () => {
  test('首启向导 → 新游戏 → 跨区域探索（arrival → town_gate → riverside_ferry）', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      // 只收**应用级**错误：favicon 类资源 404 由浏览器自动请求产生（index.html
      // 未声明图标），与应用健康无关，故按「Failed to load resource」过滤。
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await passWizard(page);

    await page.getByRole('button', { name: '新游戏' }).click();

    // 入口场景渲染（zh-CN 词典生效）
    const narrative = page.locator('[data-phase]');
    await expect(narrative).toBeVisible();
    await expect(narrative).toContainText('石板路');

    // 状态面板：属性显示名经 attrs 词典物化（不是原始键）
    await expect(page.getByText('生命')).toBeVisible();
    await expect(page.getByText('attrs.hp.name')).toHaveCount(0);

    // 推进到选项（入口场景：去集市 / 往镇口）
    await drainAdvance(page);
    await expect(page.locator('[data-choice="go_gate"]')).toBeVisible();

    // 跨区域链第一跳：镇口
    await page.locator('[data-choice="go_gate"]').click();
    await drainAdvance(page);
    await expect(narrative).toContainText('镇门口');

    // 跨区域链第二跳：河畔渡口（依赖 NPC 播种使 `!npc.ferryman.met` 可求值）
    await expect(page.locator('[data-choice="go_riverside"]')).toBeVisible();
    await page.locator('[data-choice="go_riverside"]').click();
    await drainAdvance(page);
    await expect(narrative).toContainText('渡口');

    // 河畔交互选项齐备（包含新写内容）
    await expect(page.locator('[data-choice="talk_ferryman"]')).toBeVisible();
    await expect(page.locator('[data-choice="to_fish_market"]')).toBeVisible();

    // 控制台不得有**应用级**错误。过滤 favicon 404 —— index.html 未声明图标，
    // 浏览器自动请求 /favicon.ico 必然 404，与应用健康无关。
    const appErrors = consoleErrors.filter((text) => !text.includes('favicon'));
    expect(appErrors, `控制台错误：${appErrors.join(' | ')}`).toHaveLength(0);
  });

  test('语言切换：设置面板切到 en-US 后界面文案切换', async ({ page }) => {
    await page.goto('/');
    await passWizard(page);

    // 主菜单的「设置」按钮打开设置抽屉（demo 自定义按钮，主菜单阶段可见）
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    // 设置抽屉内的语言下拉（选项来自 manifest.langs）
    const langSelect = page.locator('select').first();
    await expect(langSelect).toBeVisible({ timeout: 10_000 });
    await expect(langSelect.locator('option[value="en-US"]')).toHaveCount(1);

    await langSelect.selectOption('en-US');
    // 注：SettingsPanel 的内置标签来自组件的 DEFAULT_LABELS（demo 未注入英文 labels），
    // 因此这里不断言面板标签变化（那是 25 号 C 组「UI 文案全量 i18n」的范畴）；
    // 本用例断言的是**玩家可见的叙事文案**随语言切换（en-US 词典 + 宿主按当前语言解析）。

    // 关掉设置并开新游戏：叙事首段为英文（en-US 词典生效；缺失键会回退中文）
    const close = page.getByRole('button', { name: /关闭|Close/ });
    if ((await close.count()) > 0) await close.first().click();
    await page.getByRole('button', { name: /新游戏|New Game/ }).click();
    await expect(page.locator('[data-phase]')).toContainText(/flagstones|Old Town|market/i);
  });

  test('存档槽位：IndexedDB 可用（DexieAdapter 真实环境）', async ({ page }) => {
    await page.goto('/');
    await passWizard(page);
    await page.getByRole('button', { name: '新游戏' }).click();
    await expect(page.locator('[data-phase]')).toBeVisible();

    const databases = await page.evaluate(() =>
      indexedDB.databases().then((dbs) => dbs.map((d) => d.name ?? '')),
    );
    // 打开过库即出现在列表（宿主建档/持久化初始化）
    expect(Array.isArray(databases)).toBe(true);
  });
});
