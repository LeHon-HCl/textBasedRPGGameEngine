/**
 * 夹具结构检查辅助（fixtures/helpers，零依赖纯函数）。
 *
 * 作用域：在 02 号模块的 Zod schema 校验落地之前，为 fixtures/ 下的正例与
 * 负例夹具提供轻量结构断言。输入一律是「已解析的 YAML 数据」，文件读取与
 * 解析由测试负责（yaml 解析器仅作为 fixtures/helpers 的 devDependency 存在，
 * 不进入运行时依赖）。02/06 号模块的正式校验（schema + 诊断编码，设计 §2.4、
 * §3.4）落地后，以 engine/shared 的实现为准，本文件仅服务夹具自身的回归。
 */

/** 场景文件的轻量结构视图（SceneDef 检测面，设计 §2.4 / DD-02） */
export interface SceneSummary {
  id: string;
  area: string;
  /** 全部 choice.goto 跳转目标 */
  jumps: string[];
  /** 全部引用的文本键（段落 key 与选项 textKey） */
  textKeys: string[];
  /** 全部条件表达式原文（showIf） */
  exprs: string[];
}

/** 路径到场景 ID 的登记项，供跨文件重复检测 */
export interface SceneFileEntry {
  path: string;
  sceneId: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** 从已解析的场景数据提取检测面；id/area 缺失时以空串表达，由断言侧判定 */
export function summarizeScene(data: unknown): SceneSummary {
  const rec = isRecord(data) ? data : {};
  const segments = Array.isArray(rec['segments']) ? rec['segments'] : [];
  const choices = Array.isArray(rec['choices']) ? rec['choices'] : [];

  const jumps: string[] = [];
  const textKeys: string[] = [];
  const exprs: string[] = [];

  for (const seg of segments) {
    if (!isRecord(seg)) continue;
    const key = asString(seg['key']);
    if (key) textKeys.push(key);
    const showIf = asString(seg['showIf']);
    if (showIf) exprs.push(showIf);
  }
  for (const choice of choices) {
    if (!isRecord(choice)) continue;
    const textKey = asString(choice['textKey']);
    if (textKey) textKeys.push(textKey);
    const goto = asString(choice['goto']);
    if (goto) jumps.push(goto);
    const showIf = asString(choice['showIf']);
    if (showIf) exprs.push(showIf);
  }
  return { id: asString(rec['id']) ?? '', area: asString(rec['area']) ?? '', jumps, textKeys, exprs };
}

/** 跨文件重复场景 ID 检测（负例 dup-id 的检测面，对应诊断 DUP_ID） */
export function findDuplicateSceneIds(entries: readonly SceneFileEntry[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  for (const entry of entries) {
    const paths = seen.get(entry.sceneId) ?? [];
    paths.push(entry.path);
    seen.set(entry.sceneId, paths);
  }
  return new Map([...seen].filter(([, paths]) => paths.length > 1));
}

/** 悬空跳转检测（负例 dangling-ref 的检测面，对应诊断 DANGLING_REF） */
export function findDanglingJumps(
  sceneIds: ReadonlySet<string>,
  scenes: readonly SceneSummary[],
): Array<{ sceneId: string; target: string }> {
  const dangling: Array<{ sceneId: string; target: string }> = [];
  for (const scene of scenes) {
    for (const target of scene.jumps) {
      if (!sceneIds.has(target)) dangling.push({ sceneId: scene.id, target });
    }
  }
  return dangling;
}

/** 缺失文本键检测（词典覆盖检查，对应 FR-L10N-02 命名空间镜像） */
export function findMissingTextKeys(
  knownKeys: ReadonlySet<string>,
  scenes: readonly SceneSummary[],
): string[] {
  const missing = new Set<string>();
  for (const scene of scenes) {
    for (const key of scene.textKeys) {
      if (!knownKeys.has(key)) missing.add(key);
    }
  }
  return [...missing].sort();
}

/**
 * 括号配平检查：表达式词法级 sanity check（引号内的括号不计数）。
 * 完整语法校验归 02 号模块的表达式编译器（DD-01），此处只让
 * bad-expr 负例可被机械化识别。
 */
export function hasBalancedParens(expr: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (const ch of expr) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * 从词典文件构造文本键集合（命名空间目录镜像，FR-L10N-02）：
 * 路径 locales/<lang>/scenes/arrival.yaml 中的键 x.y → 'scenes.arrival.x.y'。
 */
export function collectLocaleKeys(
  localeFiles: readonly { path: string; data: unknown }[],
): Set<string> {
  const keys = new Set<string>();
  for (const file of localeFiles) {
    const normalized = file.path.replaceAll('\\', '/');
    const underLang = normalized.replace(/^.*?locales\/[^/]+\//, '');
    const namespace = underLang
      .replace(/\.ya?ml$/i, '')
      .split('/')
      .filter((part) => part.length > 0)
      .join('.');
    const walk = (node: unknown, prefix: string): void => {
      if (!isRecord(node)) return;
      for (const [key, value] of Object.entries(node)) {
        const full = prefix.length > 0 ? `${prefix}.${key}` : key;
        if (isRecord(value)) walk(value, full);
        else keys.add(full);
      }
    };
    walk(file.data, namespace);
  }
  return keys;
}

/** attrs.yaml numeric 域中已声明的属性名（供表达式引用前提检查） */
export function declaredNumericAttrs(attrsData: unknown): string[] {
  const rec = isRecord(attrsData) ? attrsData : {};
  const numeric = isRecord(rec['numeric']) ? rec['numeric'] : {};
  return Object.keys(numeric);
}
