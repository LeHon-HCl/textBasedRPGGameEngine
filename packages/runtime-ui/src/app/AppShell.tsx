import { useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { MobileTab } from './types.js';

/**
 * AppShell —— 应用外壳与响应式布局（设计 §6.1 组件树 / §6.2 响应式；FR-UI-01/09）。
 *
 * 布局契约：
 * - 宽屏（≥ {@link NARROW_BREAKPOINT_PX}）：主文本区 + 侧栏**双栏**；
 *   侧栏内状态/地图/任务三面板依次纵排（FR-UI-01）；
 * - 窄屏：侧栏折叠为 {@link MobileTabBar}（一次只显示当前 Tab 的面板，FR-UI-09），
 *   叙事区与底部选项区保持常驻；
 * - 全部内容经 props 传入（受控组件）：组件自身不读 store、不持有布局状态，
 *   断点判定由宿主的 `narrow` 决定（缺省经 `useIsNarrow` 走 matchMedia 订阅）。
 *
 * 不变式：`narrow` 显式传入时以属性为准（测试与样式预览可控）；仅在缺省时
 * 才回落到媒体查询，避免「宿主明示」与「环境推断」两套真相打架。
 */

/** 窄屏断点（px；FR-UI-09「桌面双栏、移动端侧栏折叠」的判定基准） */
export const NARROW_BREAKPOINT_PX = 900;

/** 触控目标最小高度（px；NFR-26 可点区尺寸，Tab 与按钮统一遵守） */
export const TOUCH_TARGET_PX = 44;

/** AppShell 属性（全部受控；测试可直接构造任意布局状态） */
export interface AppShellProps {
  /** 叙事区（主文本区，常驻） */
  readonly narrative: ReactNode;
  /** 底部选项区（常驻；通常为 OptionList） */
  readonly options: ReactNode;
  /** 状态面板（宽屏常驻侧栏 / 窄屏 Tab 内容） */
  readonly statusPanel: ReactNode;
  /** 地图面板（同上） */
  readonly mapPanel: ReactNode;
  /** 任务面板（同上） */
  readonly questPanel: ReactNode;
  /** 窄屏当前 Tab（受控：由宿主持有，缺省给 store 的 mobileTab） */
  readonly mobileTab: MobileTab;
  /** Tab 显示名（缺省中文；宿主可注入已本地化的标签） */
  readonly tabLabels?: Readonly<Record<MobileTab, string>>;
  /** 是否窄屏（显式传入优先；缺省走 matchMedia） */
  readonly narrow?: boolean;
  /** 窄屏 Tab 切换回调（受控变更入口） */
  readonly onMobileTabChange: (tab: MobileTab) => void;
  /** 顶部标题（可选；缺省不渲染标题行） */
  readonly screenTitle?: ReactNode;
  /** 顶部常驻附加区（如 ClockBadge；可选） */
  readonly headerExtra?: ReactNode;
  /** 顶部横幅（如隐私模式降级提示；可选，常驻叙事区之上） */
  readonly banner?: ReactNode;
  /** 抽屉层（设置/图鉴等 Drawer 挂载点；可选） */
  readonly drawer?: ReactNode;
}

/** Tab 缺省显示名（宿主未注入 tabLabels 时的回退） */
const DEFAULT_TAB_LABELS: Readonly<Record<MobileTab, string>> = {
  status: '状态',
  map: '地图',
  quest: '任务',
};

/** 三个移动端 Tab 的固定顺序（FR-UI-09：状态/地图/任务） */
const MOBILE_TABS: readonly MobileTab[] = ['status', 'map', 'quest'];

/**
 * 窄屏判定钩子（媒体查询订阅）。
 *
 * 仅在 SSR 安全与测试可控之间取折中：`matchMedia` 不可用（Node/测试桩）时
 * 返回 false（按宽屏渲染，宁可多显示不丢信息）。
 *
 * @param breakpoint 判定阈值（px；缺省 {@link NARROW_BREAKPOINT_PX}）
 */
export function useIsNarrow(breakpoint: number = NARROW_BREAKPOINT_PX): boolean {
  return useMediaQuery(`(max-width: ${breakpoint - 1}px)`);
}

/**
 * 通用媒体查询订阅（useSyncExternalStore；缺省快照 false）。
 * 抽为独立函数便于后续面板（如低性能模式探测）复用，避免各写一份订阅。
 */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
      }
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
      return window.matchMedia(query).matches;
    },
    () => false,
  );
}

