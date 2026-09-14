// runtime-ui 测试环境 setup（25 号模块基建）。
//
// - 注册 @testing-library/jest-dom 断言扩展（toBeInTheDocument / toHaveTextContent 等）；
// - 置 `IS_REACT_ACT_ENVIRONMENT`：React 18 在测试中经 `act()` 驱动状态更新，
//   未置该标记时 React 打出「not configured to support act」告警（告警本身不影响
//   断言，但会淹没真实输出，且掩盖 act 包裹缺失导致的更新警告）。
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 每个用例后卸载 React 树：避免前一用例的订阅/副作用泄漏到下一用例
afterEach(() => {
  cleanup();
});
