import { createContext } from 'react';
import type { UiStoreApi } from './types.js';

/**
 * UiStore 注入 Context（设计 §6.2 / §1.3 原则 2「显式注入」）。
 *
 * 单独成文件的原因：hooks 与 Provider 都要引用它，Context 本体独立可避免
 * 模块循环依赖（Provider 在 hooks.tsx，组件只 import hooks）。
 * 缺省 null = 未装配 Provider，消费侧显性抛错而非静默用全局单例。
 */
export const UiStoreContext = createContext<UiStoreApi | null>(null);
