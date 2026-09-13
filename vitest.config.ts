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
      include: ['packages/*/src/**', 'fixtures/helpers/src/**'],
      exclude: ['**/.gitkeep'],
      thresholds: {
        'packages/shared/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'packages/engine/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
