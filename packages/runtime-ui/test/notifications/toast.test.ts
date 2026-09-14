import { describe, expect, it } from 'vitest';
import {
  mergeToast,
  TOAST_MERGE_WINDOW_MS,
  TOAST_DEFAULT_TTL_MS,
} from '../../src/notifications/index.js';
import type { ToastItem } from '../../src/app/types.js';

/**
 * 25 任务 11：Toast 合并策略（设计 §6.4 末段 / FR-UI-07「防刷屏合并策略」）。
 *
 * 合并口径：
 * - 窗口内**同类**（同 kind + 同 textKey）通知折叠为一条，`count` 递增；
 * - 窗口以「上一条同类的入队时刻」为基准（500ms，可配置）；
 * - 超窗或不同类则追加为新条目（不丢信息）；
 * - 合并产物替换原条目位置（保持时间序，新条目不为合并而插到末尾）。
 */

const NOW = 10_000;

function item(overrides: Partial<ToastItem> = {}): ToastItem {
  return {
    id: 1,
    kind: 'notify',
    textKey: 'ui.notify.item',
    count: 1,
    at: NOW,
    ...overrides,
  };
}

describe('mergeToast：500ms 窗口合并（FR-UI-07）', () => {
  it('窗口常量：合并窗口 500ms（设计值），缺省存活 4s', () => {
    expect(TOAST_MERGE_WINDOW_MS).toBe(500);
    expect(TOAST_DEFAULT_TTL_MS).toBe(4000);
  });

  it('同类同键且窗口内 → 折叠为一条（count 递增、at 刷新）', () => {
    const list = [item({ id: 1, at: NOW })];
    const merged = mergeToast(list, { kind: 'notify', textKey: 'ui.notify.item', at: NOW + 200 });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 1, count: 2, at: NOW + 200 });
  });

  it('同类但超出窗口 → 追加为新条目（不吞信息）', () => {
    const list = [item({ id: 1, at: NOW })];
    const merged = mergeToast(list, {
      kind: 'notify',
      textKey: 'ui.notify.item',
      at: NOW + TOAST_MERGE_WINDOW_MS + 1,
    });
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ count: 1, at: NOW + TOAST_MERGE_WINDOW_MS + 1 });
  });

  it('边界：恰好在窗口端点内仍合并（闭区间）', () => {
    const list = [item({ id: 1, at: NOW })];
    const merged = mergeToast(list, {
      kind: 'notify',
      textKey: 'ui.notify.item',
      at: NOW + TOAST_MERGE_WINDOW_MS,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.count).toBe(2);
  });

  it('不同 textKey → 各自成条（同 kind 不互并）', () => {
    const list = [item({ id: 1, textKey: 'ui.a' })];
    const merged = mergeToast(list, { kind: 'notify', textKey: 'ui.b', at: NOW + 100 });
    expect(merged).toHaveLength(2);
  });

  it('不同 kind → 各自成条（成就与物品不互相折叠）', () => {
    const list = [item({ id: 1, kind: 'achievement', textKey: 'ui.x' })];
    const merged = mergeToast(list, { kind: 'item', textKey: 'ui.x', at: NOW + 100 });
    expect(merged).toHaveLength(2);
  });

  it('合并基准取「最近一条同类」，不与更早的同类误并', () => {
    // 三条同类：t=0 已超窗、t=900 在窗内 → 新条目应并入 t=900 那条
    const list = [item({ id: 1, at: NOW }), item({ id: 2, at: NOW + 900 })];
    const merged = mergeToast(list, { kind: 'notify', textKey: 'ui.notify.item', at: NOW + 1000 });
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ id: 2, count: 2 });
  });

  it('合并不改变其他条目的相对顺序（时间序稳定）', () => {
    const list = [
      item({ id: 1, at: NOW, textKey: 'ui.a' }),
      item({ id: 2, at: NOW + 10, textKey: 'ui.b' }),
    ];
    const merged = mergeToast(list, { kind: 'notify', textKey: 'ui.a', at: NOW + 20 });
    expect(merged.map((entry) => entry.id)).toEqual([1, 2]);
    expect(merged[0]).toMatchObject({ count: 2 });
    expect(merged[1]).toMatchObject({ count: 1 });
  });

  it('空列表 → 直接作为新条目', () => {
    const merged = mergeToast([], { kind: 'notify', textKey: 'ui.a', at: NOW });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ count: 1, at: NOW, kind: 'notify' });
  });

  it('纯函数：不修改传入数组与条目', () => {
    const existing = item({ id: 1, count: 3 });
    const list = [existing];
    mergeToast(list, { kind: 'notify', textKey: 'ui.notify.item', at: NOW + 100 });
    expect(existing.count).toBe(3);
    expect(list).toHaveLength(1);
  });

  it('合并窗口可配置（宿主可调，缺省 500ms）', () => {
    const list = [item({ id: 1, at: NOW })];
    const merged = mergeToast(
      list,
      { kind: 'notify', textKey: 'ui.notify.item', at: NOW + 300 },
      { windowMs: 100 },
    );
    expect(merged).toHaveLength(2);
  });

  it('vars 并入时以最新一条为准（同键不同值不冲突）', () => {
    const list = [item({ id: 1, vars: { item: 'a' } })];
    const merged = mergeToast(list, {
      kind: 'notify',
      textKey: 'ui.notify.item',
      vars: { item: 'b' },
      at: NOW + 100,
    });
    expect(merged[0]?.vars).toEqual({ item: 'b' });
  });
});
