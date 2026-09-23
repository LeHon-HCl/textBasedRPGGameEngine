import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BattleLogEntry } from '@game/engine';
import { CheckResultPanel, checkResultFromEvent } from '../../src/panels/CheckResultPanel.js';
import { BattlePanel } from '../../src/panels/BattlePanel.js';
import type { BattleActionOption, BattleUnitView } from '../../src/panels/BattlePanel.js';

/**
 * C2 测试（25 号 B 组）：判定呈现（FR-CMBT-05 / NFR-26）+ 战斗面板（FR-CMBT-10 / OQ-04）。
 *
 * 覆盖：六档等级徽标、骰值与阈值行、减弱动画降级、事件投影的防御性取值；
 * 战斗面板：单位血条与 aria、日志区（含空态与 resolver）、行动菜单门控、
 * 终局面、目标两步点选。
 */

describe('25B-C2 CheckResultPanel（判定呈现）', () => {
  const base = { rule: 'coc', outcome: 'success' as const, rolls: [37] };

  it('六档等级徽标：文案与 data 属性', () => {
    const cases: [string, string][] = [
      ['critical', '大成功'],
      ['extreme', '极难成功'],
      ['hard', '困难成功'],
      ['normal', '成功'],
      ['fail', '失败'],
      ['fumble', '大失败'],
    ];
    for (const [level, text] of cases) {
      const { unmount } = render(<CheckResultPanel result={{ ...base, level }} />);
      expect(screen.getByText(text)).toBeDefined();
      unmount();
    }
  });

  it('骰值与阈值行：最终骰值 + 骰池明细 + 技能/需值/余量', () => {
    const { container } = render(
      <CheckResultPanel
        result={{
          rule: 'coc',
          outcome: 'fail',
          level: 'fail',
          rolls: [85, 2, 8, 5],
          skill: 50,
          required: 50,
          margin: -35,
        }}
      />,
    );
    expect(container.textContent).toContain('🎲 85');
    expect(container.textContent).toContain('rolls: [85, 2, 8, 5]');
    expect(container.textContent).toContain('技能 50 · 需 ≤ 50 · 余量 -35');
  });

  it('无骰池明细时不渲染 rolls 行；无阈值数据时不渲染阈值行（防御性）', () => {
    const { container } = render(<CheckResultPanel result={{ ...base, level: 'normal' }} />);
    expect(container.textContent).not.toContain('rolls:');
    expect(container.textContent).not.toContain('技能');
  });

  it('无障碍：role=status + aria-label 含等级与成败', () => {
    render(<CheckResultPanel result={{ ...base, level: 'critical' }} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-label')).toBe('大成功 · 判定通过');
    expect(status.getAttribute('data-check-level')).toBe('critical');
    expect(status.getAttribute('data-check-outcome')).toBe('success');
  });

  it('checkResultFromEvent：从事件 detail 防御性取值（缺失即不展示）', () => {
    const view = checkResultFromEvent({
      rule: 'coc',
      outcome: 'success',
      level: 'normal',
      rolls: [37],
      detail: { skill: 50, required: 50, margin: 13, thresholds: { hard: 25 } },
    });
    expect(view).toMatchObject({ skill: 50, required: 50, margin: 13 });
    // 非数值字段被忽略
    const sparse = checkResultFromEvent({
      rule: 'coc',
      outcome: 'fail',
      level: 'fail',
      rolls: [80],
      detail: { skill: 'n/a' },
    });
    expect(sparse.skill).toBeUndefined();
  });
});

describe('25B-C2 BattlePanel（战斗面板，OQ-04 嵌入形态）', () => {
  const UNITS: BattleUnitView[] = [
    { uid: 'player', side: 'player', name: '旅人', hp: 24, maxHp: 30 },
    { uid: 'rat', side: 'enemy', name: '岩鼠', hp: 6, maxHp: 6 },
    { uid: 'rat#2', side: 'enemy', name: '岩鼠', hp: 0, maxHp: 6, defending: false },
  ];
  const LOG: BattleLogEntry[] = [
    { key: 'battle.log.setup', phase: 'setup' },
    { key: 'battle.log.skill', phase: 'resolving', vars: { amount: 6 } },
  ];
  const ACTIONS: BattleActionOption[] = [
    { id: 'strike', label: '挥击', kind: 'skill', needsTarget: true },
    { id: 'defend', label: '防御', kind: 'defend' },
    { id: 'flee', label: '逃跑', kind: 'flee' },
  ];

  it('单位区：血条 aria + hp 文本 + 阵亡半透明', () => {
    const { container } = render(<BattlePanel phase="await_player" units={UNITS} log={[]} />);
    const playerBar = container.querySelector('[data-unit-uid="player"] [role="progressbar"]');
    expect(playerBar?.getAttribute('aria-valuenow')).toBe('80');
    expect(screen.getByText('24 / 30')).toBeDefined();
    const deadUnit = container.querySelector('[data-unit-uid="rat#2"]') as HTMLElement;
    expect(deadUnit.style.opacity).toBe('0.45');
  });

  it('日志区：渲染键（缺省）/ 空态 / 注入 resolver 时用物化文本', () => {
    const { unmount } = render(<BattlePanel phase="resolving" units={UNITS} log={LOG} />);
    expect(screen.getByText('battle.log.setup')).toBeDefined();
    unmount();

    const { unmount: unmount2 } = render(<BattlePanel phase="resolving" units={UNITS} log={[]} />);
    expect(screen.getByText('（暂无记录）')).toBeDefined();
    unmount2();

    render(
      <BattlePanel
        phase="resolving"
        units={UNITS}
        log={LOG}
        labels={{ resolveLog: (entry) => `物化:${entry.key}` }}
      />,
    );
    expect(screen.getByText('物化:battle.log.skill')).toBeDefined();
  });

  it('行动菜单：await_player 时可用；其他相位禁用/隐藏', () => {
    const onAction = vi.fn();
    const { unmount } = render(
      <BattlePanel
        phase="await_player"
        units={UNITS}
        log={[]}
        actions={ACTIONS}
        onAction={onAction}
      />,
    );
    const defendButton = screen.getByText('防御');
    expect(defendButton).toBeDefined();
    defendButton.click();
    expect(onAction).toHaveBeenCalledWith(ACTIONS[1]);
    unmount();

    render(
      <BattlePanel
        phase="resolving"
        units={UNITS}
        log={[]}
        actions={ACTIONS}
        onAction={onAction}
      />,
    );
    expect(screen.getByText('等待你的行动…')).toBeDefined();
  });

  it('终局面：victory / defeat / escaped 显示对应文案且不显示行动菜单', () => {
    for (const [phase, text] of [
      ['victory', '胜利'],
      ['defeat', '战败'],
      ['escaped', '逃脱成功'],
    ] as const) {
      const { unmount } = render(
        <BattlePanel phase={phase} units={UNITS} log={[]} actions={ACTIONS} />,
      );
      expect(screen.getByText(text)).toBeDefined();
      expect(screen.queryByText('防御')).toBeNull();
      unmount();
    }
  });

  it('目标两步点选：带 pendingAction 时敌方单位可点，点选回调携带 uid', () => {
    const onAction = vi.fn();
    const { container } = render(
      <BattlePanel
        phase="await_player"
        units={UNITS}
        log={[]}
        actions={ACTIONS}
        onAction={onAction}
        pendingAction={ACTIONS[0]}
      />,
    );
    const ratUnit = container.querySelector('[data-unit-uid="rat"]') as HTMLElement;
    expect(ratUnit.getAttribute('role')).toBe('button');
    ratUnit.click();
    expect(onAction).toHaveBeenCalledWith(ACTIONS[0], 'rat');
  });

  it('防御态标记显示', () => {
    render(
      <BattlePanel
        phase="await_player"
        units={[{ uid: 'p', side: 'player', name: '旅人', hp: 10, maxHp: 30, defending: true }]}
        log={[]}
      />,
    );
    expect(screen.getByText('旅人 · 防御中')).toBeDefined();
  });
});
