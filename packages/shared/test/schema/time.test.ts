import { describe, expect, it } from 'vitest';
import { timeConfigSchema } from '../../src/index.js';

/**
 * 09 任务 1：TimeConfig（data/time.yaml）解析与校验。
 *
 * schema 为 shared 单一来源（NFR-12）；跨字段规则（startWeekday ∈ 星期数、
 * slot id 唯一）以 refine 承载。正例取设计 §4.3 测试基线：4 时段 × 7 天 × 2 月。
 */

/** 4 时段 × 7 天 × 2 月的正例夹具（§4.3 独立测试基线） */
const VALID_CONFIG = {
  slots: [
    { id: 'slot_morning', nameKey: 'time.slot.morning' },
    { id: 'slot_noon', nameKey: 'time.slot.noon' },
    { id: 'slot_evening', nameKey: 'time.slot.evening' },
    { id: 'slot_night', nameKey: 'time.slot.night' },
  ],
  weekdays: [
    { nameKey: 'time.weekday.1' },
    { nameKey: 'time.weekday.2' },
    { nameKey: 'time.weekday.3' },
    { nameKey: 'time.weekday.4' },
    { nameKey: 'time.weekday.5' },
    { nameKey: 'time.weekday.6' },
    { nameKey: 'time.weekday.7' },
  ],
  startWeekday: 1,
  months: [
    { length: 30, nameKey: 'time.month.spring' },
    { length: 30, nameKey: 'time.month.summer' },
  ],
};

describe('09-1 timeConfigSchema：字段与跨字段校验', () => {
  it('完整正例（4 时段 × 7 天 × 2 月）通过校验', () => {
    const result = timeConfigSchema.safeParse(VALID_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slots).toHaveLength(4);
      expect(result.data.months).toHaveLength(2);
    }
  });

  it('months 可选（仅时段制日历；week/month 不入 Clock）', () => {
    const minimal = { ...VALID_CONFIG } as Partial<typeof VALID_CONFIG>;
    delete minimal.months;
    const result = timeConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('slots 为空 / weekdays 为空 → 拒绝', () => {
    expect(timeConfigSchema.safeParse({ ...VALID_CONFIG, slots: [] }).success).toBe(false);
    expect(timeConfigSchema.safeParse({ ...VALID_CONFIG, weekdays: [] }).success).toBe(false);
  });

  it('startWeekday 超出星期数 → 拒绝（跨字段 refine）', () => {
    const result = timeConfigSchema.safeParse({ ...VALID_CONFIG, startWeekday: 8 });
    expect(result.success).toBe(false);
  });

  it('startWeekday 为 0 / 负数 / 非整数 → 拒绝', () => {
    for (const startWeekday of [0, -1, 1.5]) {
      expect(timeConfigSchema.safeParse({ ...VALID_CONFIG, startWeekday }).success).toBe(false);
    }
  });

  it('slot id 重复 → 拒绝（时段 id 是表达式 time.slot 的比较键）', () => {
    const duplicated = {
      ...VALID_CONFIG,
      slots: [
        { id: 'slot_morning', nameKey: 'time.slot.morning' },
        { id: 'slot_morning', nameKey: 'time.slot.morning2' },
      ],
    };
    expect(timeConfigSchema.safeParse(duplicated).success).toBe(false);
  });

  it('month length 必须 ≥ 1 的整数；未知字段（strictObject）→ 拒绝', () => {
    const badLength = {
      ...VALID_CONFIG,
      months: [{ length: 0, nameKey: 'time.month.zero' }],
    };
    expect(timeConfigSchema.safeParse(badLength).success).toBe(false);
    expect(timeConfigSchema.safeParse({ ...VALID_CONFIG, unknown: 1 }).success).toBe(false);
  });
});
