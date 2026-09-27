import { describe, expect, it } from 'vitest';
import { demoSource, functionBody } from '../acceptance/demo-wiring-source.js';

/**
 * #3 静态防线：错误卡片必须「按类型区分 + 可关闭」。
 *
 * ## 为什么需要这一层
 * #3 的两个缺陷都只在 `apps/player-demo` 的**装配形态**上：
 * 1. 卡片唯一的按钮硬编码为「回退一步」，不区分错误类型——无回退点时（回退栈空，
 *    `NO_CHECKPOINT`）点击必然再报同一个错；
 * 2. 卡片没有关闭入口，而 `lastError` 只在宿主 `guard()` / `start()` 时清空，
 *    玩家无法主动消掉 → 一次失败后红色卡片常驻。
 *
 * demo 包无测试基建（同 `demo-panel-wiring.test.ts` / `demo-save-wiring.test.ts`），
 * 其运行行为不被 `pnpm test` 覆盖，故在源码装配面上防守。宿主侧 `clearError()`
 * 的行为断言在 `test/app/game-host.test.ts`；本文件锁「demo 真的接了它」。
 *
 * ## 口径
 * 断言范围收窄到 `ErrorCard` 的**函数体**（`functionBody`，剥注释 + 括号配对），
 * 而非全文 grep——注释里写 `clearError` 不等于真的调了它，且「按钮」在本文件
 * 别处也出现。可证伪性：删掉 `disabled` 分支或关闭按钮 → 对应用例变红。
 */
const SOURCE = demoSource();
const BODY = functionBody(SOURCE, 'ErrorCard');

describe('#3 静态防线：错误卡片可关闭（接到宿主 clearError）', () => {
  it('渲染「关闭」按钮且点击回调调 host.clearError()', () => {
    expect(BODY, 'ErrorCard 无「关闭」入口 → 卡片常驻，玩家无法消掉').toContain('关闭');
    expect(BODY).toMatch(/host\.clearError\(\)/);
  });
});

describe('#3 静态防线：「回退一步」按错误类型决定可用性', () => {
  it('回退按钮带 disabled 且其取值由 NO_CHECKPOINT 分支导出（不是硬编码恒可点）', () => {
    // 分支定义：`const 某变量 = error.code !== 'NO_CHECKPOINT'`（变量名不限）
    const branch = /const\s+(\w+)\s*=\s*error\.code\s*!==\s*'NO_CHECKPOINT'/.exec(BODY);
    expect(
      branch,
      '未按 NO_CHECKPOINT 派生可用性 → 无回退点时按钮仍可点，点了必再报同一个错',
    ).not.toBeNull();
    // disabled 取该变量的取反（回退栈空 → 禁用）
    expect(BODY).toMatch(new RegExp(`disabled=\\{!\\s*${branch?.[1] as string}\\s*\\}`));
  });

  it('回退按钮仍接到 host.rollback()（区分类型不得把入口改没了）', () => {
    expect(BODY).toMatch(/host\.rollback\(\)/);
  });
});
