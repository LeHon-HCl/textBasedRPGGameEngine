import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { EffectData, NpcDef, TimeConfig } from '@game/shared';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import { TimePipeline } from '../../src/time/pipeline.js';
import { createTimeViewProvider } from '../../src/time/calendar.js';
import { createNpcScheduleProvider } from '../../src/npcs/step.js';
import { createNpcScheduleDeriver } from '../../src/npcs/deriver.js';

/**
 * 12 任务 2：管线步骤 5 真实实现（§4.3/§4.6）。
 *
 * 覆盖：批量解析 → npcLocationCache 重建；时间推进后重算；
 * 非时间事务（条件变更）经事务后置派生器重算（缓存失效正确性）。
 */

const CONFIG: TimeConfig = {
  slots: [
    { id: 'slot_morning', nameKey: 'time.slot.morning' },
    { id: 'slot_noon', nameKey: 'time.slot.noon' },
    { id: 'slot_evening', nameKey: 'time.slot.evening' },
    { id: 'slot_night', nameKey: 'time.slot.night' },
  ],
  weekdays: Array.from({ length: 7 }, (_, i) => ({ nameKey: `time.weekday.${i + 1}` })),
  startWeekday: 1,
};

/** 日程目录：guard 早晚换岗；hermit 仅在 flag.cave_open 时出现在 cave */
const NPCS: ReadonlyMap<string, NpcDef> = new Map(
  (
    [
      {
        id: 'guard',
        nameKey: 'npc.guard.name',
        schedule: [
          { at: { slots: ['slot_morning'] }, location: 'gate' },
          { at: { slots: ['slot_night'] }, location: 'market' },
        ],
      },
      {
        id: 'hermit',
        nameKey: 'npc.hermit.name',
        schedule: [{ at: {}, location: 'cave', showIf: 'flag.cave_open' }],
      },
    ] as NpcDef[]
  ).map((def) => [def.id, def]),
);

const VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

interface SetupInit {
  withDeriver?: boolean;
  npcs?: ReadonlyMap<string, NpcDef>;
  slotIndex?: number;
}

/** 装配带时间管线与（可选）日程派生器的运行时 */
function makeRuntime(init: SetupInit = {}) {
  const npcs = init.npcs ?? NPCS;
  const registry = createBuiltinEffectRegistry({
    timeConfig: CONFIG,
    npcs,
    functionRegistry: createBuiltinFunctionRegistry(),
  });
  const state = newGameState(
    {
      versions: VERSIONS,
      attrs: { hp: 10 },
      time: { day: 1, slotIndex: init.slotIndex ?? 0 },
      factions: { town: 0 },
    },
    createRng(1),
  );
  const rt = new GameRuntime({
    state,
    rng: createRng(2),
    effectExecutor: registry,
    timeViewProvider: createTimeViewProvider(CONFIG),
    ...(init.withDeriver === true
      ? { derivers: [createNpcScheduleDeriver({ npcs, config: CONFIG })] }
      : {}),
  });
  const pipeline = new TimePipeline({
    runtime: rt,
    config: CONFIG,
    npcSchedule: createNpcScheduleProvider(CONFIG),
  });
  return { rt, pipeline };
}

describe('12-2 createNpcScheduleProvider：步骤 5 效果装配', () => {
  it('产出单条 __npc.resolve 内部指令，携带推进后时钟校准的时段/星期', () => {
    const { rt } = makeRuntime({ slotIndex: 3 });
    const effects = createNpcScheduleProvider(CONFIG)({
      runtime: rt,
      rng: createRng(2),
      slots: 1,
      crossedDay: true,
      crossedWeek: false,
      crossedMonth: false,
    });
    expect(effects).toEqual([
      { '__npc.resolve': { slot: 'slot_morning', weekday: '2' } } as unknown as EffectData,
    ]);
  });
});

describe('12-2 管线步骤 5：npcLocationCache 重建与时间推进重算', () => {
  it('推进跨时段后批量解析并重建缓存（不在场 NPC 不落条目）', () => {
    const { rt, pipeline } = makeRuntime({ slotIndex: 3 });
    pipeline.advance(1); // day2 / slot_morning
    expect(rt.state.world.npcLocationCache).toEqual({ guard: 'gate' });

    pipeline.advance(3); // day2 / slot_night
    expect(rt.state.world.npcLocationCache).toEqual({ guard: 'market' });
  });

  it('未注入 NPC 目录：解析为空缓存且不报错（缺省语义）', () => {
    const { rt, pipeline } = makeRuntime({ npcs: new Map() });
    pipeline.advance(1);
    expect(rt.state.world.npcLocationCache).toEqual({});
  });
});

describe('12-2 缓存失效：非时间事务的条件变更经派生器重算', () => {
  it('flag 变更后 showIf 重算（无时间推进）', () => {
    const { rt } = makeRuntime({ slotIndex: 0, withDeriver: true });
    // 首笔事务建立基线（新档缓存为空，派生器按当前条件全量重建）
    rt.exec([{ flag: { name: 'unrelated' } }], { source: 'choice', where: {}, rng: createRng(3) });
    expect(rt.state.world.npcLocationCache).toEqual({ guard: 'gate' });

    rt.exec([{ flag: { name: 'cave_open' } }], { source: 'choice', where: {}, rng: createRng(3) });
    expect(rt.state.world.npcLocationCache).toEqual({ guard: 'gate', hermit: 'cave' });

    rt.exec([{ flag: { name: 'cave_open', value: false } }], {
      source: 'choice',
      where: {},
      rng: createRng(3),
    });
    expect(rt.state.world.npcLocationCache).toEqual({ guard: 'gate' });
  });

  it('缓存无变化时不产生冗余补丁（幂等重建）', () => {
    const { rt } = makeRuntime({ slotIndex: 0, withDeriver: true });
    rt.exec([{ flag: { name: 'warmup' } }], { source: 'choice', where: {}, rng: createRng(3) });
    const outcome = rt.exec([{ flag: { name: 'unrelated' } }], {
      source: 'choice',
      where: {},
      rng: createRng(3),
    });
    expect(
      outcome.patches.some(
        (patch) => patch.path[0] === 'world' && patch.path[1] === 'npcLocationCache',
      ),
    ).toBe(false);
  });
});
