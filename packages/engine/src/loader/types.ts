/**
 * 游戏包加载器类型（设计 §3.4，06 号模块）。
 *
 * {@link PackageSource} 是三宿主共用的包输入抽象（DD-12 相关）：
 * - Electron/Node 宿主为目录（文件树快照）；
 * - 浏览器静态包为导出期预编译的 JSON chunk（§9.1，parse 步退化为直读）；
 * - 编辑器为内存 DocModel（M3 起）。
 * 三宿主共用同一条七步加载管线，本文件只承载输入抽象与诊断契约。
 */

/**
 * 包源抽象（设计 §3.4）：以包根为基准的只读文件树快照。
 *
 * 约定：
 * - 路径一律正斜杠、相对包根（如 `manifest.yaml`、`data/scenes/old_town/arrival.yaml`）；
 * - {@link read}：文件存在 → 返回文本或二进制内容；指向目录或不存在 → reject；
 * - {@link list}：目录存在 → 返回直接子项（文件与子目录）的相对路径；包根传 `''`；
 *   目录不存在 → reject。
 */
export interface PackageSource {
  read(path: string): Promise<Uint8Array | string>;
  list(dir: string): Promise<string[]>;
}
