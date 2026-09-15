// 约束 9 的机械化兜底（main 分支禁止直接提交）的行为测试。
//
// 背景：2026-09-15 两次出现「改动直接落在 main」（c73edf6、0fcc976），
// 两次都是「文档类小改动 + 当时人在 main 上」——口头约定不足以拦住。
// 本测试针对 .githooks/ 下的钩子脚本，用临时 git 仓库实测其真实拦截行为
// （而不是断言脚本里有没有某段字符串）。
//
// 依赖：git 可执行（本仓库所有开发与 CI 环境均具备）。
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const hookSource = join(repoRoot, '.githooks');

/** 在临时目录建一个启用 .githooks 的最小仓库（隔离，不影响宿主仓库）。 */
function makeTempRepo(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-guard-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  git('init', '-q', '-b', branch);
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'hooks guard test');
  mkdirSync(join(dir, '.githooks'), { recursive: true });
  for (const hook of ['pre-commit', 'pre-push']) {
    const target = join(dir, '.githooks', hook);
    copyFileSync(join(hookSource, hook), target);
    // POSIX 上 git 只执行带可执行位的钩子；copyFileSync 默认 0644，
    // 不显式 chmod 会让守卫在 Linux/CI 上静默失效（本测试曾在 CI 上因此误报「提交成功」）。
    chmodSync(target, 0o755);
  }
  git('config', 'core.hooksPath', '.githooks');
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  git('add', 'seed.txt');
  // 种子提交用 --no-verify：本用例专门测「main 上提交被拒」，
  // 若种子本身就被拦下，临时仓库就没有可测的基线了。
  git('commit', '-q', '--no-verify', '-m', 'chore: seed');
  return dir;
}

/** 执行 git 命令并捕获结果（不抛异常） */
function tryGit(cwd: string, ...args: string[]): { status: number; stderr: string } {
  try {
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: e.stderr ?? '' };
  }
}

describe('git 钩子：main 分支禁止直接提交（约束 9 机械化兜底）', () => {
  let dir: string;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  describe('pre-commit', () => {
    it('在 main 上提交被拒绝，且提示正确流程', () => {
      dir = makeTempRepo('main');
      writeFileSync(join(dir, 'change.txt'), 'x\n');
      execFileSync('git', ['add', 'change.txt'], { cwd: dir });

      const result = tryGit(dir, 'commit', '-m', 'docs: 不该落地的改动');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('约束 9');
      expect(result.stderr).toContain('gh pr create');
      // 提交确实没有产生：HEAD 仍是 seed
      const head = execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir, encoding: 'utf8' });
      expect(head).toContain('seed');
    });

    it('在功能分支上提交放行', () => {
      dir = makeTempRepo('feat/example');
      writeFileSync(join(dir, 'change.txt'), 'x\n');
      execFileSync('git', ['add', 'change.txt'], { cwd: dir });

      const result = tryGit(dir, 'commit', '-m', 'feat: 正常提交');

      expect(result.status).toBe(0);
      const head = execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir, encoding: 'utf8' });
      expect(head).toContain('正常提交');
    });

    it('--no-verify 可绕过（紧急通道保持可用）', () => {
      dir = makeTempRepo('main');
      writeFileSync(join(dir, 'change.txt'), 'x\n');
      execFileSync('git', ['add', 'change.txt'], { cwd: dir });

      const result = tryGit(dir, 'commit', '--no-verify', '-m', 'chore: 紧急绕过');

      expect(result.status).toBe(0);
    });
  });

  describe('pre-push', () => {
    it('向 main 推送被拒绝（发布期兜底，--no-verify 提交也拦得住）', () => {
      dir = makeTempRepo('feat/example');
      // 先造一个本地 main 分支
      execFileSync('git', ['branch', 'main'], { cwd: dir, stdio: 'ignore' });
      // 造一个「裸远端」让 push 有目标（本地路径即可，不需要网络）
      const remote = mkdtempSync(join(tmpdir(), 'hooks-remote-'));
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { stdio: 'ignore' });

      try {
        const result = tryGit(dir, 'push', remote, 'main:main');

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('约束 9');
        // 远端 main 未被写入：仍是最初的空裸库（无 commit）
        const remoteLog = tryGit(remote, 'log', '--oneline');
        expect(remoteLog.status).not.toBe(0);
      } finally {
        rmSync(remote, { recursive: true, force: true });
      }
    });

    it('向功能分支推送放行', () => {
      dir = makeTempRepo('feat/example');
      const remote = mkdtempSync(join(tmpdir(), 'hooks-remote-'));
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { stdio: 'ignore' });

      try {
        const result = tryGit(dir, 'push', remote, 'feat/example:feat/example');

        expect(result.status).toBe(0);
        const remoteLog = tryGit(remote, 'log', '--oneline', 'feat/example');
        expect(remoteLog.status).toBe(0);
      } finally {
        rmSync(remote, { recursive: true, force: true });
      }
    });
  });

  describe('安装接线', () => {
    it('钩子文件以可执行位入库（100755）——否则 Linux/macOS 上 git 静默忽略', () => {
      // 背景：本仓库在 Windows 上开发（core.filemode=false），git add 默认记为
      // 100644；而 POSIX 平台只执行带可执行位的钩子——守卫会在 Unix/CI 上静默失效。
      // 该断言守护 `git update-index --chmod=+x` 的落地不被回退。
      const output = execFileSync('git', ['ls-files', '-s', '.githooks/'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      const modes = output
        .trim()
        .split('\n')
        .map((line) => line.split(/\s+/)[0]);
      expect(modes).toContain('100755');
      expect(modes.filter((m) => m === '100644')).toEqual([]);
    });

    it('setup-git-hooks.mjs 存在且把 core.hooksPath 指向 .githooks', () => {
      const script = join(repoRoot, 'scripts', 'setup-git-hooks.mjs');
      // 在临时仓库中执行该脚本，验证其真实效果（而非读源码文本）
      dir = makeTempRepo('feat/example');
      execFileSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: dir, stdio: 'ignore' });

      execFileSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });

      const hooksPath = execFileSync('git', ['config', 'core.hooksPath'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
      expect(hooksPath).toBe('.githooks');
    });

    it('根 package.json 的 prepare 脚本调用安装器（pnpm install 即自动启用）', () => {
      const pkg = JSON.parse(
        readFileSync(join(repoRoot, 'package.json'), 'utf8'),
      ) as { scripts?: Record<string, string> };
      expect(pkg.scripts?.prepare).toContain('setup-git-hooks');
    });
  });
});
