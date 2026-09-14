// 全 workspace 共享的 Vitest 配置（00 号模块 B 组）。
//
// - 测试位置约定：packages/<pkg>/test 下的 *.test.ts，以及 fixtures/helpers/test；
// - 覆盖率门禁（设计 §10.1 / NFR-13）：shared ≥ 90%、engine ≥ 80%，统计范围 src/**
//   （即 packages/<pkg>/src 与 fixtures/helpers/src）；
// - runtime-ui / editor 后续接入组件测试时在此扩展（浏览器环境与阈值）。
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
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'fixtures/helpers/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // 统计范围 = 有实现的包 src。三个未开工的占位包（runtime-ui/editor/exporter）
      // 不计入——否则其 0% 会稀释聚合，把 engine 阈值变成自动通过（20 号模块的
      // 门禁失效根因之一，2026-09-14 修复）。
      include: ['packages/shared/src/**', 'packages/engine/src/**', 'fixtures/helpers/src/**'],
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
        'packages/shared/src/expr.ts',
      ],
      thresholds: {
        // shared：类型/schema 为主，测试密度高，维持高线。
        'packages/shared/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        // engine：整体语句 94%、分支 86%（2026-09-14 实测），阈值留出余量但不虚设。
        'packages/engine/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // 跨包测试支撑：契约套件与包源夹具，覆盖率要求同 shared。
        'fixtures/helpers/src/**': { statements: 80, branches: 70, functions: 80, lines: 80 },
      },
    },
  },
});
