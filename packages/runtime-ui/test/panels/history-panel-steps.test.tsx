import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import type { GameHost } from '../../src/app/game-host.js';
import { HistoryPanel } from '../../src/panels/HistoryPanel.js';

/**
 * #9b/#9c 的面板渲染侧（2026-09-26）。
 *
 * 与 `history-rollback.test.ts`（宿主投影侧，node 友好的 .ts）分文件：
 * 本文件需要 JSX 与 DOM 断言，故为 `.tsx`。断言口径是**玩家可见的行为**：
 * 按钮按 `group.rollbackSteps` 发起回退（而非自算分组距离）、
 * `canRollback` 真的能置灰按钮（修 #9c：此前全仓无调用点 → 永不置灰）。
 *
 * 夹具装配与宿主用例同源（同一 mini-game 与初始属性）。
 */

const ROOT = 'fixtures/mini-game';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`);
}

function readPackage(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const absolute of listFiles(ROOT)) {
    const relative = absolute.slice(absolute.indexOf(ROOT) + ROOT.length + 1);
    files[relative] = readFileSync(absolute, 'utf8');
  }
  return files;
}

const files = readPackage();

async function makeHost(): Promise<GameHost> {
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
  return createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: { hp: 100, stamina: 30, insight: 0, atk: 10, def: 3, spd: 5 },
    seed: 2026,
  });
}

/** 推进到选项相位（advance 直到出现选项） */
function advanceToChoices(host: GameHost, max = 10): void {
  for (let i = 0; i < max; i++) {
    if (host.store.getState().session.phase === 'await_choice') return;
    host.advance();
  }
}

/** 走一步可无限往返的路径（`market_street ⇄ arrival`；每次选择前宿主自动打点） */
function stepOnce(host: GameHost): void {
  advanceToChoices(host);
  const choices = host.store.getState().session.choices;
  const pick =
    choices.find((choice) => choice.id === 'go_market' || choice.id === 'back_arrival') ??
    choices[0];
  host.choose(pick?.id as string);
  advanceToChoices(host);
}

describe('25B-B1 #9b/#9c 历史面板（渲染侧）', () => {
  it('#9c：面板按宿主传入的 canRollback 置灰，且用 group.rollbackSteps 发起回退', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    for (let i = 0; i < 3; i += 1) stepOnce(host);
    const groups = host.history();
    const requested: number[] = [];
    const { rerender } = render(
      <HistoryPanel
        groups={groups}
        canRollback={host.availableRollbackSteps() > 0}
        onRollback={(steps) => requested.push(steps)}
      />,
    );
    // 栈非空 → 所有回退按钮可用
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeEnabled();
    }
    // 点击最后一个按钮 → 回调收到**宿主投影的步数**（不是分组距离）
    const lastWithSteps = [...groups].reverse().find((group) => group.rollbackSteps !== undefined);
    expect(lastWithSteps?.rollbackSteps).toBeDefined();
    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons.at(-1) as HTMLElement);
    expect(requested).toEqual([lastWithSteps?.rollbackSteps]);

    // 栈空 → 全部按钮置灰（修 #9c：此前 canRollback 无人传入，永不置灰）
    rerender(<HistoryPanel groups={groups} canRollback={false} onRollback={() => undefined} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('#9b：无 rollbackSteps 的分组不渲染回退按钮（宁可没有，也不给错按钮）', () => {
    const groups = [
      {
        sceneId: 'arrival',
        day: 1,
        entries: [{ seq: 0, text: 'scenes.arrival.open', day: 1, slotIndex: 0 }],
      },
      {
        sceneId: 'market_street',
        day: 1,
        entries: [{ seq: 1, text: 'scenes.market_street.enter', day: 1, slotIndex: 0 }],
      },
    ];
    render(<HistoryPanel groups={groups} onRollback={() => undefined} />);
    // 两组都没有 rollbackSteps → 一个按钮都不渲染（旧实现会按分组距离给出错按钮）
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
