import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// ESLint flat config（00 号模块 B 组）。
//
// 这里以 lint 规则强制设计 §1.2 的包依赖规则与 §10.4 导出约定：
// - R1：shared 不依赖任何其他包（workspace 包与 react 系运行时库一律禁止）；
// - R2：engine 只依赖 shared，禁止 React 与 DOM/BOM 全局（环境探测由测试兜底）；
// - 导出约定：workspace 包只允许从包名根导入（@game/<pkg>），
//   禁止深入包内路径（@game/<pkg>/src/...）。
//
// 修改依赖规则前必须先修订 docs/detail-design.md §1.2（需求变更流程见 AGENTS.md）。

// 设计 §1.2 R2：engine 中禁用的 DOM/BOM 全局（engine 可在 Node 无 DOM 环境运行）。
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'alert',
  'confirm',
  'prompt',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'matchMedia',
  'customElements',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
];

const R1_MESSAGE =
  '设计 §1.2 R1：shared 不依赖任何其他包（workspace 包与 react 系运行时库均禁止）。';
const R2_IMPORT_MESSAGE = '设计 §1.2 R2：engine 只依赖 shared，禁止 React 与其他 workspace 包。';
const DEEP_IMPORT_MESSAGE =
  '导出约定（设计 §10.4）：workspace 包只允许从包名根导入（@game/<pkg>），禁止深入包内路径。';
const BARE_THROW_MESSAGE =
  '设计 §2.2（NFR-23）：禁止裸 throw new Error()，错误必须通过 EngineError 携带 code/where/messageKey 三元组。';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '.zcode/**',
      // Playwright E2E 产物（非源码，不入 lint/格式化）
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // scripts/ 是零依赖 Node 脚本，运行在 Node 环境（根 scripts/ 与各包内 scripts/ 同规）。
    files: [
      'scripts/**/*.js',
      'scripts/**/*.mjs',
      'packages/*/scripts/**/*.js',
      'packages/*/scripts/**/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // R1：shared 不依赖任何其他包（workspace 包与 react 系运行时库一律禁止）。
    // 唯一放行的运行时依赖是 zod（设计 §2「shared 零运行时依赖（仅 zod）」，
    // 供 §2.1 refId 辅助器与 §2.4 schema 体系使用）；zod 不在本规则的受限模式内。
    files: ['packages/shared/**/*.ts', 'packages/shared/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@game/*', '@game/*/*', '@game/*/**', 'react*'],
              message: R1_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // R2：engine 只依赖 shared，禁 React 与 DOM 全局（src 与 test 同样适用）。
    files: ['packages/engine/**/*.ts', 'packages/engine/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@game/*', '!@game/shared', '@game/*/*', '@game/*/**', 'react*'],
              message: R2_IMPORT_MESSAGE,
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...DOM_GLOBALS.map((name) => ({
          name,
          message: '设计 §1.2 R2：engine 禁止使用 DOM/BOM 全局，保持无 DOM 可在 Node 运行。',
        })),
      ],
    },
  },
  {
    // 设计 §2.2 / NFR-23：shared 与 engine 的 src 禁止裸 throw new Error，
    // 错误必须经 EngineError 携带 code/where/messageKey 三元组。
    // 仅限定 src（测试文件可自由构造负例）；内建子类型（TypeError 等）不在本约束内。
    files: ['packages/shared/src/**/*.ts', 'packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message: BARE_THROW_MESSAGE,
        },
      ],
    },
  },
  {
    // 其余包与应用：允许包名根导入，但禁止深入 workspace 包内部路径。
    files: [
      'packages/runtime-ui/**/*.ts',
      'packages/runtime-ui/**/*.tsx',
      'packages/editor/**/*.ts',
      'packages/editor/**/*.tsx',
      'packages/exporter/**/*.ts',
      'packages/exporter/**/*.tsx',
      'apps/**/*.ts',
      'apps/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@game/*/*', '@game/*/**'],
              message: DEEP_IMPORT_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  prettier,
);
