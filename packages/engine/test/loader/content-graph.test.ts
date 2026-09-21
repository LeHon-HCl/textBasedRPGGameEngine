import { describe, expect, it } from 'vitest';
import { loadFixturePackage } from './fs-source.js';
import type { GameDefinition } from '../../src/index.js';

/**
 * 内容连通性检查（develop.md 约束 7；2026-09-15 新增）。
 *
 * 背景：M1 收尾交付的夹具「数量达标但连通性不达标」——区域缺入口、任务无接取点、
 * 结局无触发点、商店无引用，而**全量测试、加载器诊断、CI 全绿**
 * （见 `docs/retros/content-integrity-postmortem.md`）。四类检查器分别回答
 * 「结构对不对 / 引用存不存在 / 指令参数合不合法」，**没有一类回答「玩家走得到吗」**。
 *
 * 本文件按约束 7 的五检做**反向可达性**验证：
 *   C1 区域可达 · C2 事件可触发 · C3 任务可接取 · C4 结局可达成 · C5 商店可进入
 *
 * 口径说明（与约束 7 的落地实现一致）：
 * - 可达性 = 从 `manifest.entryScene` 出发，沿**场景跳转边**（choice.goto 与
 *   effects 中的 goto/back）做 BFS；事件场景的入口是「事件被触发」，故单独判定；
 * - 五检为 **error 级**：任一不达标即测试红（约束 7 规定不可达内容等同不存在）；
 * - 豁免：内容可显式标记预留（当前夹具无预留项）。
 */

/**
 * 夹具加载走仓库共用辅助（`./fs-source.js`，与 mini-game.test.ts 同规）：
 * engine 包内测试禁止自引用包名（lint R2），且加载语义须与 06 号端到端一致。
 */

/** 取场景被引用为跳转目标的全部 id（choice.goto + effects 内 goto/back/ending/quest） */
interface SceneChoice {
  id: string;
  goto?: string;
  showIf?: string;
  once?: boolean;
  effects?: unknown[];
}

function collectFlowTargets(choice: SceneChoice): string[] {
  const out: string[] = [];
  if (typeof choice.goto === 'string') out.push(choice.goto);
  for (const effect of choice.effects ?? []) {
    if (typeof effect !== 'object' || effect === null) continue;
    const record = effect as Record<string, unknown>;
    const goto = record['goto'];
    if (typeof goto === 'string') out.push(goto);
  }
  return out;
}

/** 流程类指令 id（设计 §3.3「仅产生 jumps，不改状态」的四条） */
const FLOW_INSTRUCTION_IDS = ['goto', 'back', 'ending', 'loop_transition'] as const;

/** 分支指令的子效果字段（check 四分支 / battle 三分支，§3.3 child 事务） */
const BRANCH_EFFECT_FIELDS = [
  'onSuccess',
  'onFail',
  'onCritical',
  'onFumble',
  'onVictory',
  'onDefeat',
  'onEscape',
] as const;

/**
 * 判定一条效果序列是否**产出流程跳转**（即可把玩家带离当前场景）。
 *
 * 递归下探分支指令的子效果：`check` 的成功/失败分支里写 `goto` 同样算出口
 * （夹具当前未用，但检查口径必须完整，否则「分支内跳转」会被误判为死胡同）。
 */
function effectsHaveFlowJump(effects: readonly unknown[] | undefined): boolean {
  for (const effect of effects ?? []) {
    if (typeof effect !== 'object' || effect === null) continue;
    const record = effect as Record<string, unknown>;
    for (const id of FLOW_INSTRUCTION_IDS) {
      if (id in record) return true;
    }
    for (const field of BRANCH_EFFECT_FIELDS) {
      const branch = record[field];
      if (Array.isArray(branch) && effectsHaveFlowJump(branch)) return true;
    }
  }
  return false;
}

/** 选项是否有出口（choice.goto 或任一效果/分支效果产出流程跳转） */
function choiceHasExit(choice: SceneChoice): boolean {
  return choice.goto !== undefined || effectsHaveFlowJump(choice.effects);
}