/**
 * 移动端 Tab 切换条（FR-UI-09；触控目标 ≥ {@link TOUCH_TARGET_PX}）。
 *
 * 无障碍：容器 `role=tablist`、按钮 `role=tab` + `aria-selected`；
 * 受控组件——点击只回调，不自行改状态。
 */
export function MobileTabBar({
  active,
  labels,
  onSelect,
}: {
  readonly active: MobileTab;
  readonly labels: Readonly<Record<MobileTab, string>>;
  readonly onSelect: (tab: MobileTab) => void;
}): ReactNode {
  return (
    <div role="tablist" aria-label="侧栏面板" style={styles.tabList}>
      {MOBILE_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab)}
            style={{
              ...styles.tab,
              ...(selected ? styles.tabActive : {}),
            }}
          >
            {labels[tab]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 应用外壳（见模块 TSDoc）。根节点带 `data-narrow` 标记，样式可按布局档位分叉
 * （测试亦可据此断言布局状态，而不依赖计算样式）。
 */
export function AppShell(props: AppShellProps): ReactNode {
  const detected = useIsNarrow();
  const narrow = props.narrow ?? detected;
  const labels = props.tabLabels ?? DEFAULT_TAB_LABELS;

  const railContent = narrow ? (
    <>
      <MobileTabBar active={props.mobileTab} labels={labels} onSelect={props.onMobileTabChange} />
      <div style={styles.railBody}>
        {props.mobileTab === 'status' ? props.statusPanel : null}
        {props.mobileTab === 'map' ? props.mapPanel : null}
        {props.mobileTab === 'quest' ? props.questPanel : null}
      </div>
    </>
  ) : (
    <div style={styles.railBody}>
      {props.statusPanel}
      {props.mapPanel}
      {props.questPanel}
    </div>
  );

  return (
    <div style={styles.shell} data-narrow={narrow ? 'true' : 'false'}>
      {props.banner}
      {props.screenTitle !== undefined || props.headerExtra !== undefined ? (
        <header style={styles.header}>
          <div style={styles.title}>{props.screenTitle}</div>
          <div>{props.headerExtra}</div>
        </header>
      ) : null}
      <div style={narrow ? styles.columnsNarrow : styles.columnsWide}>
        <main style={styles.main}>
          {props.narrative}
          <div style={styles.options}>{props.options}</div>
        </main>
        <aside style={styles.rail} aria-label="侧栏">
          {railContent}
        </aside>
      </div>
      {props.drawer}
    </div>
  );
}

/**
 * 布局样式（内联：runtime-ui 尚未引入样式方案，主题化归 FR-XTRA-05 的
 * 后续里程碑；此处只锁定结构、断点与触控尺寸这些**契约性**视觉属性）。
 */
const styles: Record<string, CSSProperties> = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    minHeight: '100%',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  title: { fontSize: '18px', fontWeight: 600 },
  columnsWide: {
    display: 'grid',
    // 双栏：主文本区自适应 + 侧栏定宽（≥900px 档位，FR-UI-01）
    gridTemplateColumns: 'minmax(0, 1fr) 300px',
    gap: '20px',
    alignItems: 'start',
  },
  columnsNarrow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  main: { display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 },
  options: { display: 'flex', flexDirection: 'column', gap: '8px' },
  rail: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 },
  railBody: { display: 'flex', flexDirection: 'column', gap: '12px' },
  tabList: {
    display: 'flex',
    gap: '8px',
    // 窄屏 Tab 条：横向均分，触控目标高度由各 tab 的 minHeight 保证
    width: '100%',
  },
  tab: {
    flex: 1,
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '8px 12px',
    fontSize: '15px',
    cursor: 'pointer',
  },
  tabActive: { fontWeight: 600 },
};
