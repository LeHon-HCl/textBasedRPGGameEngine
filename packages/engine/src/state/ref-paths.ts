/**
 * 表达式 ref 路径 → GameState 路径前缀（§2.3 白名单 → §3.1 状态树映射）。
 *
 * 11 号任务系统与 10 号事件系统共用同一套脏标记机制（设计 §4.5「与事件系统
 * 同一机制」）：条件的 `CompiledExpr.refs[].path` 是**表达式路径**（如
 * `flag.x`），而事务补丁路径是**状态树路径**（如 `world.flags.x`）——
 * 本模块是两者的唯一映射点，避免各子系统各写一份（曾因此在 11 号出现
 * 派生属性唤醒失效的缺陷）。
 *
 * 返回**候选前缀数组**：同一表达式路径可能对应多个状态写入点，任一被触碰
 * 都应唤醒条件——
 * - `attr.<id>`：数值属性写 `player.attrs.<id>`，派生属性（FR-STAT-05）写
 *   `player.derived.<id>`（`recomputeDerived` 的落位），两者互为数据源；
 * - `meta.*`：Profile 投影由宿主路由（DD-04 引擎不持有 Profile），其变化经
 *   `meta` 事务路径送达（18/21 号接入后生效）；
 * - 无候选（未知 root）返回空数组：该条件只能由主动扫描（时间管线步骤 7 等）
 *   评估，脏标记不唤醒。
 */
export function exprRefToStatePrefixes(refPath: string): readonly string[] {
  const [root, ...rest] = refPath.split('.');
  const [first, second, third] = rest;
  switch (root) {
    case 'attr':
      if (first === undefined) return [];
      return [`player.attrs.${first}`, `player.derived.${first}`];
    case 'meta':
      return first !== undefined ? [`meta.${first}`] : [];
    case 'skill':
      return first !== undefined ? [`player.skills.${first}`] : [];
    case 'flag':
      return first !== undefined ? [`world.flags.${first}`] : [];
    case 'item':
      return ['player.bag'];
    case 'outfit':
      return ['player.outfit'];
    case 'body':
      return first !== undefined ? [`player.body.${first}`] : [];
    case 'npc': {
      if (first === undefined) return [];
      if (second === 'flags' && third !== undefined) return [`npcs.${first}.flags.${third}`];
      if (second === 'favor' || second === 'stage' || second === 'met') {
        return [`npcs.${first}.${second}`];
      }
      // 自定义 flag 形态（npc.<id>.<flag>，§2.3）落在 npcs.<id>.flags.<flag>
      return second !== undefined ? [`npcs.${first}.flags.${second}`] : [`npcs.${first}`];
    }
    case 'faction':
      return first !== undefined ? [`factions.${first}`] : [];
    case 'time':
      return first !== undefined ? [`world.time.${first}`] : [];
    case 'loop':
      return ['loop'];
    case 'quest':
      if (first === undefined) return [];
      return second !== undefined ? [`quests.${first}.${second}`] : [`quests.${first}`];
    case 'wallet':
      return first !== undefined ? [`player.wallet.${first}`] : [];
    default:
      return [];
  }
}

/**
 * 前缀匹配：touched 是否命中条件前缀（相等 / touched 更深 / 前缀更深三形态）。
 * 例：前缀 `world.flags.rumor` 被 touched `world.flags`（更深）、
 * `world.flags.rumor`（相等）、`world.flags.rumor.seen`（更深）命中。
 */
export function touchedMatchesPrefix(prefix: string, touched: readonly string[]): boolean {
  for (const path of touched) {
    if (path === prefix || path.startsWith(`${prefix}.`) || prefix.startsWith(`${path}.`)) {
      return true;
    }
  }
  return false;
}

/**
 * 由 refs 反查表（`VarRef.path → 依赖方 id`）构建「依赖方 id → 状态路径前缀集」。
 * 供任务系统（questRefs）与事件系统（dirtyMap）共用的索引重构。
 */
export function buildStatePrefixIndex(
  refs: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): ReadonlyMap<string, readonly string[]> {
  const table = new Map<string, Set<string>>();
  for (const [refPath, ids] of refs ?? []) {
    const prefixes = exprRefToStatePrefixes(refPath);
    if (prefixes.length === 0) continue;
    for (const id of ids) {
      const bucket = table.get(id) ?? new Set<string>();
      for (const prefix of prefixes) bucket.add(prefix);
      table.set(id, bucket);
    }
  }
  return new Map([...table].map(([id, prefixes]) => [id, [...prefixes]]));
}
