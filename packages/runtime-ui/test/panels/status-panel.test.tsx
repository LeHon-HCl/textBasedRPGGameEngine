import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRng } from '@game/shared';
import type { AttrDefs, ItemDef, StatusInstance } from '@game/shared';
import { newGameState } from '@game/engine';
import type { GameState } from '@game/engine';
import { projectStatusPanel, StatusPanel, type StatusPanelView } from '../../src/panels/index.js';

/**
 * 25 任务 6：状态面板（设计 §6.4 / FR-UI-03）。
 *
 * 五块内容：属性 / 技能 / 状态效果 / 钱包 / 着装概要；数值变化高亮动画
 * （FR-STAT-04 增量，走 StatusPanel 内部而非 Toast，§6.4 末段）。
 * 投影为纯函数（props 受控组件的输入面），组件只渲染不计算。
 */

const VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

const ATTR_DEFS: AttrDefs = {
  numeric: {
    hp: { min: 0, max: 100, init: 100, show: true },
    stamina: { min: 0, max: 50, init: 30, show: true },
    // show=false：仅内部计算，不进状态面板（FR-STAT-01）
    secret: { min: 0, max: 10, init: 5, show: false },
  },
  level: { rank: { levels: ['新手', '老练', '大师'], init: 1 } },
  derived: {},
};

/** 构造一块状态面板输入（默认含五块内容的最小非空数据） */
function makeState(overrides: {
  attrs?: Record<string, number>;
  statuses?: StatusInstance[];
  wallet?: Record<string, number>;
  equip?: Record<string, string>;
  outfit?: Record<string, Record<string, string>>;
}): GameState {
  const state = newGameState(
    {
      versions: VERSIONS,
      attrs: { hp: 80, stamina: 20, secret: 3, rank: 1, ...overrides.attrs },
    },
    createRng(3),
  );
  return {
    ...state,
    player: {
      ...state.player,
      skills: { sword: { value: 3, exp: 12 } },
      statuses: overrides.statuses ?? [
        { id: 'poisoned', remaining: 2, stacks: 1, source: 'scene_tavern' },
      ],
      wallet: overrides.wallet ?? { gold: 42, silver: 7 },
      equip: overrides.equip ?? { weapon: 'rusty_sword' },
      outfit: overrides.outfit ?? { torso: { '2': 'guard_coat' } },
    },
  };
}

