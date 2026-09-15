/**
 * loader 子系统出口（游戏包加载器，设计 §3.4；06 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 * 七步加载管线（collect → parse → validate → crossRef → compile → scripts →
 * freeze）产出冻结的 GameDefinition；诊断规则与编辑器校验中心同源（DD-12）。
 */
export { collectPackage, computeAssetId, PACKAGE_PATHS } from './collect.js';
export { DeferredXFunctionRegistry, compileExprIntoCache } from './compile-expr.js';
export { buildPoolIndex, compilePackage } from './compile.js';
export { buildRefRegistries, crossRefCheck } from './cross-ref.js';
export {
  compareDiagnostics,
  diagnosticToError,
  firstError,
  mergeDiagnostics,
  throwIfErrors,
} from './diagnostics.js';
export { buildGameDefinition, deepFreeze } from './freeze.js';
export { locationEntryKey, resolveLocationEntries } from './navigation.js';
export type { LocationEntryMap } from './navigation.js';
export { parsePackage } from './parse.js';
export { loadGamePackage } from './pipeline.js';
export { runScriptStep } from './scripts.js';
export { InMemoryPackageSource } from './source-memory.js';
export { validatePackage } from './validate.js';
export { collectXFunctionCalls, inventoryPackage } from './walk.js';
export type {
  CollectedPackage,
  CompiledArtifacts,
  CompiledScene,
  Diagnostic,
  GameDefinition,
  LoadGameOptions,
  LocalePack,
  LocaleRecord,
  LocaleValue,
  MediaAsset,
  MediaCatalog,
  PackageDomains,
  PackageSource,
  ParsedPackage,
  PoolIndex,
  SceneFileInfo,
  ScriptModule,
  ScriptSetupApi,
  ValidatedPackage,
  XFunctionRef,
} from './types.js';
