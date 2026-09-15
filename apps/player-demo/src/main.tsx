import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { parse } from 'yaml';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import type { AttrDefs, ContentTagsDef, GameDefinition } from '@game/shared';
import {
  AppShell,
  ContentWizard,
  createGameHost,
  DEFAULT_SHORTCUT_HINTS,
  expireToasts,
  MapPanel,
  NarrativeView,
  OptionList,
  PrivacyBanner,
  QuestLogPanel,
  selectMobileTab,
  selectNotifications,
  selectPhase,
  selectSession,
  selectStatHighlights,
  SettingsPanel,
  StatusPanel,
  ToastStack,
  UiStoreProvider,
  usePrefersReducedMotion,
  useUiSelector,
} from '@game/runtime-ui';
import type { GameHost, PanelId } from '@game/runtime-ui';

/**
 * player-demo —— runtime-ui 宿主页（25 号 A 组的浏览器验收载体）。
 *
 * A 组之前本页是 vanilla DOM 手写渲染（M0 接线参考）；现在页面只做三件事：
 * 1. 经 Vite `import.meta.glob(?raw)` 把 fixtures/mini-game 读为内存文件表；
 * 2. 装配 `createGameHost`（游戏宿主在包内，可单测）+ 注入 attrs/contentTags
 *    （这两个域不在 GameDefinition 的发布面上——06 号导出面缺口，见宿主 TSDoc）；
 * 3. 挂 React 根并组装组件树——所有渲染与交互逻辑都在 runtime-ui 包内。
 */

/** 夹具路径前缀（Vite glob 的解析基准） */
const PACKAGE_PREFIX = 'fixtures/mini-game/';

/** 读夹具包为内存文件表（键 = 包内相对路径） */
function readFixturePackage(): Record<string, string> {
  const rawModules = import.meta.glob('../../../fixtures/mini-game/**/*', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(rawModules)) {
    const index = path.indexOf(PACKAGE_PREFIX);
    if (index === -1) continue;
    files[path.slice(index + PACKAGE_PREFIX.length)] = content;
  }
  return files;
}

/** 面板打开时右栏/Drawer 的呈现面（demo 留作可选扩展点） */
const PANEL_TITLES: Record<PanelId, string> = {
  status: '状态',
  map: '地图',
  quest: '任务',
  settings: '设置',
  gallery: '图鉴',
  achievements: '成就',
  debug: '调试',
};

/**
 * 打字机驱动：按速度逐字推进（组件层只做展示，进度归宿主）。
 * 减弱动画或速度 ≤0 时立即全显（NFR-26 / FR-READ-05）。
 */
function useRevealedChars(text: string, speed: number, active: boolean): number {
  const reduced = usePrefersReducedMotion();
  const total = text.length;
  const [revealed, setRevealed] = useState(total);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!active || reduced || speed <= 0 || total === 0) {
      setRevealed(total);
      return undefined;
    }
    setRevealed(0);
    const interval = Math.max(8, Math.round(40 / speed));
    timerRef.current = window.setInterval(() => {
      setRevealed((current) => {
        if (current + 1 >= total) {
          if (timerRef.current !== undefined) window.clearInterval(timerRef.current);
          return total;
        }
        return current + 1;
      });
    }, interval);
    return () => {
      if (timerRef.current !== undefined) window.clearInterval(timerRef.current);
    };
  }, [text, speed, active, reduced, total]);

  return revealed;
}

/** 顶部时钟（日历投影；随推进更新） */
function ClockBadge({ host }: { host: GameHost }): ReactNode {
  // 只显示玩家可见的日历信息。**不显示 sceneId**：那是调试信息，
  // 2026-09-15 用户实测发现它泄漏在徽标里（如「第 1 天 · 傍晚 · ev_market_gossip_scene」）。
  // 场景 id 属开发者视角，需要时归调试面板（FR-DEBG）。
  const calendar = host.calendar();
  return (
    <span
      style={styles.badge}
    >{`第 ${calendar.day} 天 · ${host.textOf(calendar.slotNameKey)}`}</span>
  );
}

/**
 * 错误卡片（FR-DEBG-07：错误显性化，允许继续/回退）。
 *
 * 为什么 demo 必须有：宿主把引擎错误捕获进 `lastError`（不抛给 React），
 * 但**界面上没有呈现点**时玩家只看到「点了没反应 / 选项消失」——2026-09-15
 * 用户实测的「卡死」正是这样被误解的。此处把 code/detail 显性化，并提供
 * 「回退一步」入口（宿主 rollback 已按 §6.3 rollback + 重建 session）。
 */
