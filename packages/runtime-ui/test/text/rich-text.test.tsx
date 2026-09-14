import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText } from '../../src/text/index.js';

/**
 * 25 任务 4：RichText 渲染器（设计 §6.1 管线末段 → ReactNode；NFR-18）。
 *
 * 本文件是 sanitizer 的 **DOM 级安全回归**：结构层白名单（sanitize.test.ts）
 * 由纯函数保证，此处验证「渲染之后 DOM 里确实没有可执行节点」。
 */

describe('RichText：白名单渲染为对应元素', () => {
  it('b / i / em / mark / ruby 渲染为同名标签', () => {
    const { container } = render(
      <RichText text="<b>粗</b><i>斜</i><em>强</em><mark>亮</mark><ruby>漢</ruby>" />,
    );
    expect(container.querySelector('b')?.textContent).toBe('粗');
    expect(container.querySelector('i')?.textContent).toBe('斜');
    expect(container.querySelector('em')?.textContent).toBe('强');
    expect(container.querySelector('mark')?.textContent).toBe('亮');
    expect(container.querySelector('ruby')?.textContent).toBe('漢');
  });

  it('br / hr 渲染为 void 元素', () => {
    const { container } = render(<RichText text="前<br>后<hr>" />);
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.querySelectorAll('hr')).toHaveLength(1);
  });

  it('span 的 tone-* 类名落到 DOM', () => {
    render(<RichText text='<span class="tone-warm">暖</span>' />);
    expect(screen.getByText('暖')).toHaveClass('tone-warm');
  });

  it('span 的非法 class 不出现在 DOM（class 属性被完全丢弃）', () => {
    render(<RichText text='<span class="evil">x</span>' />);
    expect(screen.getByText('x')).not.toHaveAttribute('class');
  });
});

describe('RichText：XSS 负例在 DOM 层不可执行（NFR-18 红线）', () => {
  it('<script> 不产生 script 元素，原文作为可见文本', () => {
    const { container } = render(<RichText text={'<script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('onerror / onclick 属性不出现在任何元素上', () => {
    const { container } = render(
      <RichText text={'<b onerror="window.__pwned=1" onclick="window.__pwned=1">x</b>'} />,
    );
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.querySelector('b')?.textContent).toBe('x');
  });

  it('javascript: URL 不产生可点击链接元素', () => {
    const { container } = render(<RichText text={'<a href="javascript:alert(1)">点我</a>'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[href]')).toBeNull();
    expect(container.textContent).toContain('javascript:alert(1)');
  });

  it('img / iframe / svg 等注入面不落地为元素', () => {
    const { container } = render(
      <RichText
        text={'<img src=x onerror=alert(1)><iframe src="x"></iframe><svg/onload=alert(1)>'}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('RichText：文本与可访问性', () => {
  it('纯文本原样输出（无包裹元素）', () => {
    render(<RichText text="普通文本" />);
    expect(screen.getByText('普通文本')).toBeInTheDocument();
  });

  it('as 指定容器标签，缺省为 span（内联语义，不打断段落流）', () => {
    const { container } = render(<RichText text="x" as="p" />);
    expect(container.querySelector('p')?.textContent).toBe('x');
  });

  it('className 透传到容器（排版设置经 CSS 变量作用于此）', () => {
    const { container } = render(<RichText text="x" className="narrative-text" />);
    expect(container.querySelector('.narrative-text')).not.toBeNull();
  });
});
