import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { parse } from 'yaml';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import type { GameDefinition } from '@game/engine';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import {
  AchievementGalleryPanel,
  AppShell,
  BattlePanel,
  HistoryPanel,
  ShopPanel,
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
  useKeyboardShortcuts,
  usePrefersReducedMotion,
  useReadingControl,
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

  // 阅读 QoL（FR-READ-01/02）：跳读 + 自动播放（遇选项/判定/战斗自动暂停）
  const reading = useReadingControl({
    phase,
    segmentKey: String(session.segments.length),
    onAdvance: () => host.advance(),
  });

  // 快捷键（FR-READ-06）：1-9 选项 / Space 推进 / H 历史 / S·L 快存读 / R 回退
  useKeyboardShortcuts({
    phase,
    choiceCount: session.choices.length,
    advance: () => host.advance(),
    choose: (index) => {
      const choice = session.choices[index];
      if (choice !== undefined) host.choose(choice.id);
    },
    toggleHistory: () =>
      host.store
        .getState()
        .openPanel(host.store.getState().panels.open === 'history' ? null : 'history'),
    rollback: () => host.rollback(),
  });

  return (
    <>
      <div style={styles.qolBar} data-qol-bar>
        <button type="button" onClick={() => reading.toggleSkip()} style={styles.qolButton}>
          {reading.skipEnabled ? '跳过：开' : '跳过：关'}
        </button>
        <button type="button" onClick={() => reading.toggleAuto()} style={styles.qolButton}>
          {reading.autoActive ? '自动：播放中' : reading.autoEnabled ? '自动：开' : '自动：关'}
        </button>
        <button type="button" onClick={() => host.rollback()} style={styles.qolButton}>
          回退一步
        </button>
        <button
          type="button"
          onClick={() =>
            host.store
              .getState()
              .openPanel(host.store.getState().panels.open === 'history' ? null : 'history')
          }
          style={styles.qolButton}
        >
          历史
        </button>
        <button
          type="button"
          onClick={() =>
            host.store
              .getState()
              .openPanel(
                host.store.getState().panels.open === 'achievements' ? null : 'achievements',
              )
          }
          style={styles.qolButton}
        >
          成就
        </button>
      </div>
      <OverlayPanels host={host} />
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
    </>
  );
}

/**
 * 叠加面板区（2026-09-25 接线）：商店 / 战斗 / 历史 / 成就图鉴。
 *
 * 为什么集中在宿主页：这四个面板由**事件驱动**（`shop_open` / `battle_start`）
 * 或**快捷键驱动**（H），宿主是唯一知道「现在该显示哪个」的地方。
 * 面板本身是受控组件（数据经 props 注入、交互经回调上抛）。
 */
function OverlayPanels({ host }: { host: GameHost }): ReactNode {
  // 会话修订订阅：面板数据随状态变化（交易后价格/库存、战斗后血量）
  useUiSelector((state) => state.session);
  const openPanel = useUiSelector((state) => state.panels.open);
  // 面板/战斗的可变状态由宿主持有（不在 store 里）：用本地计数器强制重读投影
  const [, setRevision] = useState(0);
  const forceRender = useCallback(() => setRevision((n) => n + 1), []);
  const shop = host.shopSession();
  const battle = host.battleSession();
  const nameOf = (key: string) => host.textOf(key);

  return (
    <div style={styles.overlay} data-overlay>
      {shop !== null ? (
        <ShopPanel
          session={shop}
          onBuy={(itemId) => {
            host.shopBuy(itemId, 1);
            forceRender();
          }}
          onSell={(itemId) => {
            host.shopSell(itemId, 1);
            forceRender();
          }}
          onClose={() => {
            host.closeShop();
            forceRender();
          }}
        />
      ) : null}
      {battle !== null ? (
        <BattlePanel
          phase={battle.phase}
          units={battle.units.map((unit) => ({
            uid: unit.uid,
            side: unit.side,
            name: nameOf(unit.nameKey),
            hp: unit.hp,
            maxHp: unit.maxHp,
            ...(unit.defending ? { defending: true } : {}),
          }))}
          log={battle.log}
          activeUid={battle.units.find((unit) => unit.side === 'player')?.uid}
          actions={battle.actions.map((action) => ({
            id: action.id,
            label: action.id === 'defend' ? '防御' : action.id === 'flee' ? '逃跑' : action.id,
            kind: action.kind,
            needsTarget: action.needsTarget,
          }))}
          onAction={(action) => {
            if (action.kind === 'defend' || action.kind === 'flee') {
              host.battleAct({ kind: action.kind });
            } else {
              // 技能：由 BattlePanel 的目标两步点选回调带 targetUid；此处无目标时
              // 选第一个存活敌人（演示够用；多敌人目标选择归 W6 完善）
              const target = battle.units.find((unit) => unit.side === 'enemy' && unit.hp > 0);
              host.battleAct({
                kind: 'skill',
                skillId: action.id,
                ...(target !== undefined ? { targetUid: target.uid } : {}),
              });
            }
            forceRender();
          }}
        />
      ) : null}
      {openPanel === 'history' ? (
        <HistoryPanel
          groups={host.history()}
          onRollback={(steps) => {
            host.rollback(steps);
            forceRender();
          }}
        />
      ) : null}
      {openPanel === 'achievements' ? (
        <AchievementGalleryPanel view={host.achievementGallery()} />
      ) : null}
    </div>
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
  // 开发者模式（FR-DEBG 的轻量入口）：`?dev=1` 时地图全量列出未解锁区域，
  // 供内容走查与调试。完整调试面板（变量改值/跳场景/时间快进）属 25 号 C 组。
  const developerMode = new URLSearchParams(window.location.search).get('dev') === '1';
  const host = createGameHost({
    definition,
    ...(attrDefs !== undefined ? { attrDefs } : {}),
    ...(contentTags !== undefined ? { contentTags } : {}),
    initialAttrs: { hp: 100, stamina: 30, insight: 0 },
    developerMode,
    seed: 2026,
  });
  createRoot(container).render(<App host={host} definition={definition} />);
  void PANEL_TITLES;
}

void mount();

/** demo 内联样式（最小展示；主题化归 FR-XTRA-05） */
const styles: Record<string, React.CSSProperties> = {
  qolBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '8px 12px',
    borderBottom: '1px solid rgba(128,128,128,0.25)',
    fontSize: '0.85em',
  },
  qolButton: {
    minHeight: '28px',
    padding: '0 10px',
    cursor: 'pointer',
  },
  overlay: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '0 12px 12px',
  },

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
