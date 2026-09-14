import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { ContentTagsDef } from '@game/shared';
import { ContentFilter } from '../../src/content/index.js';
import { DEFAULT_PLAYER_SETTINGS, newGameState } from '../../src/state/index.js';

/**
 * 首启向导数据支撑（22 任务 6，设计 §5.8/§6.5，FR-CGRD-04）。
 *
 * 引擎侧只提供**数据**，不承载向导 UI 流程（§5.8「首启向导是 UI 流程」）：
 * - `ContentFilter.initialDisabledTags()`：由 ContentTagsDef.defaultOn 投影出
 *   初始开关态，供向导/设置面板初始化；
 * - `settings.wizardDone` 标志（02 号 schema + 04 号状态树已承载）驱动是否
 *   展示向导，并可随档持久化。
 *
 * 规格冲突（SPEC_CONFLICT，未实现）：design §6.5 要求「内容警告页文案来自
 * manifest（`contentWarning` 文本键）」，但 shared `manifestSchema`（02 号，
 * 本分支只读）为 strictObject 且未声明 `contentWarning` 字段，`Manifest` 类型
 * 亦无该键——引擎无法在不改 shared 的前提下提供真实读取路径。详见任务书
 * 22-content-filter.md 的边界说明与主 Agent 报告。
 */

describe('22-6 首启向导：初始禁用标签投影（ContentTagsDef.defaultOn）', () => {
  const TAGS: ContentTagsDef = {
    tags: [
      { id: 'tag_gore', nameKey: 'tags.gore.name', defaultOn: false },
      { id: 'tag_romance', nameKey: 'tags.romance.name', defaultOn: true },
      { id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: false },
    ],
  };

  it('返回 defaultOn=false 的标签 id，按声明序', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: [] });
    expect(filter.initialDisabledTags()).toEqual(['tag_gore', 'tag_horror']);
  });

  it('全部 defaultOn=true → 初始禁用集为空', () => {
    const filter = new ContentFilter(
      { tags: [{ id: 'tag_romance', nameKey: 'tags.romance.name', defaultOn: true }] },
      { disabledTags: [] },
    );
    expect(filter.initialDisabledTags()).toEqual([]);
  });

  it('初始禁用集是纯投影，不受玩家 disabledTags 影响（两者语义分离）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_romance'] });
    expect(filter.initialDisabledTags()).toEqual(['tag_gore', 'tag_horror']);
    // 玩家实际关闭的是 tag_romance：运行期判定以 disabledTags 为准
    expect(filter.passes(['tag_romance'])).toBe(false);
    expect(filter.passes(['tag_gore'])).toBe(true);
  });

  it('输入 ContentTagsDef 不被改写（投影只读）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: [] });
    filter.initialDisabledTags();
    expect(TAGS.tags[0]?.defaultOn).toBe(false);
  });
});

describe('22-6 首启向导：settings.wizardDone 标志数据支撑', () => {
  it('缺省设置 wizardDone=false（新玩家需走向导）', () => {
    expect(DEFAULT_PLAYER_SETTINGS.wizardDone).toBe(false);
  });

  it('新档可经 bootstrap.settings 覆盖 wizardDone（跳过/已完成向导）', () => {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' },
        settings: { wizardDone: true },
      },
      createRng(1),
    );
    expect(state.settings.wizardDone).toBe(true);
    // 其余设置项由缺省值补齐（04 号逐项覆盖语义）
    expect(state.settings.disabledTags).toEqual([]);
  });
});
