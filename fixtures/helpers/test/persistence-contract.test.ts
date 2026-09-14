import { MemoryAdapter } from '@game/engine';
import { describePersistenceAdapterContract } from '../src/persistence-contract.js';

/**
 * 契约套件 × 真实实现的运行点（20 号任务 1/2）。
 *
 * 运行位置说明：套件本体在 `../src/persistence-contract.ts`（被 engine 与
 * runtime-ui 的实现方共享），实现在此实例化执行——不放在 engine/test 是因为
 * 设计 §1.2 R2「engine 只依赖 shared」对 src 与 test 同样适用（lint 强制），
 * engine 不得 import fixtures/helpers；而 fixtures/helpers 是仓库既定的跨包
 * 测试支撑包（vitest.config.ts 的 include 已登记其 test 目录）。
 *
 * 25 号落地 DexieAdapter（§6.7）时在此追加一条
 * `describePersistenceAdapterContract('DexieAdapter', ...)` 即可——同一套用例，
 * 两个实现的行为因此不会分叉。
 */
describePersistenceAdapterContract('MemoryAdapter', () => new MemoryAdapter());