describe('内容连通性（约束 7 五检）', () => {
  const definitionPromise = loadFixturePackage('mini-game');

  it('C1 区域可达：从 entryScene 出发能到达每个区域的至少一个场景', async () => {
    const definition = await definitionPromise;
    const scenes = [...definition.scenes.values()];
    const edges = new Map<string, string[]>();
    for (const scene of scenes) {
      const targets = (scene.def.choices as SceneChoice[]).flatMap(collectFlowTargets);
      edges.set(scene.def.id, targets);
    }
    const reached = new Set<string>();
    const queue = [definition.manifest.entryScene];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (reached.has(current)) continue;
      reached.add(current);
      for (const next of edges.get(current) ?? []) queue.push(next);
    }
    const areaOf = new Map(scenes.map((s) => [s.def.id, s.def.area]));
    const reachedAreas = new Set([...reached].map((id) => areaOf.get(id)));
    const unreachable = [...definition.areas.keys()].filter((a) => !reachedAreas.has(a));
    expect(unreachable, `不可达区域（无任何 goto 指向其场景）：${unreachable.join(', ')}`).toEqual(
      [],
    );
  });

  it('C2 事件可触发：每条事件的场景在可达集合内，且存在满足其窗口的时段', async () => {
    const definition = await definitionPromise;
    const reachableScenes = reachableSceneIds(definition);
    // 事件场景本身不可直接 goto（由事件触发进入），故判「事件所在区域/地点可达」
    const areaReachable = new Set<string>();
    for (const id of reachableScenes) {
      const scene = definition.scenes.get(id);
      if (scene !== undefined) areaReachable.add(`${scene.def.area}`);
    }
    const unreachable: string[] = [];
    for (const event of definition.events) {
      if (!areaReachable.has(event.where.area)) unreachable.push(event.id);
    }
    expect(unreachable, `不可达事件（其区域无任何可达场景）：${unreachable.join(', ')}`).toEqual(
      [],
    );
  });

  it('C3 任务可接取：每条任务在场景中存在 quest accept 调用点', async () => {
    const definition = await definitionPromise;
    const accepted = new Set<string>();
    for (const scene of definition.scenes.values()) {
      for (const choice of scene.def.choices as SceneChoice[]) {
        for (const effect of choice.effects ?? []) {
          if (typeof effect !== 'object' || effect === null) continue;
          const quest = (effect as Record<string, unknown>)['quest'];
          if (typeof quest !== 'object' || quest === null) continue;
          const record = quest as Record<string, unknown>;
          if (record['action'] === 'accept' && typeof record['id'] === 'string') {
            accepted.add(record['id']);
          }
        }
      }
    }
    const noAccept = [...definition.quests.keys()].filter((q) => !accepted.has(q));
    expect(
      noAccept,
      `无接取入口的任务（场景中缺 quest:{action: accept} 调用点）：${noAccept.join(', ')}`,
    ).toEqual([]);
  });

  it('C4 结局可达成：每个结局在场景中存在 ending 触发点', async () => {
    const definition = await definitionPromise;
    const triggered = new Set<string>();
    for (const scene of definition.scenes.values()) {
      for (const choice of scene.def.choices as SceneChoice[]) {
        for (const effect of choice.effects ?? []) {
          if (typeof effect !== 'object' || effect === null) continue;
          const ending = (effect as Record<string, unknown>)['ending'];
          if (typeof ending === 'string') triggered.add(ending);
        }
      }
    }
    const noTrigger = [...definition.endings.keys()].filter((e) => !triggered.has(e));
    expect(noTrigger, `无触发点的结局：${noTrigger.join(', ')}`).toEqual([]);
  });

  it('C5 商店可进入：每个商店在场景中存在 shop 入口引用', async () => {
    const definition = await definitionPromise;
    // **豁免已于 2026-09-21 移除**（17 号 S3 清账）：`shop` 指令随经济模块落地，
    // 本检测恢复实判。豁免存续期（2026-09-15 → 2026-09-21）的登记与清除理由见
    // docs/tasks/17-economy.md 落地记录。
    const referenced = new Set<string>();
    for (const scene of definition.scenes.values()) {
      for (const choice of scene.def.choices as SceneChoice[]) {
        for (const effect of choice.effects ?? []) {
          if (typeof effect !== 'object' || effect === null) continue;
          // 指令形态：{ shop: { shop: '<id>' } }（与 battle.encounter 同款参数对象）
          const shop = (effect as Record<string, unknown>)['shop'];
          if (typeof shop !== 'object' || shop === null) continue;
          const shopId = (shop as Record<string, unknown>)['shop'];
          if (typeof shopId === 'string') referenced.add(shopId);
        }
      }
    }
    const noEntry = [...definition.shops.keys()].filter((s) => !referenced.has(s));
    expect(noEntry, `无入口的商店：${noEntry.join(', ')}`).toEqual([]);
  });

  it('C6 UI 约定文本键齐备：quests.<id>.name / attrs.<id>.name 均有译文', async () => {
    const definition = await definitionPromise;
    // 为什么单独检：运行时面板按**约定**拼接文本键（QuestLogPanel 用
    // `quests.<id>.name`、状态面板用 `attrs.<id>.name`），这些键不出现在 data/ 中，
    // 故加载器 crossRef 的「data 引用 × 词典」检查覆盖不到——缺失时界面显示原始键
    // （M1 收尾实测：任务日志显示 `quests.wall_rubbing.name`）。
    const mainKeys = definition.locales[definition.manifest.mainLang]?.keys ?? new Map();
    const missing: string[] = [];
    for (const id of definition.quests.keys()) {
      if (!mainKeys.has(`quests.${id}.name`)) missing.push(`quests.${id}.name`);
    }
    // attrs 域未发布到 GameDefinition（06 号导出面缺口，宿主以显式注入承接），
    // 故其约定键（attrs.<id>.name）暂由宿主侧测试覆盖（见 runtime-ui 的
    // game-host 测试）——此处只检已发布域的约定键。
    for (const id of definition.npcs.keys()) {
      if (!mainKeys.has(`npcs.${id}.name`)) missing.push(`npcs.${id}.name`);
    }
    expect(missing, `UI 约定文本键缺译文：${missing.join(', ')}`).toEqual([]);
  });

  it('事件场景均被事件池引用（无孤儿事件场景）', async () => {
    const definition = await definitionPromise;
    const eventScenes = new Set(definition.events.map((e) => e.scene));
    const reachable = reachableSceneIds(definition);
    // 事件场景由事件触发进入，故不以 goto 可达判定；改判「是否被事件引用」
    const referencedButMissing = [...eventScenes].filter((id) => !definition.scenes.has(id));
    expect(referencedButMissing).toEqual([]);
    // 反向：有场景 id 形如事件场景（ev_ 前缀）却无人引用 → 疑似孤儿
    const orphans = [...definition.scenes.keys()].filter(
      (id) => id.startsWith('ev_') && !eventScenes.has(id) && !reachable.has(id),
    );
    expect(
      orphans,
      `孤儿事件场景（ev_ 前缀但既无事件引用也不可达）：${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('C7 事件场景可退出：每条事件场景都有**无条件**出口选项', async () => {
    const definition = await definitionPromise;
    // 为什么需要本检（2026-09-15 用户实测暴露，本轮新增）：
    // 事件场景以**子会话**进入（§4.2 挂起栈）。引擎对「选项无流程跳转」的语义是
    // 正确的——留在当前场景、回到 await_choice（§4.2）——但这对事件子会话意味着
    // **永远出不去**：没有 back/goto 就不会弹栈返回主会话。C2 只验「事件可触发」，
    // 于是 10 条事件中 8 条是死胡同而全部检查全绿（与内容完整性反思报告同类盲区）。
    //
    // 判定口径：
    // - 出口 = choice.goto 或任一效果（含 check/battle 分支的子效果）产出
    //   goto/back/ending/loop_transition（设计 §3.3 四条流程指令）；
    // - 要求至少一个出口**无 showIf**：带条件的出口可能在运行期被隐藏，
    //   那时玩家仍会被困——「始终可离开」才是可交付的保证；
    // - 零选项事件场景同样不合格：段落尽 → 无可见选项 → `#finish('exhausted')`
    //   会连同挂起的主会话一起结束（整个游戏终局，不只是返回）。
    const evScenes = new Set(definition.events.map((e) => e.scene));
    const trapped: string[] = [];
    for (const sceneId of evScenes) {
      const scene = definition.scenes.get(sceneId);
      if (scene === undefined) continue; // 缺失引用由上面的孤儿检查覆盖
      const choices = scene.def.choices as SceneChoice[];
      const hasUnconditionalExit = choices.some(
        (choice) => choiceHasExit(choice) && choice.showIf === undefined,
      );
      if (!hasUnconditionalExit) trapped.push(sceneId);
    }
    expect(trapped, `无无条件出口的事件场景（进入后无法离开）：${trapped.join(', ')}`).toEqual([]);
  });

  it('C8 可重复点击的选项不得含可失败指令：quest accept/advance/complete 必须被 once/showIf 守护', async () => {
    const definition = await definitionPromise;
    // 为什么需要本检（2026-09-15 用户实测：重复点「辨认徽记」后选项全消失）：
    // 选项效果是**单个原子事务**（§3.1）。`quest: accept` 在校验不满足时抛
    // EFFECT_FAILED（§4.5 状态机拒绝），整批回滚；若该选项不含 once/showIf 守卫，
    // 玩家就能反复点中一个「必然失败」的选项。宿主虽已做失败恢复（不卡死），
    // 但「点得动却永远失败」本身就是内容缺陷——入口必须与它自己的前置条件同口径。
    //
    // 口径：`quest` 指令（非 accept 的 fail 也计）所在的选项，必须满足二者之一——
    //   (a) `once: true`（选过即隐藏），或
    //   (b) 有 `showIf`（前置不满足时不出现）。
    // 纯 `accept` + 无条件 + 非一次性 = 一个「可重复失败」的入口。
    const violations: string[] = [];
    for (const scene of definition.scenes.values()) {
      for (const choice of scene.def.choices as SceneChoice[]) {
        const hasQuestInstruction = (choice.effects ?? []).some((effect) => {
          if (typeof effect !== 'object' || effect === null) return false;
          return 'quest' in (effect as Record<string, unknown>);
        });
        if (!hasQuestInstruction) continue;
        const guarded = choice.once === true || choice.showIf !== undefined;
        if (!guarded) violations.push(`${scene.def.id}#${choice.id}`);
      }
    }
    expect(
      violations,
      `可重复点击且含 quest 指令（可能反复失败）的选项：${violations.join(', ')}`,
    ).toEqual([]);
  });

  it('C9 正向读取的 flag 必须有写入口（无「幽灵 flag」）', async () => {
    const definition = await definitionPromise;
    // 为什么需要本检（2026-09-15 排查事件零触发时发现）：
    // `flag.<名>` 是**渐进域**（缺省 undefined，不报错），因此「读取一个永远为
    // undefined 的 flag」不会抛错、也不会被加载器拦住——它只是**永远为假**。
    // 事件 require、任务 completeWhen、场景 showIf 都可能因此永久失效
    // （实测：ev_wall_whisper 的 require 读 `flag.old_guard_met`，而全包无写入点
    // → 该事件永不触发）。C2 只验「事件可达」，覆盖不到这一层。
    //
    // 口径：从**已加载的 definition** 收集所有表达式的 flag 读取（正向，不含
    // `!flag.x`）与全部 flag 写入点（set/flag 指令 + npc.flags 写入），
    // 报告「只读不写」的名字。反向（写了不读）不报——预留写入是合法的。
    const written = new Set<string>();
    const positiveReads = new Map<string, Set<string>>();
    /** 收集一段表达式原文中的 flag 读写；source 为定位标签 */
    const scanExpr = (source: string, label: string): void => {
      for (const match of source.matchAll(/(!?)\s*flag\.([a-z_][a-z0-9_]*)/g)) {
        const negated = match[1] === '!';
        const name = match[2] as string;
        if (negated) continue; // 反向读取（「尚未发生」）不需要写入口
        const holders = positiveReads.get(name) ?? new Set<string>();
        holders.add(label);
        positiveReads.set(name, holders);
      }
    };
    /** 收集效果序列中的 flag 写入 */
    const collectWrites = (effects: readonly unknown[] | undefined): void => {
      for (const effect of effects ?? []) {
        if (typeof effect !== 'object' || effect === null) continue;
        const record = effect as Record<string, unknown>;
        const flag = record['flag'];
        if (typeof flag === 'object' && flag !== null) {
          const name = (flag as Record<string, unknown>)['name'];
          if (typeof name === 'string') written.add(name);
        }
        const set = record['set'];
        if (typeof set === 'object' && set !== null) {
          const key = (set as Record<string, unknown>)['key'];
          if (typeof key === 'string' && key.startsWith('flag.')) {
            written.add(key.slice('flag.'.length));
          }
        }
      }
    };

    const scanNested = (effects: readonly unknown[] | undefined, label: string): void => {
      collectWrites(effects);
      for (const effect of effects ?? []) {
        if (typeof effect !== 'object' || effect === null) continue;
        const record = effect as Record<string, unknown>;
        for (const field of BRANCH_EFFECT_FIELDS) {
          const branch = record[field];
          if (Array.isArray(branch)) scanNested(branch, label);
        }
      }
    };

    // 场景：段落 showIf、选项 showIf/disabledIf、选项效果写入
    for (const scene of definition.scenes.values()) {
      const label = `scene:${scene.def.id}`;
      for (const segment of scene.def.segments) {
        if (segment.showIf !== undefined) scanExpr(segment.showIf, label);
      }
      for (const choice of scene.def.choices as SceneChoice[]) {
        if (choice.showIf !== undefined) scanExpr(choice.showIf, label);
        scanNested(choice.effects, `${label}#${choice.id}`);
      }
    }
    // 事件：when 条件与 require
    for (const event of definition.events) {
      const label = `event:${event.id}`;
      if (event.trigger.require !== undefined) scanExpr(event.trigger.require, label);
    }
    // 任务：acceptIf / completeWhen / failWhen；奖励里的 flag 写入
    for (const [questId, quest] of definition.quests) {
      const label = `quest:${questId}`;
      if (quest.acceptIf !== undefined) scanExpr(quest.acceptIf, label);
      if (quest.failWhen !== undefined) scanExpr(quest.failWhen, label);
      for (const stage of quest.stages) scanExpr(stage.completeWhen, label);
      collectWrites(quest.rewards);
    }

    const phantom = [...positiveReads.keys()].filter((name) => !written.has(name)).sort();
    const detail = phantom
      .map((name) => `${name}（读取处：${[...(positiveReads.get(name) ?? [])].join(', ')}）`)
      .join('；');
    expect(phantom, `无写入口的 flag（永远为假）：${detail}`).toEqual([]);
  });

  it('C10 地图可导航：每个地点都解析出入口场景，且入口场景可达', async () => {
    const definition = await definitionPromise;
    // 为什么需要本检（FR-XPLR-02 地图导航；2026-09-15 用户实测问题 1c）：
    // C1 只验「区域里有场景可达」，验不了「点地图能走到」——地点与场景之间
    // 原本没有映射边，点击地图只会推进时间、不切场景，而全部检查全绿。
    // 本检守护映射的**完整性与一致性**（解析规则本身在 navigation.ts 的单测覆盖）。
    const missing: string[] = [];
    for (const area of definition.areas.values()) {
      for (const locationId of Object.keys(area.locations)) {
        if (!definition.locationEntries.has(`${area.id}/${locationId}`)) {
          missing.push(`${area.id}/${locationId}`);
        }
      }
    }
    expect(missing, `无导航入口的地点（地图点击将无反应）：${missing.join(', ')}`).toEqual([]);

    // 入口场景必须从 entryScene 出发可达（否则「点得到却走不进去」）
    const reachable = reachableSceneIds(definition);
    const unreachable = [...definition.locationEntries.entries()]
      .filter(([, sceneId]) => !reachable.has(sceneId))
      .map(([key, sceneId]) => `${key} → ${sceneId}`);
    expect(unreachable, `入口场景不可达（叙事上走不到）：${unreachable.join(', ')}`).toEqual([]);
  });

  it('C11 任务可结算：有奖励的任务必须有 quest:complete 提交入口', async () => {
    const definition = await definitionPromise;
    // 为什么需要本检（2026-09-15 实测：任务链能接取、能推进，但奖励永远发不出）：
    // 六态机里 `ready_to_submit → done` 是**唯一结算 rewards 的路径**，而它只能
    // 由 `quest: {action: complete}`（对 ready_to_submit 任务内部转 submit）触发。
    // 夹具曾只有两条 `accept` 调用点、**没有任何 advance/complete**——任务停在
    // 「待提交」，`rewards` 永不入账。C3 只验「有接取点」，验不了「能结算」。
    //
    // 口径：声明了非空 `rewards` 的任务，必须存在 `quest {id, action: complete}`
    // 调用点（advance 只推进阶段，不结算奖励，不算数）。
    const completed = new Set<string>();
    for (const scene of definition.scenes.values()) {
      for (const choice of scene.def.choices as SceneChoice[]) {
        for (const effect of choice.effects ?? []) {
          if (typeof effect !== 'object' || effect === null) continue;
          const quest = (effect as Record<string, unknown>)['quest'];
          if (typeof quest !== 'object' || quest === null) continue;
          const record = quest as Record<string, unknown>;
          if (record['action'] === 'complete' && typeof record['id'] === 'string') {
            completed.add(record['id']);
          }
        }
      }
    }
    const unreachable: string[] = [];
    for (const [questId, quest] of definition.quests) {
      if ((quest.rewards ?? []).length === 0) continue;
      if (!completed.has(questId)) unreachable.push(questId);
    }
    expect(
      unreachable,
      `有奖励但无提交入口的任务（奖励永远发不出）：${unreachable.join(', ')}`,
    ).toEqual([]);
  });
});

/** 从 entryScene 出发沿跳转边 BFS 的可达场景集合 */
function reachableSceneIds(definition: GameDefinition): Set<string> {
  const edges = new Map<string, string[]>();
  for (const scene of definition.scenes.values()) {
    edges.set(scene.def.id, (scene.def.choices as SceneChoice[]).flatMap(collectFlowTargets));
  }
  const reached = new Set<string>();
  const queue = [definition.manifest.entryScene];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (reached.has(current)) continue;
    reached.add(current);
    for (const next of edges.get(current) ?? []) queue.push(next);
  }
  return reached;
}
