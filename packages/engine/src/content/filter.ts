import type { ContentTagsDef, EventDef, GameId, TextKey } from '@game/shared';

/**
 * 内容分级过滤器（设计 §5.8 ContentFilter；FR-CGRD-01~03）。
 *
 * 机制中立性红线（设计 §1.2 R4 / proposal R-10）：引擎只做「标签 id 集合 ∩
 * 玩家禁用的标签集合」的判定，**不解释任何标签语义**——标签含义、整体分级与
 * 内容责任归游戏包与发布者。三个应用点（事件池 prune / 段落渲染前占位替换 /
 * 选项 choices 过滤）都汇聚到本单点，切换设置即时生效的做法是**重建实例**
 * （FR-CGRD-03）：实例在构造时快照 settings.disabledTags，不随后续状态改写。
 */

/** ContentFilter 构造的设置切片（FR-CGRD-03：玩家关闭的标签集合） */
export interface ContentFilterSettings {
  /** 玩家在设置面板关闭的内容标签 id（命中即屏蔽；空数组 = 缺省不过滤） */
  readonly disabledTags: readonly string[];
}

/** ContentFilter 构造的可选策略（游戏包提供的过滤呈现策略） */
export interface ContentFilterOptions {
  /**
   * 被屏蔽文本段的占位文本键（FR-CGRD-03「游戏提供」）。缺省 = 不提供，
   * 此时 {@link ContentFilter.placeholderFor} 对被屏蔽内容返回 null，调用方
   * 按「跳过该段落」处理（占位文案与是否跳过由游戏/宿主决定，引擎不内置文案）。
   */
  readonly placeholderKey?: TextKey;
}

/**
 * 内容分级过滤器（§5.8）。
 *
 * 不变式：
 * - 标签判定为纯函数——不读写 GameState、无副作用、同一实例对同一入参结果稳定；
 * - 实例构造后不可变；设置变更后由宿主重建实例再重渲染（FR-CGRD-03 即时生效）；
 * - 无标签（undefined / 空数组）的内容恒放行，未标注内容不受过滤影响。
 *
 * 应用点 1（事件池 prune）的调用说明见 {@link ContentFilter.eventAdmissible}。
 */
export class ContentFilter {
  /** 玩家关闭的标签集合（构造时快照，保证实例不可变） */
  readonly #disabled: ReadonlySet<string>;
  /** 声明为默认关闭的标签 id（声明序；首启向导初始开关态，FR-CGRD-04 数据支撑） */
  readonly #defaultOff: readonly GameId[];
  /** 被屏蔽内容的占位文本键；null = 未配置（调用方跳过） */
  readonly #placeholderKey: TextKey | null;

  constructor(
    tags: ContentTagsDef,
    settings: ContentFilterSettings,
    options: ContentFilterOptions = {},
  ) {
    this.#disabled = new Set(settings.disabledTags);
    // 默认关闭态仅用于向导初始值；运行期过滤以玩家实际选择的 disabledTags 为准
    this.#defaultOff = tags.tags.filter((tag) => !tag.defaultOn).map((tag) => tag.id);
    this.#placeholderKey = options.placeholderKey ?? null;
  }

  /**
   * 判定一组内容标签是否放行（FR-CGRD-02/03）。
   *
   * - 无标签 / 空数组 → true（未标注内容不受过滤影响）；
   * - 任一标签被玩家关闭 → false（多标签取「任一命中即屏蔽」语义）。
   */
  passes(tags?: readonly string[]): boolean {
    if (tags === undefined || tags.length === 0) return true;
    return !tags.some((tag) => this.#disabled.has(tag));
  }

  /**
   * 事件池 prune 判据（应用点 1，设计 §4.4）。
   *
   * **接入说明（10 号事件系统）**：事件系统在 collect/prune 步骤对候选
   * {@link EventDef} 调用本谓词，返回 false 的事件不进入事件池（被屏蔽事件
   * 不再触发，FR-CGRD-03）；本模块只提供接口与语义，prune 管线的真正接线属
   * 10 号事件系统。10 号接入时零改动换实现——直接以本实例替换桩即可。
   *
   * @param event 事件定义（`EventDef.tags` 为内容标签，缺省 = 未标注恒放行）
   * @returns true = 可进入事件池；false = 被屏蔽
   */
  eventAdmissible(event: Pick<EventDef, 'tags'>): boolean {
    return this.passes(event.tags);
  }

  /**
   * 被屏蔽文本段的占位文本键（应用点 2，FR-CGRD-03「游戏提供」）。
   *
   * 返回值语义（null 有两处来源，调用方须先经 {@link passes} 判定是否屏蔽）：
   * - 标签未被屏蔽 → null（调用方保留原文，不做替换）；
   * - 标签被屏蔽且游戏配置了占位键 → 返回该键；
   * - 标签被屏蔽但未配置占位键 → null（调用方跳过该段落）。
   *
   * @param tags 文本段/场景的内容标签
   */
  placeholderFor(tags?: readonly string[]): TextKey | null {
    if (this.passes(tags)) return null;
    return this.#placeholderKey;
  }

  /**
   * 首启向导的初始禁用标签集（FR-CGRD-04 数据支撑）：声明为 `defaultOn: false`
   * 的标签 id，按声明序返回。UI 以此初始化开关；玩家确认后的实际选择写入
   * `settings.disabledTags`（本方法不读写状态，是纯投影）。
   */
  initialDisabledTags(): readonly GameId[] {
    return [...this.#defaultOff];
  }
}
