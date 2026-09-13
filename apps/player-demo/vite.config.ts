// player-demo 的 Vite 配置（00 号模块 A 组的 dev 入口）。
//
// 与 vitest.config.ts 同因：工作区包的 exports 指向 ./dist，而 dist/ 不入库。
// dev / build 期把 @game/* 解析到各包源码，全新检出无需先 `pnpm build` 即可
// `pnpm dev:player`；同时跨包改动可直接热更新，不必每次重新构建。
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** 解析到源码的工作区包（对应 packages/<name>/src/index.ts） */
const WORKSPACE_PACKAGES = ['shared', 'engine', 'runtime-ui', 'editor', 'exporter'] as const;

const workspaceAliases = Object.fromEntries(
  WORKSPACE_PACKAGES.map((name) => [
    `@game/${name}`,
    fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url)),
  ]),
);

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
});