describe('projectStatusPanel：纯投影（FR-UI-03）', () => {
  it('数值型属性只收集 show=true；等级型映射为等级名', () => {
    const view = projectStatusPanel(makeState({}), { attrDefs: ATTR_DEFS });
    const attrs = view.attrs.map((entry) => entry.id);
    expect(attrs).toContain('hp');
    expect(attrs).toContain('stamina');
    expect(attrs).not.toContain('secret');
    const rank = view.attrs.find((entry) => entry.id === 'rank');
    // 等级型：值 1 → levels[1] = '老练'
    expect(rank?.display).toBe('老练');
    expect(rank?.value).toBe(1);
  });

  it('属性带 min/max（进度条数据源）与数值', () => {
    const view = projectStatusPanel(makeState({}), { attrDefs: ATTR_DEFS });
    const hp = view.attrs.find((entry) => entry.id === 'hp');
    expect(hp).toMatchObject({ id: 'hp', value: 80, min: 0, max: 100, kind: 'numeric' });
    expect(hp?.nameKey).toBe('attrs.hp.name');
  });

  it('技能按 value/exp 投影', () => {
    const view = projectStatusPanel(makeState({}), { attrDefs: ATTR_DEFS });
    expect(view.skills).toEqual([{ id: 'sword', value: 3, exp: 12, nameKey: 'skills.sword.name' }]);
  });

  it('状态效果带剩余时长与层数（缺省字段不写入，保持投影紧凑）', () => {
    const view = projectStatusPanel(makeState({}), { attrDefs: ATTR_DEFS });
    expect(view.statuses).toEqual([
      {
        id: 'poisoned',
        remaining: 2,
        stacks: 1,
        source: 'scene_tavern',
        nameKey: 'statuses.poisoned.name',
      },
    ]);
    // 无 remaining/stacks 的条目不应带这些键（调试面与富化面的判据）
    const bare = projectStatusPanel(makeState({ statuses: [{ id: 'blessed' }] }), {
      attrDefs: ATTR_DEFS,
    });
    expect(Object.keys(bare.statuses[0] as object).sort()).toEqual(['id', 'nameKey']);
  });

  it('钱包按面额降序（大额在前）且零额不显示', () => {
    const view = projectStatusPanel(makeState({ wallet: { gold: 42, silver: 0, copper: 7 } }), {
      attrDefs: ATTR_DEFS,
    });
    expect(view.wallet).toEqual([
      { id: 'gold', amount: 42, nameKey: 'wallet.gold.name' },
      { id: 'copper', amount: 7, nameKey: 'wallet.copper.name' },
    ]);
  });

  it('着装概要：装备栏与服装分层（部位/层号/物品 id）', () => {
    const view = projectStatusPanel(makeState({}), { attrDefs: ATTR_DEFS });
    expect(view.equip).toEqual([
      { slot: 'weapon', itemId: 'rusty_sword', nameKey: 'items.rusty_sword.name' },
    ]);
    expect(view.outfit).toEqual([
      { part: 'torso', layer: 2, itemId: 'guard_coat', nameKey: 'items.guard_coat.name' },
    ]);
  });

  it('物品目录存在时采用目录名称键', () => {
    const items = new Map<string, ItemDef>([
      [
        'guard_coat',
        {
          id: 'guard_coat',
          nameKey: 'items.coat.display',
          type: 'garment',
          stack: 1,
          garment: { part: 'torso', layer: 2 },
        } as unknown as ItemDef,
      ],
    ]);
    const view = projectStatusPanel(makeState({}), { attrDefs: ATTR_DEFS, items });
    expect(view.outfit[0]?.nameKey).toBe('items.coat.display');
  });

  it('着装按部位名 + 层号升序（由内到外，跨部位一致）', () => {
    const view = projectStatusPanel(
      makeState({ outfit: { torso: { '3': 'coat', '1': 'shirt' }, hands: { '1': 'gloves' } } }),
      { attrDefs: ATTR_DEFS },
    );
    expect(view.outfit.map((entry) => `${entry.part}.${entry.layer}`)).toEqual([
      'hands.1',
      'torso.1',
      'torso.3',
    ]);
  });

  it('空数据块不臆造条目（无属性定义时 attrs 为空）', () => {
    const view = projectStatusPanel(makeState({}), {});
    expect(view.attrs).toEqual([]);
  });
});

/** 便于组件用例复用的最小视图（空五块） */
const EMPTY_VIEW: StatusPanelView = {
  attrs: [],
  skills: [],
  statuses: [],
  wallet: [],
  equip: [],
  outfit: [],
};

