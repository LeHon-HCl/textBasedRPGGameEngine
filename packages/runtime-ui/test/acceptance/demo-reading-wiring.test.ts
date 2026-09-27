import { describe, expect, it } from 'vitest';
import { callArgs, callAt, demoSource } from './demo-wiring-source.js';

/**
 * #2 静态防线：跳过开关必须驱动打字机的「立即全显」。
 *
 * 缺陷形态：`useReadingControl` 已算出 `revealInstantly`（`packages/runtime-ui/src/
 * narrative/reading-control.ts`），但 demo 的 `useRevealedChars` 只吃 `textSpeed`——
 * 开关状态被算出来却无人消费，于是点「跳过：开」后段落仍逐字出现。
 *
 * 为什么在源码层面断言：demo 包无测试基建（同 `choice-visibility-host.test.ts`
 * 的 `#4 静态防线`），缺陷面正是 `apps/player-demo/src/main.tsx` 的**装配形态**，
 * `pnpm test` 覆盖不到。防线的可证伪性：去掉 `reading.revealInstantly` 实参、
 * 或把两个 hook 的调用次序换回来，本文件对应用例即变红（均已实测）。
 */
const SOURCE = demoSource();

describe('#2 静态防线：跳过开关必须驱动打字机的「立即全显」', () => {
  it('useReadingControl 的调用早于 useRevealedChars（后者要拿前者的 revealInstantly）', () => {
    // 次序错了就无法把 revealInstantly 作为实参传入；两者均为无条件调用，重排不违 Hooks 规则
    expect(callAt(SOURCE, 'useReadingControl')).toBeLessThan(callAt(SOURCE, 'useRevealedChars'));
  });

  it('useRevealedChars 收到 revealInstantly 作为实参（#2 的直接防线）', () => {
    const args = callArgs(SOURCE, 'useRevealedChars');
    expect(args, '未找到 useRevealedChars 调用').not.toBeNull();
    // 断言实参里出现 revealInstantly 的消费——只传 textSpeed 即缺陷原样
    expect(args as string).toMatch(/\brevealInstantly\b/);
  });
});
