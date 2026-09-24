import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { EngineError, createRng } from '@game/shared';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { createScriptHost } from '../../src/scripts/host.js';

/**
 * 架构断言（23 号子任务 6；NFR-19/20 + OQ-11 最小面）：
 *
 * 1. **运行期无 eval / 动态加载**：engine 源码不得出现 eval/new Function/
 *    动态 import()/require（表达式走 AST 解释，脚本走宿主注入的模块实例）；
 * 2. **脚本能力面收窄**：engine 源码不得出现网络/定时器/文件 API
 *    （OQ-11：网络/文件/定时器不开放）；
 * 3. **draft 不外泄**：`ScriptHost.transaction` 是脚本唯一状态入口——
 *    ScriptSetupApi/HookHandler 的类型面不暴露 GameState/draft
 *    （类型层断言 + 行为层断言）。
 *
 * 为什么用「源码扫描测试」而非只靠 lint：lint 规则是配置层的（可能被改），
 * 本测试是**行为层**的（CI 必跑、改动可见），两重保障。
 */

const SRC_ROOT = 'packages/engine/src';

/** 递归收集 engine 源码文件（排除 node_modules 与 dist） */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const path = `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`;
    if (path.includes('/node_modules/') || path.includes('/dist/')) continue;
    out.push(path);
  }
  return out;
}

const SOURCES = collectSources(SRC_ROOT);

/** 去注释后的可执行代码（行内 // 注释与块注释整行） */
function codeOfLine(line: string): string {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

describe('23-A2 架构断言：运行期无 eval / 动态加载（NFR-19）', () => {
  it('engine 源码无 eval / new Function / 动态 import / require', () => {
    const violations: string[] = [];
    for (const file of SOURCES) {
      const content = readFileSync(file, 'utf8');
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        const code = codeOfLine(line);
        // eval 全局函数：排除两类非调用形态——
        // ① 成员访问（obj.eval(...)）；② 接口/类的方法声明（`eval(x: T): R;`
        //    特征为括号后带返回类型标注 `): `）；
        // 真正的 JS eval 调用形如 `eval(x)`，括号后紧跟 `;`/`)`/运算符。
        const withoutMemberEval = code.replace(/[.\w]eval\s*\(/g, '');
        const isMethodDeclaration = /^\s*(readonly\s+)?eval\s*\([^)]*\)\s*:/.test(code);
        if (
          (!isMethodDeclaration && /\beval\s*\(/.test(withoutMemberEval)) ||
          /new\s+Function\s*\(/.test(code)
        ) {
          violations.push(`${file}:${index + 1}`);
        }
        // 动态 import()：排除 TS 类型层的类型引用 `import('...')`（静态类型语
        // 法，编译后消失）；动态加载是运行期取值，形态为 import(变量/表达式)
        const withoutTypeImports = code.replace(/import\s*\(\s*['"][^'"]+['"]\s*\)/g, '');
        if (/\bimport\s*\(/.test(withoutTypeImports) || /\brequire\s*\(/.test(withoutTypeImports)) {
          violations.push(`${file}:${index + 1}`);
        }
      }
    }
    expect(violations, `出现动态执行入口：${violations.join(', ')}`).toEqual([]);
  });
});

describe('23-A2 架构断言：脚本能力面最小化（OQ-11）', () => {
  it('engine 源码无网络 / 定时器 / 文件 API', () => {
    const forbidden: readonly RegExp[] = [
      /\bfetch\s*\(/,
      /\bnew\s+XMLHttpRequest\b/,
      /\bnew\s+WebSocket\b/,
      /\bsetTimeout\s*\(/,
      /\bsetInterval\s*\(/,
      /\bqueueMicrotask\s*\(/,
      /\bprocess\./,
    ];
    const violations: string[] = [];
    for (const file of SOURCES) {
      const content = readFileSync(file, 'utf8');
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        const code = codeOfLine(line);
        for (const pattern of forbidden) {
          if (pattern.test(code)) violations.push(`${file}:${index + 1} (${String(pattern)})`);
        }
      }
    }
    expect(
      violations,
      `脚本能力面违规（网络/定时器/文件不开放）：${violations.join(', ')}`,
    ).toEqual([]);
  });
});

describe('23-A2 架构断言：draft 不外泄（脚本唯一状态入口是 transaction）', () => {
  it('行为层：脚本只能经 transaction 改状态，返回面只有 events/patches', () => {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30, insight: 0 },
      },
      createRng(1),
    );
    const runtime = new GameRuntime({
      state,
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry(),
    });
    const host = createScriptHost({ runtime });

    // 返回面只有 events/patches——不含 state/draft/jumps
    const result = host.transaction([{ set: { key: 'attr.insight', value: 3 } }]);
    expect(Object.keys(result).sort()).toEqual(['events', 'patches']);
    // 返回的 patches 是路径描述数组（不可用于直接改状态）
    for (const patch of result.patches) {
      expect(Array.isArray(patch.path)).toBe(true);
    }
  });

  it('类型层：HookHandler 形参面与 ScriptHost 出口面（源码形态断言）', () => {
    const typesSource = readFileSync('packages/engine/src/scripts/types.ts', 'utf8');
    expect(typesSource).toMatch(/export type HookHandler = \(host: ScriptHost, ctx: HookContext\)/);
    expect(typesSource).toMatch(/transaction\(effects: readonly EffectData\[\]\)/);
    // 类型签名（去注释）不得出现 draft
    const signatures = typesSource
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    expect(signatures).not.toMatch(/\bdraft\b/i);
  });

  it('流程指令拒绝的边界与 SCRIPT_CONTRACT 错误码（行为复核）', () => {
    const runtime = new GameRuntime({
      state: newGameState(
        {
          versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
          attrs: { hp: 30 },
        },
        createRng(1),
      ),
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry(),
    });
    const host = createScriptHost({ runtime });
    try {
      host.transaction([{ ending: 'quiet_town' }] as never);
      expect.unreachable('流程指令应被拒绝');
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe('SCRIPT_CONTRACT');
      expect((error as EngineError).where.op).toBe('script');
    }
  });
});