describe('StatusPanel：渲染五块内容（FR-UI-03）', () => {
  const view: StatusPanelView = {
    attrs: [
      { id: 'hp', kind: 'numeric', value: 80, min: 0, max: 100, nameKey: 'attrs.hp.name' },
      { id: 'rank', kind: 'level', value: 1, display: '老练', nameKey: 'attrs.rank.name' },
    ],
    skills: [{ id: 'sword', value: 3, exp: 12, nameKey: 'skills.sword.name' }],
    statuses: [{ id: 'poisoned', remaining: 2, stacks: 2, nameKey: 'statuses.poisoned.name' }],
    wallet: [{ id: 'gold', amount: 42, nameKey: 'wallet.gold.name' }],
    equip: [{ slot: 'weapon', itemId: 'rusty_sword', nameKey: 'items.rusty_sword.name' }],
    outfit: [{ part: 'torso', layer: 2, itemId: 'guard_coat', nameKey: 'items.guard_coat.name' }],
  };

  it('五块内容以独立区块渲染（标题 + 数据行）', () => {
    render(<StatusPanel view={view} nameOf={(key) => key} labels={{ wallet: '钱包' }} />);
    // 标题：属性/技能/状态/钱包/着装
    for (const title of ['属性', '技能', '状态', '钱包', '着装']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('attrs.hp.name')).toBeInTheDocument();
    expect(screen.getByText('skills.sword.name')).toBeInTheDocument();
    expect(screen.getByText('statuses.poisoned.name')).toBeInTheDocument();
    expect(screen.getByText('items.rusty_sword.name')).toBeInTheDocument();
    expect(screen.getByText('items.guard_coat.name')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('等级型显示等级名而非数字', () => {
    render(<StatusPanel view={view} nameOf={(key) => key} />);
    expect(screen.getByText('老练')).toBeInTheDocument();
  });

  it('空块不渲染标题（避免空标题噪声）', () => {
    render(<StatusPanel view={{ ...EMPTY_VIEW, attrs: view.attrs }} nameOf={(key) => key} />);
    expect(screen.getByRole('heading', { name: '属性' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '钱包' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '技能' })).not.toBeInTheDocument();
  });
});

describe('StatusPanel：数值变化高亮（FR-STAT-04）', () => {
  /** 单属性视图（高亮用例共用） */
  const singleAttr = (id: string, value: number): StatusPanelView => ({
    ...EMPTY_VIEW,
    attrs: [{ id, kind: 'numeric', value, min: 0, max: 100, nameKey: `attrs.${id}.name` }],
  });

  it('有高亮时展示增量文本并标注增减方向（正/负）', () => {
    render(
      <StatusPanel
        view={singleAttr('hp', 7)}
        nameOf={(key) => key}
        highlights={{ hp: { from: 10, to: 7, delta: -3, at: 1000 } }}
        now={() => 1100}
      />,
    );
    const delta = screen.getByText('-3');
    expect(delta).toHaveAttribute('data-trend', 'down');
  });

  it('正向增量的文本带 + 号（区分增减，颜色非唯一信息载体）', () => {
    render(
      <StatusPanel
        view={singleAttr('insight', 5)}
        nameOf={(key) => key}
        highlights={{ insight: { from: 3, to: 5, delta: 2, at: 1000 } }}
        now={() => 1100}
      />,
    );
    const delta = screen.getByText('+2');
    expect(delta).toHaveAttribute('data-trend', 'up');
  });

  it('高亮超期后不显示（避免陈旧动画残留）', () => {
    render(
      <StatusPanel
        view={singleAttr('hp', 7)}
        nameOf={(key) => key}
        highlights={{ hp: { from: 10, to: 7, delta: -3, at: 1000 } }}
        now={() => 1000 + 2000}
        highlightTtlMs={1200}
      />,
    );
    expect(screen.queryByText('-3')).not.toBeInTheDocument();
  });

  it('无高亮时零残留（不渲染增量位）', () => {
    render(<StatusPanel view={singleAttr('hp', 7)} nameOf={(key) => key} />);
    expect(screen.queryByText(/-3|\+3/)).not.toBeInTheDocument();
  });

  it('高亮呈现后经 onHighlightSeen 外泄（宿主据此清理，动画不重复播）', () => {
    const onHighlightSeen = vi.fn();
    render(
      <StatusPanel
        view={singleAttr('hp', 7)}
        nameOf={(key) => key}
        highlights={{ hp: { from: 10, to: 7, delta: -3, at: 1000 } }}
        now={() => 1100}
        onHighlightSeen={onHighlightSeen}
      />,
    );
    expect(onHighlightSeen).toHaveBeenCalledWith({ attr: 'hp', delta: -3 });
  });
});

describe('StatusPanel：装备修正明细（FR-STAT-03）', () => {
  const withEquip: StatusPanelView = {
    ...EMPTY_VIEW,
    equip: [{ slot: 'weapon', itemId: 'rusty_sword', nameKey: 'items.rusty_sword.name' }],
  };

  it('无明细不渲染修正区块；给出明细时渲染 attr ±N 文本', () => {
    const { rerender } = render(<StatusPanel view={withEquip} nameOf={(key) => key} />);
    expect(screen.queryByRole('heading', { name: '装备修正' })).not.toBeInTheDocument();

    rerender(
      <StatusPanel
        view={withEquip}
        nameOf={(key) => key}
        modDetails={[{ slot: 'weapon', itemId: 'rusty_sword', mods: { hp: 1, con: -1 } }]}
      />,
    );
    expect(screen.getByRole('heading', { name: '装备修正' })).toBeInTheDocument();
    expect(screen.getByText('hp +1，con -1')).toBeInTheDocument();
  });
});
