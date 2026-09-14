/**
 * text 切片出口（设计 §6.1 文本渲染管线）。
 *
 * 组成：sanitize（白名单 + 转义）→ RichText 渲染（ReactNode）→ 打字机。
 * 三段各自可单测：sanitize 与打字机为纯逻辑，渲染为组件。
 */
export { parseRichText, richTextToPlainText, sanitizeRichText } from './sanitize.js';
export type { RichTextNode } from './sanitize.js';
export { RichText } from './RichText.js';
export type { RichTextProps } from './RichText.js';
export { createRenderPipeline } from './pipeline.js';
export type {
  RenderInput,
  RenderMedia,
  RenderPipeline,
  RenderPipelineOptions,
  RenderResult,
} from './pipeline.js';
export {
  countRichTextChars,
  sliceRichTextNodes,
  TYPEWRITER_BASE_INTERVAL_MS,
  typewriterIntervalMs,
  TypewriterText,
  usePrefersReducedMotion,
  useTypewriter,
} from './typewriter.js';
export type { TypewriterTextProps } from './typewriter.js';
