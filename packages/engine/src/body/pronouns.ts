import type { BodyDef } from '@game/shared';
import type { InterpVars } from '../i18n/index.js';

/**
 * 代词注入器（FR-BODY-04，§4.8，14 任务 3）。
 *
 * `BodyDef.pronouns`（`rule: 'by_part'` + `part` + `map`）编译为 {@link InterpVars}
 * 注入函数：按**当前部位值**取代词三形式（`[主语, 宾语, 所有格]`），注入
 * `player.they` / `player.them` / `player.their` 三个扁平键（§4.1 插值键形态，
 * 对应 FR-BODY-04 的 `{player.they}` 写法）。
 *
 * 容错口径（与 §4.1 插值语义一致）：
 * - 部位值无映射项、部位值缺失、未配置 pronouns → 对应键**不注入**（resolve
 *   期插值失败保留原文并告警，文本层不静默造词）；
 * - 映射数组可短于 3（部分语言无性别区分时只给主语）：只注入存在的位置。
 *
 * 中立性：引擎不解释身体/性别语义——映射表是纯数据，由游戏作者提供。
 */

/** 代词注入函数：当前 body 映射 → 插值变量袋（无代词时为空对象） */
export type PronounInjector = (body: Readonly<Record<string, string>>) => InterpVars;

/** 代词形式键位（数组下标 → 注入键，FR-BODY-04） */
const PRONOUN_KEYS: readonly string[] = ['player.they', 'player.them', 'player.their'];

/**
 * 构造代词注入器。
 *
 * @param bodyDefs 身体定义（含可选 pronouns 规则）；未配置 pronouns 时返回恒空注入器
 */
export function createPronounInjector(bodyDefs: BodyDef): PronounInjector {
  const pronouns = bodyDefs.pronouns;
  if (pronouns === undefined) return () => ({});
  const { part, map } = pronouns;
  return (body) => {
    const value = body[part];
    if (value === undefined) return {};
    const forms = map[value];
    if (forms === undefined) return {};
    const vars: InterpVars = {};
    for (let i = 0; i < PRONOUN_KEYS.length; i++) {
      const form = forms[i];
      const key = PRONOUN_KEYS[i];
      if (form !== undefined && key !== undefined) vars[key] = form;
    }
    return vars;
  };
}
