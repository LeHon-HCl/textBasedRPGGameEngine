/**
 * loader 子系统出口（游戏包加载器，设计 §3.4；06 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 * 七步加载管线（collect → parse → validate → crossRef → compile → scripts →
 * freeze）产出冻结的 GameDefinition；诊断规则与编辑器校验中心同源（DD-12）。
 */
export { collectPackage, computeAssetId, PACKAGE_PATHS } from './collect.js';
export { InMemoryPackageSource } from './source-memory.js';
export { parsePackage } from './parse.js';
export { validatePackage } from './validate.js';
export type {
  CollectedPackage,
  CompiledScene,
  Diagnostic,
  LocalePack,
  LocaleValue,
  PackageDomains,
  PackageSource,
  ParsedPackage,
  SceneFileInfo,
  ValidatedPackage,
} from './types.js';
