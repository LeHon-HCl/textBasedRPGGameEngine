import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置（M1 收尾引入；develop.md 约束 5 第 6 项「验收 demo」的自动化面）。
 *
 * 定位与 Vitest 的分工：
 * - Vitest：单元 + 组件（node / jsdom 两环境），覆盖模块内行为与投影；
 * - Playwright（本配置）：**真实浏览器里的端到端玩家流**——dev server + 真实
 *   IndexedDB + 真实点击，覆盖「新游戏 → 探索 → 事件 → 任务 → 存读档 → 语言切换」
 *   这类跨层集成路径，也是 DexieAdapter 唯一可被真实覆盖的场所（见 vitest 的覆盖排除）。
 *
 * 运行：`pnpm e2e`（首次需 `npx playwright install chromium`）。
 * CI：不默认纳入四门禁（浏览器二进制与耗时成本），由里程碑审查手动触发。
 */
export default defineConfig({
  testDir: './e2e',
  // 失败重试 1 次（本地偶发抖动；真实缺陷仍会稳定复现）
  retries: 1,
  // 单 worker：dev server 与 IndexedDB 状态在用例间相互影响，串行更可判
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      // 优先使用 Playwright 自带的 chromium；本机若未成功下载（网络受限环境），
      // 可用 `--project=msedge` 走系统 Edge（Windows 预装，等价 Chromium 内核）。
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'msedge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
  // 自动拉起 demo dev server（复用已运行的实例，本地开发友好）
  webServer: {
    command: 'pnpm dev:player',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
