import type { Manifest, TextKey } from '@game/shared';

/**
 * 首启内容向导数据投影（设计 §5.8 / §6.5，FR-CGRD-04；22 号模块）。
 *
 * 引擎只提供**数据**，不承载向导 UI 流程（§5.8「首次启动向导是 UI 流程」）：
 * 宿主以 `settings.wizardDone` 判断是否需要展示，并在需要时用
 * {@link resolveContentWizard} 一次取得内容警告页文案键。文案本体由游戏包
 * 语言包提供（键引用，D4），引擎不解释其内容。
 */

/** 首启向导所需的引擎侧数据（宿主 UI 的只读投影） */
export interface ContentWizardInfo {
  /** 是否应展示向导（`settings.wizardDone` 求反；已完成的档不再展示） */
  readonly needed: boolean;
  /** 内容警告页文案键（`manifest.contentWarning`；游戏未声明 = null，不展示警告页） */
  readonly warningKey: TextKey | null;
}

/**
 * 读取内容警告页文案键（FR-CGRD-04；§6.5）。
 *
 * 读取路径：`GameDefinition.manifest.contentWarning` → 本函数 → 宿主交给
 * TextResolver 物化。`contentWarning` 为可选字段（shared manifestSchema），
 * 缺省时返回 null，宿主据此跳过警告页。
 *
 * @param manifest 游戏清单（`GameDefinition.manifest` 直接可用）
 */
export function contentWarningKey(manifest: Pick<Manifest, 'contentWarning'>): TextKey | null {
  return manifest.contentWarning ?? null;
}

/**
 * 组合首启向导数据（FR-CGRD-04）：由玩家设置与游戏清单投影出「是否展示 +
 * 警告文案键」的宿主可用值。纯函数，不读写状态、无副作用。
 *
 * @param settings 玩家设置切片（`GameState.settings.wizardDone`）
 * @param manifest 游戏清单（`GameDefinition.manifest`）
 */
export function resolveContentWizard(
  settings: { readonly wizardDone: boolean },
  manifest: Pick<Manifest, 'contentWarning'>,
): ContentWizardInfo {
  return { needed: !settings.wizardDone, warningKey: contentWarningKey(manifest) };
}
