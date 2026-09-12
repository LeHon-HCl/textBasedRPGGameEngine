import {
  GameRuntime,
  InMemoryPackageSource,
  SceneRunner,
  createTextResolver,
  loadGamePackage,
  newGameState,
} from '@game/engine';
import type { ChoiceView, GameDefinition, RenderSegment, TextResolver } from '@game/engine';
import { createRng, isEngineError } from '@game/shared';

/**
 * player-demo —— M0 里程碑验收配套的最小可玩页（vanilla TS + 简单 DOM）。
 *
 * 接线链路（设计 §3.4 / §3.1 / §4.1 / §4.2 的端到端串通）：
 * 1. Vite `import.meta.glob(?raw)` 把 fixtures/mini-game 全文件读为字符串；
 * 2. InMemoryPackageSource（engine 导出的 source-memory）承载包源；
 * 3. loadGamePackage 走七步加载管线产出 GameDefinition（含冻结效果注册表）；
 * 4. newGameState + GameRuntime（注入 def.effectRegistry）= 状态事务核心；
 * 5. SceneRunner 驱动场景会话（renderList / choices / advance / choose）；
 * 6. TextResolver 物化文本键（主语言 + 插值 vars）。
 *
 * 交互：点击「继续」推进段落；点击选项 = checkpoint（FR-READ-03）+ choose；
 * 会话终局后可重新开始（保留 seen/flags —— first/again、一次性选项语义可试）。
 * 仅演示用途：M0 验收由浏览器人工执行，不写自动化测试。
 */

// ---- 包源装配（fixtures/mini-game → 内存文件表） ------------------------------

const PACKAGE_PREFIX = 'fixtures/mini-game/';