function ErrorCard({ host }: { host: GameHost }): ReactNode {
  // 订阅会话修订以在每次状态推进后重读 lastError（lastError 不是 store 切片）
  useUiSelector((state) => state.questRevision);
  useUiSelector((state) => state.session);
  const error = host.lastError();
  if (error === null) return null;
  // 文案与 demo 其余 UI（「新游戏」「设置」「关闭」）同口径：demo 自持的中文硬编码。
  // 游戏包内的错误 messageKey（ui.error.*）本就不属游戏词典，全量 UI i18n 归 25 号 C 组。
  return (
    <div role="alert" data-error-card style={styles.errorCard}>
      <div style={styles.errorTitle}>操作失败</div>
      <div style={styles.errorDetail}>{`[${error.code}] ${error.detail}`}</div>
      <button type="button" onClick={() => host.rollback()} style={styles.errorButton}>
        回退一步
      </button>
    </div>
  );
}

/** Toast 浮层（队列来自 store；合并与过期由包内纯函数承担） */
function Toasts({ host }: { host: GameHost }): ReactNode {
  const notifications = useUiSelector(selectNotifications);
  // 自动消失（FR-UI-07）：`expireToasts` 是纯函数、定时器归宿主（toast.ts TSDoc）
  // ——2026-09-15 用户实测「提示不自己消失」的根因即宿主从未接过期定时器。
  // 每 500ms 清理超期条目（TTL 4s）；队列为空时不触发状态写入（无谓重渲染）。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const state = host.store.getState();
      const next = expireToasts(state.notifications, Date.now());
      if (next !== state.notifications) {
        host.store.setState({ notifications: next });
      }
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [host]);
  return (
    <ToastStack
      items={notifications}
      nameOf={(key, vars) => host.textOf(key, vars)}
      onDismiss={(id) => host.store.getState().dismissNotification(id)}
    />
  );
}

/** 设置抽屉（受控表单：回写运行时状态设置 + 重建内容过滤由宿主负责） */
function SettingsDrawer({ host }: { host: GameHost }): ReactNode {
  // Hooks 必须**无条件**调用（Rules of Hooks）：提前 return 会让「关闭 → 打开」
  // 两次渲染的 hook 数量不同，React 抛 "Rendered more hooks than during the
  // previous render" 并整树白屏（M1 收尾 E2E 实测暴露）。故先取全部 hook，
  // 再把开关判断放到 hook 之后。
  const open = useUiSelector((state) => state.panels.open);
  // 设置来自 store（受控回流；开局前也可读写，主菜单即可改语言）
  const settings = useUiSelector((state) => state.settings);
  if (open !== 'settings') return null;
  const tags = host.wizardTags();
  return (
    <div style={styles.drawer}>
      <button
        type="button"
        onClick={() => host.store.getState().openPanel(null)}
        style={styles.close}
      >
        关闭
      </button>
      <SettingsPanel
        settings={settings}
        langs={host.langs()}
        tags={[...tags]}
        versions={host.versions()}
        shortcuts={DEFAULT_SHORTCUT_HINTS}
        nameOf={(key) => host.textOf(key)}
        onChange={(partial) => host.updateSettings(partial)}
      />
    </div>
  );
}

/** 游戏屏：叙事区 + 选项 + 侧栏三面板（全部受控） */
function GameScreen({ host }: { host: GameHost }): ReactNode {
  const session = useUiSelector(selectSession);
  const phase = useUiSelector(selectPhase);
  const highlights = useUiSelector(selectStatHighlights);
  const mobileTab = useUiSelector(selectMobileTab);
  // 设置单一来源：store.settings（宿主 updateSettings 写入 store，受控组件回流）。
  // 不读 host.runtime.state.settings（开局快照，改设置后是旧值）。
  const settings = useUiSelector((state) => state.settings);

  const lastTextSegment = [...session.segments]
    .reverse()
    .find((segment) => segment.kind === 'text' && segment.key !== undefined);
  const lastText =
    lastTextSegment?.key !== undefined
      ? host.resolver.resolve(lastTextSegment.key, settings.lang, lastTextSegment.vars).text
      : '';
  const revealed = useRevealedChars(lastText, settings.textSpeed, phase === 'await_advance');

  return (
    <AppShell
      screenTitle="旧镇迷雾 · mini-game"
      headerExtra={<ClockBadge host={host} />}
      narrative={
        <NarrativeView
          segments={session.segments}
          resolver={host.resolver}
          lang={settings.lang}
          textSpeed={settings.textSpeed}
          revealed={revealed}
          {...(phase !== undefined ? { phase } : {})}
          {...(session.endReason !== undefined ? { endReason: session.endReason } : {})}
          {...(session.endingId !== undefined ? { endingId: session.endingId } : {})}
          fontSize={settings.fontSize}
          lineHeight={settings.lineHeight}
          onAdvance={() => host.advance()}
        />
      }
      options={
        <>
          <ErrorCard host={host} />
          {session.choices.length > 0 ? (
            <OptionList
              choices={session.choices}
              resolver={host.resolver}
              lang={settings.lang}
              onChoice={(id) => host.choose(id)}
            />
          ) : null}
        </>
      }
      statusPanel={
        <StatusPanel
          view={host.statusPanel()}
          nameOf={(key) => host.textOf(key)}
          highlights={highlights}
          now={() => Date.now()}
          onHighlightSeen={({ attr }) => host.store.getState().clearStatHighlights([attr])}
        />
      }
      mapPanel={
        <MapPanel
          areas={host.areas()}
          current={host.location()}
          nameOf={(key) => host.textOf(key)}
          onMove={(target) => host.moveTo({ area: target.area, location: target.location })}
        />
      }
      questPanel={
        <QuestLogPanel view={host.questLog()} nameOf={(key) => host.textOf(key)} tracked={[]} />
      }
      mobileTab={mobileTab}
      onMobileTabChange={(tab) => host.store.getState().setMobileTab(tab)}
      drawer={<Toasts host={host} />}
    />
  );
}

