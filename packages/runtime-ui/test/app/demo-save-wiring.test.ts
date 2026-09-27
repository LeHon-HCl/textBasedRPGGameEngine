import { describe, expect, it } from 'vitest';
import { demoSource, jsxTag } from '../acceptance/demo-wiring-source.js';

/**
 * #11 静态防线：demo 必须有**存读档入口**（且真的接到宿主 API）。
 *
 * ## 为什么需要这一层（L-1 装配缺口的又一例）
 * 问题 #11「界面上找不到存读档入口」的根因是双层的：宿主没有 save/load API
 * （本文件同批修复，行为覆盖见 `game-host-save.test.ts`），**且** demo 没有任何
 * 按钮。前者有集成测试守护，后者没有——`apps/player-demo` 无测试基建，其运行
 * 行为不被 `pnpm test` 覆盖（同 `demo-panel-wiring.test.ts` 的处境）。
 *
 * 故在**源码装配面**上防守：断言工具条确实渲染了「存档 / 读档 / 导出」三个按钮，
 * 且点击回调调用的是宿主 API（`host.saveToSlot` / `host.loadFromSlot` /
 * `downloadSlot`），而非「按钮存在但没接线」——后者正是本项目反复出现的
 * 「点了没反应」形态。
 *
 * 为什么用 `demoSource()`（剥注释）而非全文 grep：注释里写 `saveToSlot` 不等于
 * 真的调用了它。可证伪性：删掉任一按钮/回调 → 对应断言变红。
 */
const SOURCE = demoSource();

describe('#11 静态防线：demo 存读档入口', () => {
  it('工具条渲染「存档 / 读档 / 导出」三个按钮', () => {
    // 按钮文案（demo 自持中文硬编码，与「新游戏」「设置」同口径）
    expect(SOURCE).toContain('存档');
    expect(SOURCE).toContain('读档');
    expect(SOURCE).toContain('导出');
    // 存读档工具条组件确实被渲染（不被渲染 = 玩家仍看不到入口）
    expect(SOURCE).toMatch(/<SaveLoadBar\b/);
  });

  it('三个按钮分别接到宿主 API（不是只有按钮没接线）', () => {
    // 存档 → host.saveToSlot；读档 → host.loadFromSlot；导出 → downloadSlot → host.exportSlot
    expect(SOURCE).toMatch(/host\.saveToSlot\(/);
    expect(SOURCE).toMatch(/host\.loadFromSlot\(/);
    expect(SOURCE).toMatch(/host\.exportSlot\(/);
    // 槽位为固定手动槽（demo 单槽最小形态；多槽位 UI 归 25 号 C 组）
    expect(SOURCE).toMatch(/MANUAL_SLOT\s*=\s*'slot_manual'/);
  });

  it('导出走 Blob + <a download>（最简下载路径，FR-SAVE-04）', () => {
    expect(SOURCE).toMatch(/new Blob\(/);
    expect(SOURCE).toMatch(/download/);
  });

  it('隐私横幅读宿主真实探测结果（不再恒为 degraded={false}）', () => {
    const tag = jsxTag(SOURCE, 'PrivacyBanner');
    expect(tag).toMatch(/degraded=\{/);
    // 依赖宿主 persistenceStatus（探测结果的唯一事实源）
    expect(SOURCE).toMatch(/persistenceStatus\(\)/);
  });
});
