/**
 * i18n 子系统出口（文本解析与本地化运行时，设计 §4.1；07 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 */
export { consoleWarn, createLocaleProvider, createTextResolver } from './text-resolver.js';
export type {
  InterpVars,
  LocaleProvider,
  ResolvedText,
  TextResolver,
  TextResolverOptions,
  TextResolverWarn,
} from './text-resolver.js';
