import { describe, expect, it } from 'vitest';
import type { MediaIntent, MediaEvent, NotifyEvent } from '../../src/runtime/index.js';
import type { NarrativeMediaResolver } from '../../src/narrative/index.js';
import { makeCtx, makeBuiltinRuntime } from '../effects/fixtures.js';

/**
 * 24 任务 5：`media`（一次性媒体意图）与 `notify`（文本提示）分离验证
 * （FR-MEDIA-05 vs FR-UI-07）。
 *
 * 分离点：
 * - 两类事件类型不同（media vs notify），宿主消费路径独立——Toast 与播放器
 *   互不干涉（订阅面按 type 分发）；
 * - media 注入解析器后产出经存在性核对的 intent（缺失 → missing 占位标记，
 *   FR-MEDIA-06）；缺省未注入 = 既有裸 intent 行为（向后兼容）；
 * - media 不写状态（touch 空报告：纯表现面）。
 */

/** 解析器桩（与 media/resolver.test.ts 同口径：核对 + 补缺失标记） */
function resolverOf(known: readonly string[]): NarrativeMediaResolver {
  const set = new Set(known);
  return {
    decorate(intent: MediaIntent): MediaIntent {
      if (set.has(intent.assetId)) return intent;
      return { ...intent, missing: true } as MediaIntent;
    },
  };
}

/** 订阅两类事件（分离验证的观察面） */
function subscribe(rt: ReturnType<typeof makeBuiltinRuntime>['rt']): {
  media: MediaEvent[];
  notify: NotifyEvent[];
} {
  const media: MediaEvent[] = [];
  const notify: NotifyEvent[] = [];
  rt.on('media', (event) => media.push(event));
  rt.on('notify', (event) => notify.push(event));
  return { media, notify };
}

describe('24-5 media 与 notify 分离', () => {
  it('media 指令只触发 media 事件（不落入 notify 通道）', () => {
    const { rt } = makeBuiltinRuntime();
    const log = subscribe(rt);
    rt.exec([{ media: { type: 'sfx', assetId: 'sfx_click' } }], makeCtx());
    expect(log.media.map((event) => event.intent)).toEqual([
      { type: 'sfx', assetId: 'sfx_click' },
    ]);
    expect(log.notify).toEqual([]);
  });

  it('notify 指令只触发 notify 事件（不落入 media 通道；无媒体字段）', () => {
    const { rt } = makeBuiltinRuntime();
    const log = subscribe(rt);
    rt.exec([{ notify: { textKey: 'ui.toast.saved' } }], makeCtx());
    expect(log.notify).toEqual([{ type: 'notify', textKey: 'ui.toast.saved' }]);
    expect(log.media).toEqual([]);
    expect(log.notify[0]).not.toHaveProperty('intent');
  });

  it('notify 的 vars 经宽松求值后随事件（文本面独立于媒体面）', () => {
    const { rt } = makeBuiltinRuntime();
    const log = subscribe(rt);
    rt.exec([{ notify: { textKey: 'ui.toast.gain', vars: { n: '1 + 2' } } }], makeCtx());
    expect(log.notify).toEqual([{ type: 'notify', textKey: 'ui.toast.gain', vars: { n: 3 } }]);
  });

  it('注入解析器 → media 指令产出经核对的 intent（缺失带 missing 标记，FR-MEDIA-06）', () => {
    const { rt } = makeBuiltinRuntime({
      registryOptions: { mediaResolver: resolverOf(['sfx_ok']) },
    });
    const log = subscribe(rt);
    rt.exec([{ media: { type: 'sfx', assetId: 'sfx_ok' } }], makeCtx());
    rt.exec([{ media: { type: 'sfx', assetId: 'sfx_gone' } }], makeCtx());
    expect(log.media.map((event) => event.intent)).toEqual([
      { type: 'sfx', assetId: 'sfx_ok' },
      { type: 'sfx', assetId: 'sfx_gone', missing: true },
    ]);
  });

  it('bg/cg/sprite 带 transition、bgm 恒 loop（经解析器亦保持判别特征）', () => {
    const { rt } = makeBuiltinRuntime({
      registryOptions: { mediaResolver: resolverOf(['bg_x', 'bgm_x', 'cg_x']) },
    });
    const log = subscribe(rt);
    rt.exec(
      [
        { media: { type: 'bg', assetId: 'bg_x', transition: 'fade' } },
        { media: { type: 'bgm', assetId: 'bgm_x' } },
        { media: { type: 'cg', assetId: 'cg_x', transition: 'cut' } },
      ],
      makeCtx(),
    );
    expect(log.media.map((event) => event.intent)).toEqual([
      { type: 'bg', assetId: 'bg_x', transition: 'fade' },
      { type: 'bgm', assetId: 'bgm_x', loop: true },
      { type: 'cg', assetId: 'cg_x', transition: 'cut' },
    ]);
  });

  it('未注入解析器 → 既有行为（裸 intent，无 missing；向后兼容）', () => {
    const { rt } = makeBuiltinRuntime();
    const log = subscribe(rt);
    rt.exec([{ media: { type: 'bg', assetId: 'bg_x' } }], makeCtx());
    expect(log.media).toEqual([{ type: 'media', intent: { type: 'bg', assetId: 'bg_x' } }]);
  });

  it('同事务内两类事件按指令序独立送达（通道互不吞并）', () => {
    const { rt } = makeBuiltinRuntime();
    const log = subscribe(rt);
    rt.exec(
      [
        { media: { type: 'sfx', assetId: 'sfx_x' } },
        { notify: { textKey: 'ui.toast.x' } },
        { media: { type: 'sfx', assetId: 'sfx_y' } },
      ],
      makeCtx(),
    );
    expect(log.media.map((event) => event.intent.assetId)).toEqual(['sfx_x', 'sfx_y']);
    expect(log.notify.map((event) => event.textKey)).toEqual(['ui.toast.x']);
  });

  it('media 是纯表现面：不产生状态补丁（touch 空报告）', () => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec([{ media: { type: 'sfx', assetId: 'sfx_x' } }], makeCtx());
    expect(outcome.patches).toEqual([]);
  });
});
