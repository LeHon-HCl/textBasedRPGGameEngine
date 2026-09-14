import type { CSSProperties, ReactNode } from 'react';
import { TOUCH_TARGET_PX } from '../app/AppShell.js';
import type { MapAreaView, MapLocationView } from './map-projection.js';

/**
 * 地图导航面板（设计 §6.2 MapPanelProps / FR-UI-02）。
 *
 * 展示：区域图（按坐标空间次序的地点列表）+ 移动消耗 + 当前位置高亮；
 * 锁定地点**禁用但可见**，并显示解锁条件原文（「未知/可达条件提示」，
 * 文案由游戏配置 —— 引擎与 UI 都不解释条件语义）。
 *
 * 契约：props 受控——区域视图由宿主经 projectAreaViews 投影后传入；
 * `current` 为当前位置（区域 + 地点）；点击回调 `onMove({area, location})`。
 */

/** 当前位置（区域 + 地点；地点缺省 = 区域级） */
export interface MapPosition {
  readonly area: string;
  readonly location?: string;
}

/** 地图面板文案（可注入本地化） */
export interface MapPanelLabels {
  /** 页标题（缺省「地图」） */
  readonly title?: string;
  /** 移动消耗模板（`{cost}` 占位；缺省「移动 {cost} 时段」） */
  readonly moveCost?: string;
  /** 零消耗文案（缺省「无需耗时」） */
  readonly moveFree?: string;
  /** 当前位置标记（缺省「当前」） */
  readonly current?: string;
  /** 未解锁区域提示（缺省「未解锁」） */
  readonly lockedArea?: string;
}

/** 缺省文案（D4 边界：正式文案由宿主注入） */
const DEFAULT_LABELS: Required<MapPanelLabels> = {
  title: '地图',
  moveCost: '移动 {cost} 时段',
  moveFree: '无需耗时',
  current: '当前',
  lockedArea: '未解锁',
};

/** MapPanel 属性（受控） */
export interface MapPanelProps {
  /** 区域视图（projectAreaViews 产物） */
  readonly areas: readonly MapAreaView[];
  /** 当前位置（高亮与「不可重复移动」判据） */
  readonly current: MapPosition;
  /** 文本键物化（通常为 `(key) => resolver.resolve(key, lang).text`） */
  readonly nameOf: (key: string) => string;
  /** 移动意图（宿主消费：checkpoint + advanceTime + 场景切换） */
  readonly onMove: (target: { area: string; location: string }) => void;
  /** 文案注入 */
  readonly labels?: MapPanelLabels;
}

/**
 * 地图面板（见模块 TSDoc）。
 *
 * 可点性判据：已解锁 ∧ 非当前位置。当前位置与锁定地点都渲染为禁用按钮
 * （禁用而非隐藏——玩家需要看到「我在哪」与「还差什么」）。
 */
export function MapPanel(props: MapPanelProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  return (
    <section style={styles.root}>
      <h3 style={styles.title}>{labels.title}</h3>
      {props.areas.map((area) => (
        <div key={area.id} style={styles.area} data-area={area.id}>
          <h4 style={styles.areaTitle}>
            {props.nameOf(area.nameKey)}
            {area.unlocked ? null : <span style={styles.badge}>{labels.lockedArea}</span>}
          </h4>
          <div style={styles.locations}>
            {area.locations.map((location) => renderLocation(area, location, props, labels))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** 单个地点按钮（当前位置 / 锁定 / 可移动三态） */
function renderLocation(
  area: MapAreaView,
  location: MapLocationView,
  props: MapPanelProps,
  labels: Required<MapPanelLabels>,
): ReactNode {
  const isCurrent = props.current.area === area.id && props.current.location === location.id;
  const disabled = !location.unlocked || isCurrent;
  const costText =
    location.moveCost === 0
      ? labels.moveFree
      : labels.moveCost.replace('{cost}', String(location.moveCost));
  return (
    <button
      key={location.id}
      type="button"
      data-location={location.id}
      data-current={isCurrent ? 'true' : 'false'}
      {...(isCurrent ? { 'aria-current': 'true' as const } : {})}
      disabled={disabled}
      onClick={() => props.onMove({ area: area.id, location: location.id })}
      style={styles.locationButton}
    >
      <span style={styles.locationLabel}>{props.nameOf(location.nameKey)}</span>
      <span style={styles.locationHint}>
        {costText}
        {isCurrent ? ` · ${labels.current}` : ''}
        {location.unlockHint !== undefined ? ` · ${location.unlockHint}` : ''}
      </span>
    </button>
  );
}

/** 样式（内联；只锁定触控尺寸与列表结构这类契约性属性） */
const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: '12px' },
  title: { margin: 0, fontSize: '14px', fontWeight: 600, opacity: 0.8 },
  area: { display: 'flex', flexDirection: 'column', gap: '6px' },
  areaTitle: { margin: 0, fontSize: '14px', fontWeight: 600, display: 'flex', gap: '6px' },
  badge: { fontSize: '12px', fontWeight: 400, opacity: 0.7 },
  locations: { display: 'flex', flexDirection: 'column', gap: '6px' },
  locationButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '8px 12px',
    fontSize: '14px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  locationLabel: { display: 'block' },
  locationHint: { display: 'block', fontSize: '12px', opacity: 0.72 },
};
