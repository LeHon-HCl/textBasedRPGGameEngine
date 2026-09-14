// 全 workspace 共享的 Vitest 配置（00 号模块 B 组；25A 起含浏览器环境分区）。
//
// - 测试位置约定：packages/<pkg>/test 下的 *.test.ts(x)，以及 fixtures/helpers/test；
// - 环境分区（25A）：runtime-ui 是浏览器包（React + DOM），其测试走 jsdom；其余包与
//   跨包夹具继续在 node 环境跑——engine 的「无 DOM 可运行」是设计 §1.2 R2 的硬约束，
//   node 环境本身就是该约束的回归防线。Vitest 5 已移除 environmentMatchGlobs，按路径
//   分区改用 projects：每项目声明自己的 include 与 environment，互不干扰；
// - 覆盖率门禁（设计 §10.1 / NFR-13）：shared ≥ 90%、engine ≥ 80%、runtime-ui ≥ 80%，
//   统计范围 src/**（即 packages/<pkg>/src 与 fixtures/helpers/src）。覆盖率在根配置
//   声明，各项目采集结果合并为同一份报告后按路径 glob 分别设阈。
//
// 工作区包在测试期解析到源码（而非 dist）：各包 package.json 的 exports 指向 ./dist，
// 而 dist/ 是构建产物、不入库。若走默认解析，全新检出会以
// 「Failed to resolve entry for package "@game/shared"」整片失败——CI 门禁 1 只跑
// lint + test、不做构建，本地能过只是因为工作区恰好留有历史构建产物。
// 别名同时保证跨包导入与各包 src 内部导入共用同一份模块实例。
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** 解析到源码的工作区包（对应 packages/<name>/src/index.ts） */
const WORKSPACE_PACKAGES = ['shared', 'engine', 'runtime-ui', 'editor', 'exporter'] as const;

const workspaceAliases = Object.fromEntries(
  WORKSPACE_PACKAGES.map((name) => [
    `@game/${name}`,
    fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
  ]),
);

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    projects: [
      {
        // node 环境项目：engine/shared 等纯逻辑包与跨包夹具。
        // engine 在本环境下不得依赖任何 DOM 全局（设计 §1.2 R2）。
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'packages/{shared,engine,editor,exporter}/test/**/*.test.ts',
            'fixtures/helpers/test/**/*.test.ts',
          ],
        },
      },
      {
        // 浏览器环境项目：runtime-ui 组件的 Testing Library 测试（jsdom）。
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['packages/runtime-ui/test/**/*.test.{ts,tsx}'],
          // jest-dom 断言扩展 + React act 环境标记 + 用例后 cleanup
          setupFiles: ['packages/runtime-ui/test/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // 统计范围 = 有实现的包 src。runtime-ui 于 25A 落地实现，自此纳入；editor/exporter
      // 仍为占位包，不计入——否则其 0% 会稀释聚合，把 engine 阈值变成自动通过
      // （20 号模块的门禁失效根因之一，2026-09-14 修复）。
      include: [
        'packages/shared/src/**',
        'packages/engine/src/**',
        'packages/runtime-ui/src/**',
        'fixtures/helpers/src/**',
      ],
      exclude: [
        '**/.gitkeep',
        // 纯转出/纯类型文件：无运行时代码可覆盖，计入只会拉低聚合且无意义。
        // 判定口径：index.ts 为纯 re-export；余下为仅含 type/interface 声明的文件。
        'packages/*/src/index.ts',
        'packages/*/src/**/index.ts',
        'packages/engine/src/runtime/engine-events.ts',
        'packages/engine/src/runtime/exec-context.ts',
        'packages/engine/src/state/game-state.ts',
        'packages/engine/src/**/types.ts',
        'packages/runtime-ui/src/**/types.ts',
        'packages/shared/src/expr.ts',
        // DexieAdapter 是对 IndexedDB 的封装：jsdom 不提供 IndexedDB，且 fake-indexeddb
        // 不在 25A 批准的依赖清单内，故其实现分支在单测环境不可执行。覆盖职责下沉到
        // **契约等价性**：test/persistence/contract.ts 对 MemoryAdapter 全量断言（NFR-10
        // 降级承诺的可执行定义）+ 构造/关闭/环境守卫用例 + 「无 IndexedDB →
        // PrivacyModeError」路径断言。浏览器侧真实覆盖归 M1 收尾的 Playwright 冒烟。
        'packages/runtime-ui/src/persistence/dexie-adapter.ts',
      ],
      thresholds: {
        // shared：类型/schema 为主，测试密度高，维持高线。
        'packages/shared/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        // engine：整体语句 94%、分支 86%（2026-09-14 实测），阈值留出余量但不虚设。
        'packages/engine/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // 跨包测试支撑：契约套件与包源夹具，覆盖率要求同 shared。
        'fixtures/helpers/src/**': { statements: 80, branches: 70, functions: 80, lines: 80 },
        // runtime-ui 取与 engine 同级的 80%（设计 §10.1 未单列浏览器包阈值）
        'packages/runtime-ui/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
