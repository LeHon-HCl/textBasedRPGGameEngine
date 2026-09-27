import { describe, expect, it } from 'vitest';
import { demoSource, jsxAttrValue, jsxTag } from './demo-wiring-source.js';

/**
 * #6① / #6b / #9c 静态防线：demo 面板装配面的三处「未接线」。
 *
 * 三处同源于 `docs/plans/open-items.md` 的 L-1 装配缺口：组件早已支持
 * （`ShopPanel.labels.resolveName`、`BattlePanel.labels.resolveLog`、
 * `HistoryPanel.canRollback`），demo 渲染时却没把值传下去，于是：
 * - #6① 商店标题/商品名回落显示 `shops.*.name` 原始键；
 * - #6b 战斗日志回落显示 `battle.log.*` 原始键；
 * - #9c `canRollback` 恒为 undefined → 回滚栈空时按钮仍可点、点了报 NO_CHECKPOINT。
 *
 * 为什么在源码层面断言：demo 包无测试基建（同 `choice-visibility-host.test.ts`
 * 的 `#4 静态防线`），缺陷面正是 `apps/player-demo/src/main.tsx` 的**装配形态**。
 * 防线断言的是 JSX 属性实参（经 `demo-wiring-source.ts` 剥注释 + 括号配对切出），
 * 而非全文 grep——注释里写了 `resolveName` 并不等于真的传了 prop。
 *
 * 可证伪性（均已实测）：逐个删掉 `labels` / `canRollback` → 对应用例变红。
 */
const SOURCE = demoSource();

describe('#6① 静态防线：商店面板必须注入名称解析器', () => {
  it('ShopPanel 收到 labels 且含 resolveName（缺省会回落显示 shops.*.name 原始键）', () => {
    const labels = jsxAttrValue(jsxTag(SOURCE, 'ShopPanel'), 'labels');
    expect(labels, 'ShopPanel 未传 labels → 商品名显示原始键').not.toBeNull();
    expect(labels as string).toMatch(/\bresolveName\b/);
  });
});

describe('#6b 静态防线：战斗面板必须注入日志解析器', () => {
  it('BattlePanel 收到 labels 且含 resolveLog（缺省会回落显示 battle.log.* 原始键）', () => {
    const labels = jsxAttrValue(jsxTag(SOURCE, 'BattlePanel'), 'labels');
    expect(labels, 'BattlePanel 未传 labels → 日志显示原始键').not.toBeNull();
    expect(labels as string).toMatch(/\bresolveLog\b/);
  });
});

describe('#9c 静态防线：历史面板必须按回退栈状态置灰按钮', () => {
  it('HistoryPanel 收到 canRollback 且取自宿主 availableRollbackSteps()', () => {
    const canRollback = jsxAttrValue(jsxTag(SOURCE, 'HistoryPanel'), 'canRollback');
    expect(
      canRollback,
      'HistoryPanel 未传 canRollback → 恒为 undefined，按钮永不禁用',
    ).not.toBeNull();
    expect(canRollback as string).toMatch(/availableRollbackSteps\s*\(\s*\)\s*>\s*0/);
  });
});
