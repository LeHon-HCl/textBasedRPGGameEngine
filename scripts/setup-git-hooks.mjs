// 启用 .githooks 目录下的仓库钩子（当前仅 pre-commit：禁止直提 main）。
// 由 package.json 的 prepare 脚本在 pnpm install 时自动调用；
// 非 git 环境（如导出的源码包）静默跳过，不影响安装。
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // ignore：不在 git 仓库中时无需启用钩子
}