/** 主菜单入口（demo 简化形态；完整六项主菜单在 runtime-ui 的 TitleScreen） */
function TitleEntry({ host }: { host: GameHost }): ReactNode {
  const [started, setStarted] = useState(false);
  const reduced = usePrefersReducedMotion();
  const start = useCallback(() => {
    host.start();
    setStarted(true);
  }, [host]);

  if (started) return <GameScreen host={host} />;
  return (
    <div style={styles.titleRoot}>
      <h1 style={styles.title}>旧镇迷雾 · mini-game</h1>
      <p style={styles.subtitle}>
        {`runtime-ui 宿主演示（${reduced ? '已按系统设置减弱动画' : '动画开启'}）`}
      </p>
      <button type="button" onClick={start} style={styles.startButton}>
        新游戏
      </button>
      <button
        type="button"
        onClick={() => host.store.getState().openPanel('settings')}
        style={styles.startButton}
      >
        设置
      </button>
    </div>
  );
}

/** 应用根：首启内容向导 → 主菜单/游戏屏 + 设置抽屉 */
function App({ host, definition }: { host: GameHost; definition: GameDefinition }): ReactNode {
  const [wizardDone, setWizardDone] = useState(false);
  const tags = host.wizardTags();
  const wizardNeeded = tags.length > 0 && !wizardDone;

  return (
    <UiStoreProvider store={host.store}>
      {wizardNeeded ? (
        <ContentWizard
          warningKey={definition.manifest.contentWarning ?? null}
          tags={[...tags]}
          initialDisabledTags={tags.filter((tag) => !tag.defaultOn).map((tag) => tag.id)}
          nameOf={(key) => host.textOf(key)}
          onConfirm={({ disabledTags }) => {
            host.setDisabledTags(disabledTags);
            setWizardDone(true);
          }}
          onSkip={({ disabledTags }) => {
            host.setDisabledTags(disabledTags);
            setWizardDone(true);
          }}
        />
      ) : (
        <TitleEntry host={host} />
      )}
      <SettingsDrawer host={host} />
      {/* 隐私模式降级横幅：真实探测在下方 mount（Dexie 可用性） */}
      <PrivacyBanner degraded={false} />
    </UiStoreProvider>
  );
}

/** 挂载入口（异步装配：读包 → 建宿主 → 渲染） */
async function mount(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#app');
  if (container === null) {
    throw new Error('#app 容器缺失（index.html 与入口脚本不匹配）');
  }
  const files = readFixturePackage();
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] ?? '') as AttrDefs | undefined;
  const contentTags = parse(files['data/content-tags.yaml'] ?? '') as ContentTagsDef | undefined;
  const host = createGameHost({
    definition,
    ...(attrDefs !== undefined ? { attrDefs } : {}),
    ...(contentTags !== undefined ? { contentTags } : {}),
    initialAttrs: { hp: 100, stamina: 30, insight: 0 },
    seed: 2026,
  });
  createRoot(container).render(<App host={host} definition={definition} />);
  void PANEL_TITLES;
}

void mount();

/** demo 内联样式（最小展示；主题化归 FR-XTRA-05） */
const styles: Record<string, React.CSSProperties> = {
  badge: { fontSize: '13px', opacity: 0.8 },
  drawer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 'min(420px, 92vw)',
    overflowY: 'auto',
    padding: '16px',
    background: 'Canvas',
    borderLeft: '1px solid rgba(127,127,127,0.35)',
    zIndex: 900,
  },
  close: { minHeight: '32px', marginBottom: '8px', cursor: 'pointer' },
  errorCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    border: '1px solid rgba(180,60,60,0.5)',
    background: 'rgba(180,60,60,0.08)',
    borderRadius: '4px',
    fontSize: '13px',
  },
  errorTitle: { fontWeight: 600 },
  errorDetail: { opacity: 0.85, wordBreak: 'break-word' },
  errorButton: {
    alignSelf: 'flex-start',
    minHeight: '32px',
    padding: '4px 12px',
    cursor: 'pointer',
  },
  titleRoot: { padding: '48px 20px', textAlign: 'center' },
  title: { margin: '0 0 8px' },
  subtitle: { opacity: 0.75, marginBottom: '24px' },
  startButton: {
    display: 'block',
    margin: '8px auto',
    minHeight: '44px',
    padding: '10px 24px',
    fontSize: '15px',
    cursor: 'pointer',
  },
};