const rawModules = import.meta.glob('../../../fixtures/mini-game/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const packageFiles: Record<string, string> = {};
for (const [path, content] of Object.entries(rawModules)) {
  const index = path.indexOf(PACKAGE_PREFIX);
  if (index === -1) continue;
  packageFiles[path.slice(index + PACKAGE_PREFIX.length)] = content;
}

// ---- 引擎装配 ----------------------------------------------------------------

const definition: GameDefinition = await loadGamePackage(new InMemoryPackageSource(packageFiles));

/** mini-game attrs.yaml 的 init 值投影（M0 demo 固化；定义投影归后续模块） */
const MINI_GAME_INITIAL_ATTRS = { hp: 100, stamina: 30, insight: 0 };

/** 固定种子（DD-09 注入式随机源；演示可复现） */
const DEMO_SEED = 2026;

const rng = createRng(DEMO_SEED);
const runtime = new GameRuntime({
  state: newGameState(
    {
      versions: {
        gameVersion: definition.manifest.gameVersion,
        schemaVersion: definition.manifest.schemaVersion,
        minEngineVersion: definition.manifest.minEngineVersion,
      },
      attrs: { ...MINI_GAME_INITIAL_ATTRS },
    },
    rng,
  ),
  rng,
  effectExecutor: definition.effectRegistry,
  functionRegistry: definition.functionRegistry,
});

const resolver: TextResolver = createTextResolver({
  mainLang: definition.manifest.mainLang,
  locales: definition.locales,
  functionRegistry: definition.functionRegistry,
});

const LANG = definition.manifest.mainLang;

function materialize(key: string, vars?: Record<string, unknown>): string {
  return resolver.resolve(key, LANG, vars ?? {}).text;
}

// ---- 会话状态 ----------------------------------------------------------------

let session: SceneRunner | undefined;
let errorMessage: string | undefined;

function startSession(sceneId: string): void {
  session = new SceneRunner(runtime, { def: definition, sceneId });
  errorMessage = undefined;
  render();
}

// ---- DOM 渲染 ----------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>('#app');

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #14161c; color: #d8d5cc; font-family: "Noto Serif SC", serif; }
  #app { max-width: 720px; margin: 0 auto; padding: 24px 20px 48px; }
  .badge { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #8b8878;
           border-bottom: 1px solid #2a2d36; padding-bottom: 10px; margin-bottom: 18px;
           font-family: ui-monospace, monospace; }
  .scene { line-height: 1.9; font-size: 17px; min-height: 160px; white-space: pre-wrap; }
  .scene p.text { margin: 0 0 0.9em; }
  .scene .spacing { height: 0.6em; }
  .scene .media { color: #6b7f8f; font-size: 13px; font-style: italic; margin-bottom: 1em; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }
  button { padding: 10px 16px; font-size: 15px; text-align: left; cursor: pointer;
           background: #22252e; color: #d8d5cc; border: 1px solid #383c48; border-radius: 6px; }
  button:hover:not(:disabled) { background: #2c303b; border-color: #4a4f5e; }
  button:disabled { cursor: not-allowed; color: #6a675c; }
  button .reason { display: block; font-size: 12px; color: #8d6b5d; margin-top: 2px; }
  .end { color: #a8b58a; font-style: italic; margin-top: 16px; }
  .error { color: #d98a7a; border: 1px solid #5a3830; background: #241a18;
           border-radius: 6px; padding: 10px 14px; margin-top: 18px; font-size: 14px; }
  h1 { font-size: 18px; font-weight: 600; color: #c2bfae; margin: 0 0 4px; }
`;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function actionButton(label: string, onClick: () => void, disabled?: string): HTMLButtonElement {
  const button = element('button', undefined, label);
  if (disabled !== undefined) {
    button.disabled = true;
    const reason = element('span', 'reason', disabled);
    button.appendChild(reason);
  } else {
    button.addEventListener('click', onClick);
  }
  return button;
}

/** 段落流 → DOM（文本经 TextResolver 物化；spacing/媒体按 RenderSegment 形态呈现） */
function renderSegments(segments: readonly RenderSegment[]): HTMLDivElement {
  const container = element('div', 'scene');
  for (const segment of segments) {
    if (segment.kind === 'spacing') {
      container.appendChild(element('div', 'spacing'));
      continue;
    }
    if (segment.kind === 'image') {
      for (const intent of segment.media ?? []) {
        container.appendChild(element('div', 'media', `[媒体 ${intent.type}: ${intent.assetId}]`));
      }
      continue;
    }
    const paragraph = element('p', 'text', materialize(segment.key ?? '', segment.vars));
    container.appendChild(paragraph);
  }
  return container;
}

function renderChoices(views: readonly ChoiceView[]): HTMLElement {
  const actions = element('div', 'actions');
  for (const view of views) {
    if (view.hiddenByFilter === true) continue; // 被过滤选项不渲染
    const label = materialize(view.textKey);
    actions.appendChild(
      actionButton(
        label,
        () => choose(view.id),
        view.enabled ? undefined : materialize(view.disabledReasonKey ?? '', {}),
      ),
    );
  }
  return actions;
}

function render(): void {
  if (!app || !session) return;
  app.replaceChildren();
  document.getElementById('demo-style')?.remove();
  const style = document.createElement('style');
  style.id = 'demo-style';
  style.textContent = STYLE;
  document.head.appendChild(style);

  app.appendChild(element('h1', undefined, '旧镇迷雾 · mini-game（M0 试玩）'));

  // 徽标信息：当前场景 ID + 时钟投影（ClockBadge 级别）
  const clock = runtime.state.world.time;
  const badge = element(
    'div',
    'badge',
    `场景: ${session.currentSceneId}    ·    第 ${clock.day} 天 · 时段 ${clock.slotIndex}`,
  );
  app.appendChild(badge);

  app.appendChild(renderSegments(session.renderList()));

  if (errorMessage !== undefined) {
    app.appendChild(element('div', 'error', errorMessage));
  }

  const actions = element('div', 'actions');
  if (session.phase === 'await_advance') {
    actions.appendChild(actionButton('继续 ▾', () => safe(() => session.advance())));
  } else if (session.phase === 'await_choice') {
    actions.appendChild(renderChoices(session.choices()));
  } else if (session.phase === 'finished') {
    app.appendChild(element('div', 'end', describeEnd(session.endReason, session.endingId)));
    actions.appendChild(
      actionButton('重新开始（保留 seen / flags）', () =>
        startSession(definition.manifest.entryScene),
      ),
    );
  }
  app.appendChild(actions);
}

function describeEnd(reason: SceneRunner['endReason'], endingId: string | undefined): string {
  switch (reason) {
    case 'ending':
      return `— 结局：${endingId} —`;
    case 'back':
      return '— 会话返回上层结束 —';
    case 'loop':
      return '— 周目转换（19 号推进面）—';
    default:
      return '— 本段旅程到此为止 —';
  }
}

// ---- 交互 ----------------------------------------------------------------

/** 选项点击 = checkpoint（FR-READ-03）+ choose + 重渲染 */
function choose(choiceId: string): void {
  safe(() => {
    runtime.checkpoint(`choice:${session?.currentSceneId}:${choiceId}`);
    session?.choose(choiceId);
  });
}

/** 引擎错误 → 错误卡片（code/where 摘要；NFR-23 诊断三元组演示） */
function safe(action: () => void): void {
  try {
    action();
    errorMessage = undefined;
  } catch (error) {
    if (isEngineError(error)) {
      const where = Object.entries(error.where)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
      errorMessage = `[${error.code}] ${error.messageKey}${where === '' ? '' : ` (${where})`}`;
    } else {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }
  render();
}

startSession(definition.manifest.entryScene);
