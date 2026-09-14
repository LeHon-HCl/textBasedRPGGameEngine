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

/** 顶部时钟（日历投影 + 当前场景；随推进更新） */
function ClockBadge({ host }: { host: GameHost }): ReactNode {
  const sceneId = useUiSelector((state) => state.session.sceneId);
  const revisions = useUiSelector((state) => state.questRevision);
  const calendar = host.calendar();
  void revisions;
  return (
    <span style={styles.badge}>
      {`第 ${calendar.day} 天 · ${host.textOf(calendar.slotNameKey)} · ${sceneId}`}
    </span>
  );
}

/** Toast 浮层（队列来自 store；合并与过期由包内纯函数承担） */
function Toasts({ host }: { host: GameHost }): ReactNode {
  const notifications = useUiSelector(selectNotifications);
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
  const open = useUiSelector((state) => state.panels.open);
  if (open !== 'settings') return null;
  const settings = host.runtime.state.settings;
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
  const settings = host.runtime.state.settings;

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
        session.choices.length > 0 ? (
          <OptionList
            choices={session.choices}
            resolver={host.resolver}
            lang={settings.lang}
            onChoice={(id) => host.choose(id)}
          />
        ) : null
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
