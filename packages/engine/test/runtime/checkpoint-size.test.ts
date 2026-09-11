import { describe, expect, it } from 'vitest';
import { PERF_GUARD } from '../../src/runtime/perf-guard.js';
import type { SnapshotWarnEvent } from '../../src/runtime/engine-events.js';
import { BASE_VERSIONS, makeCtx, makeRuntime } from './fixtures.js';

/**
 * 快照体积告警分支用例（04 任务 C2，设计 §3.1 快照策略：单快照 > 5MB 告警
 * 建议调低栈深；阈值由 PERF_GUARD 集中管理、构造可覆盖）。
 *
 * 体积口径：JSON 序列化长度（UTF-16 码元数，ASCII 内容近似字节数）。
 */

describe('04-C2 快照体积告警（snapshot_warn）', () => {
  it('超过默认 5MB 阈值：发出 snapshot_warn，字段完整', () => {
    const warns: SnapshotWarnEvent[] = [];
    const rt = makeRuntime({
      bootstrap: {
        versions: BASE_VERSIONS,
        flags: { blob: 'x'.repeat(6 * 1024 * 1024) },
      },
    });
    rt.on('snapshot_warn', (event) => warns.push(event));
    rt.checkpoint('huge_state');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.label).toBe('huge_state');
    expect(warns[0]?.thresholdBytes).toBe(PERF_GUARD.checkpointSnapshotWarnBytes);
    expect(warns[0]?.sizeBytes).toBeGreaterThan(warns[0]?.thresholdBytes ?? 0);
  });

  it('告警不阻断：checkpoint 仍入栈、rollback 仍可用', () => {
    const rt = makeRuntime({
      bootstrap: {
        versions: BASE_VERSIONS,
        attrs: { hp: 30 },
        flags: { blob: 'x'.repeat(6 * 1024 * 1024) },
      },
    });
    rt.on('snapshot_warn', () => {});
    rt.checkpoint('huge_state');
    rt.exec([{ set: { key: 'attr.hp', value: 1 } }], makeCtx());
    expect(rt.rollback(1)).toEqual({ ok: true, restoredLabel: 'huge_state' });
    expect(rt.state.player.attrs.hp).toBe(30);
  });

  it('低于阈值不告警（正常体积静默通过）', () => {
    const warns: SnapshotWarnEvent[] = [];
    const rt = makeRuntime();
    rt.on('snapshot_warn', (event) => warns.push(event));
    rt.checkpoint('small_state');
    rt.checkpoint('another');
    expect(warns).toEqual([]);
    expect(rt.rollback(1).ok).toBe(true);
  });

  it('阈值可配置：小状态 + 低阈值触发同一告警分支（分支可测性缝）', () => {
    const warns: SnapshotWarnEvent[] = [];
    const rt = makeRuntime({ snapshotWarnBytes: 100 });
    rt.on('snapshot_warn', (event) => warns.push(event));
    rt.checkpoint('tiny_state');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.label).toBe('tiny_state');
    expect(warns[0]?.thresholdBytes).toBe(100);
    expect(warns[0]?.sizeBytes).toBeGreaterThan(100);
  });

  it('PERF_GUARD 常量冻结且默认值符合 §3.1（栈深 5 / 阈值 5MB）', () => {
    expect(PERF_GUARD.checkpointStackDepth).toBe(5);
    expect(PERF_GUARD.checkpointSnapshotWarnBytes).toBe(5 * 1024 * 1024);
    expect(() => {
      (PERF_GUARD as { checkpointStackDepth: number }).checkpointStackDepth = 9;
    }).toThrow();
  });
});
