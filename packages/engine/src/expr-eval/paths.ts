/**
 * 变量域白名单与路径形态规则（设计 §2.3 白名单表，03 任务 A3/B2）。
 *
 * - root 精确匹配：白名单之外的 root 在编译期报 EXPR_COMPILE（未知 root）；
 * - 每个域的合法路径形态在编译期校验（AST 静态可知），形态不符同样
 *   报 EXPR_COMPILE（定位 where 携带 root 与完整路径）；
 * - 运行期缺席语义（严格 / 宽松）由求值器按「封闭域严格、渐进域宽松」
 *   原则执行（见 ExprScope TSDoc 与 eval.ts），本表附注每域缺席值。
 */

/** 变量域白名单（§2.3 表格逐项；root 精确匹配） */
export const EXPR_ROOTS: readonly string[] = [
  'attr',
  'skill',
  'flag',
  'item',
  'outfit',
  'body',
  'npc',
  'faction',
  'time',
  'loop',
  'meta',
  'quest',
  'wallet',
  'battle',
];

/** time 域合法字段（求值视图 ExprTimeView 的键，04 号模块从 Clock 投影） */
const TIME_FIELDS: readonly string[] = ['day', 'weekday', 'slot'];

/** skill 域记录的合法子字段（ExprSkillValue 键） */
const SKILL_FIELDS: readonly string[] = ['value', 'exp'];

/** quest 域记录的合法子字段（QuestState.state / .stage） */
const QUEST_FIELDS: readonly string[] = ['state', 'stage'];

/**
 * 校验某 root 下的路径形态（rest 为去掉 root 后的段）。
 * 合法返回 null；非法返回面向作者的定位描述（进 EXPR_COMPILE 的 detail）。
 */
export function pathShapeError(root: string, rest: readonly string[]): string | null {
  switch (root) {
    case 'attr':
      return rest.length === 1 ? null : 'attr 路径应为 attr.<name>';
    case 'skill':
      if (rest.length === 1) return null;
      if (rest.length === 2 && SKILL_FIELDS.includes(rest[1] as string)) return null;
      return 'skill 路径应为 skill.<name> 或 skill.<name>.<value|exp>';
    case 'flag':
      return rest.length === 1 ? null : 'flag 路径应为 flag.<name>';
    case 'item':
      return rest.length === 2 && rest[1] === 'count' ? null : 'item 路径应为 item.<id>.count';
    case 'outfit':
      // 层键为内容约定的标识符（开放集合，缺席 = 未穿戴 → null）；
      // 数值层（garment.layer 1..3）经 worn(part, layer) 函数查询。
      return rest.length === 2 ? null : 'outfit 路径应为 outfit.<part>.<layer>';
    case 'body':
      if (rest.length === 1) return null;
      // 渐进变身进度（FR-BODY-05）：body.progress.<part>（0..100）
      if (rest.length === 2 && rest[0] === 'progress') return null;
      return 'body 路径应为 body.<part> 或 body.progress.<part>';
    case 'npc':
      if (rest.length === 2) {
        return rest[1] === 'flags' ? 'npc.<id>.flags 需带 flag 名：npc.<id>.flags.<name>' : null;
      }
      if (rest.length === 3 && rest[1] === 'flags') return null;
      return 'npc 路径应为 npc.<id>.<favor|stage|met|at|自定义flag> 或 npc.<id>.flags.<flag名>';
    case 'faction':
      return rest.length === 1 ? null : 'faction 路径应为 faction.<id>';
    case 'time':
      if (rest.length === 1 && TIME_FIELDS.includes(rest[0] as string)) return null;
      return 'time 路径应为 time.<day|weekday|slot>';
    case 'loop':
      return rest.length === 0 ? null : 'loop 为标量域，不接受子路径';
    case 'meta':
      if (rest.length === 1 && rest[0] === 'points') return null;
      if (rest.length === 2 && rest[0] === 'perk') return null;
      return 'meta 路径应为 meta.points 或 meta.perk.<id>';
    case 'quest':
      if (rest.length === 1) return null;
      if (rest.length === 2 && QUEST_FIELDS.includes(rest[1] as string)) return null;
      return 'quest 路径应为 quest.<id> 或 quest.<id>.<state|stage>';
    case 'wallet':
      return rest.length === 1 ? null : 'wallet 路径应为 wallet.<currency>';
    case 'battle':
      // battle.round 标量；battle.self.<hp|maxHp|attr>；battle.<enemies|allies>.alive
      if (rest.length === 1 && rest[0] === 'round') return null;
      if (rest.length === 2 && rest[0] === 'self') return null;
      if (
        rest.length === 2 &&
        (rest[0] === 'enemies' || rest[0] === 'allies') &&
        rest[1] === 'alive'
      ) {
        return null;
      }
      return 'battle 路径应为 battle.round / battle.self.<hp|maxHp|attr> / battle.<enemies|allies>.alive';
    default:
      return null; // 未知 root 由调用方先行校验
  }
}

/** 表达式路径的完整性描述：完整点路径（含 root），错误定位与 refs 共用 */
export function joinPath(segments: readonly string[]): string {
  return segments.join('.');
}

/** 从路径段中拆出 root 与剩余段（调用方保证至少一段） */
export function splitRoot(segments: readonly string[]): { root: string; rest: string[] } {
  return { root: segments[0] as string, rest: segments.slice(1) };
}

/** 白名单外 root 的统一错误文案（EXPR_COMPILE detail） */
export function unknownRootDetail(root: string): string {
  return `未知变量域 root '${root}'（白名单：${EXPR_ROOTS.join(' / ')}）`;
}
