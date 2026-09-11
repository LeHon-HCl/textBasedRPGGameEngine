// 全 workspace 共享的 Vitest 配置（00 号模块 B 组）。
//
// - 测试位置约定：packages/<pkg>/test 下的 *.test.ts，以及 fixtures/helpers/test；
// - 覆盖率门禁（设计 §10.1 / NFR-13）：shared ≥ 90%、engine ≥ 80%，统计范围 src/**
//   （即 packages/<pkg>/src 与 fixtures/helpers/src）；
// - runtime-ui / editor 后续接入组件测试时在此扩展（浏览器环境与阈值）。
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
