# 27 导出与分发

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §9.1～9.3 |
| 需求映射 | FR-EXPT-01～05、FR-SCR-03、FR-MIGR-07 |
| 前置模块 | 06（加载器校验复用）、25（player 模板）、23（脚本编译门禁） |
| 里程碑 | M4 |

> 目标：静态包/单文件/Electron 三形态产物 + 脚本编译管线 + 完整性清单。

## 任务清单

- [ ] 导出管线：加载器全量校验门禁（error 阻断）→ YAML→JSON 按域 chunk → 资产复制 sha256 清单
- [ ] 静态目录产物：index.html + engine chunk + locales 按命名空间 chunk（懒加载）+ integrity.json + credits（FR-EXPT-01/04）
- [ ] `file://` 限制处理：关键 chunk 内联 + 剩余限制写入发布说明
- [ ] 单文件导出：全部内联 + 内存 PackageSource；>50MB 告警建议分包（OQ-05 复核点）
- [ ] 脚本编译：tsc --noEmit 类型门禁 → esbuild ESM bundle → 运行时守卫（禁 fetch/XHR/WS，OQ-11 兜底）
- [ ] migrations 同管线编译 + from/to 元数据静态提取
- [ ] Electron：electron-builder 配置（三平台）+ 主进程最小化（菜单/存档目录）+ 无自动更新声明（FR-EXPT-03）
- [ ] PWA 可选模板（manifest + workbox 预缓存，FR-EXPT-05）
- [ ] E2E：产物在 GitHub Pages 与 Electron 均可玩；产物断言（结构/哈希/单文件体积）

## 完成定义
- [ ] 全部子任务勾选；M4 验收用例（含「自定义脚本指令 demo 编译导出成功」）通过
