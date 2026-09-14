import { describe, expect, it } from 'vitest';
import { parseRichText, richTextToPlainText, sanitizeRichText } from '../../src/text/index.js';

/**
 * 25 任务 4：sanitizer（设计 §6.1；NFR-18 安全红线）。
 *
 * 白名单标签 `b / i / em / mark / ruby / span[class=tone-*] / br / hr`；
 * 非白名单标签**转义显示**（标记原文成为可见文本，不丢弃、不静默吞内容）。
 *
 * 断言口径（两层）：
 * - **结构层**：白名单外的输入绝不产出 element 节点（这是「不可执行」的
 *   结构保证——渲染器只把 element 节点映射为 DOM 元素）；
 * - **文本层**：标记原文以字面文本保留（`<script>` 作为可见字符，而非元素）。
 *
 * 「转义」在本管线的实现是在渲染层完成的（React 文本子节点不解析 HTML），
 * 因此结构层断言是安全性的主判据——render.test.tsx 有对应的 DOM 级回归。
 */

describe('sanitizeRichText：白名单放行（§6.1）', () => {
  it('保留白名单标签的结构', () => {
    const nodes = sanitizeRichText('<b>粗</b>与<i>斜</i>与<em>强调</em>');
    expect(nodes).toEqual([
      { kind: 'element', tag: 'b', children: [{ kind: 'text', text: '粗' }] },
      { kind: 'text', text: '与' },
      { kind: 'element', tag: 'i', children: [{ kind: 'text', text: '斜' }] },
      { kind: 'text', text: '与' },
      { kind: 'element', tag: 'em', children: [{ kind: 'text', text: '强调' }] },
    ]);
  });

  it('mark 放行；br / hr 为自闭合空元素', () => {
    expect(sanitizeRichText('<mark>高亮</mark>')).toEqual([
      { kind: 'element', tag: 'mark', children: [{ kind: 'text', text: '高亮' }] },
    ]);
    expect(sanitizeRichText('前<br>后')).toEqual([
      { kind: 'text', text: '前' },
      { kind: 'element', tag: 'br', children: [] },
      { kind: 'text', text: '后' },
    ]);
    expect(sanitizeRichText('<hr>')).toEqual([{ kind: 'element', tag: 'hr', children: [] }]);
  });

  it('ruby 放行（注音标注；未闭合时按解析器容错结果嵌套）', () => {
    expect(sanitizeRichText('<ruby>漢字</ruby>')).toEqual([
      { kind: 'element', tag: 'ruby', children: [{ kind: 'text', text: '漢字' }] },
    ]);
  });

  it('span 仅放行 class="tone-*"；其他 class 值被丢弃', () => {
    expect(sanitizeRichText('<span class="tone-warm">暖</span>')).toEqual([
      {
        kind: 'element',
        tag: 'span',
        className: 'tone-warm',
        children: [{ kind: 'text', text: '暖' }],
      },
    ]);
    expect(sanitizeRichText('<span class="evil">x</span>')).toEqual([
      { kind: 'element', tag: 'span', children: [{ kind: 'text', text: 'x' }] },
    ]);
    // 混合 class：只保留白名单前缀项
    expect(sanitizeRichText('<span class="other tone-cold">y</span>')).toEqual([
      {
        kind: 'element',
        tag: 'span',
        className: 'tone-cold',
        children: [{ kind: 'text', text: 'y' }],
      },
    ]);
  });
});

describe('sanitizeRichText：非白名单标签转义显示（NFR-18）', () => {
  it('<script> 不产生任何元素节点，标记原文以文本保留', () => {
    const nodes = sanitizeRichText('前<script>alert(1)</script>后');
    expect(nodes.every((node) => node.kind === 'text')).toBe(true);
    expect(richTextToPlainText(nodes)).toBe('前<script>alert(1)</script>后');
  });

  it('未知标签（iframe / img / div）不产生元素节点', () => {
    for (const input of ['<iframe src="x"></iframe>', '<img src=x>', '<div>块</div>']) {
      const nodes = sanitizeRichText(input);
      expect(nodes.every((node) => node.kind === 'text')).toBe(true);
    }
  });

  it('白名单标签的非法属性被丢弃（onerror / onclick / style / src）', () => {
    expect(sanitizeRichText('<b onerror="alert(1)" style="color:red">安全</b>')).toEqual([
      { kind: 'element', tag: 'b', children: [{ kind: 'text', text: '安全' }] },
    ]);
  });

  it('javascript: 伪协议不会成为链接（a 标签不产元素节点）', () => {
    const nodes = sanitizeRichText('<a href="javascript:alert(1)">点我</a>');
    expect(nodes.every((node) => node.kind === 'text')).toBe(true);
    expect(richTextToPlainText(nodes)).toContain('javascript:alert(1)');
  });

  it('大小写变体不能绕过白名单（ScRiPt）', () => {
    const upper = sanitizeRichText('<ScRiPt>alert(1)</ScRiPt>');
    expect(upper.every((node) => node.kind === 'text')).toBe(true);
    expect(richTextToPlainText(upper)).toBe('<script>alert(1)</script>');
  });

  it('插值值含尖括号时不引入标签（§6.1「插值值永不引入标签」）', () => {
    const nodes = sanitizeRichText('伤害 <b>3</b> 点 <script>bad()</script>');
    expect(nodes.filter((node) => node.kind === 'element')).toHaveLength(1);
    expect(richTextToPlainText(nodes)).toBe('伤害 3 点 <script>bad()</script>');
  });

  it('HTML 注释不进入输出（避免条件注释类注入面）', () => {
    const nodes = sanitizeRichText('a<!-- <script>x</script> -->b');
    expect(richTextToPlainText(nodes)).toBe('ab');
  });

  it('非白名单标签的文本内容保留（不静默删内容）', () => {
    const nodes = sanitizeRichText('<div>保留我</div>');
    expect(richTextToPlainText(nodes)).toContain('保留我');
  });
});

describe('sanitizeRichText：边界与健壮性', () => {
  it('空串与纯文本原样（无标签时零结构）', () => {
    expect(sanitizeRichText('')).toEqual([]);
    expect(sanitizeRichText('普通文本')).toEqual([{ kind: 'text', text: '普通文本' }]);
  });

  it('未闭合标签按解析器的容错结果处理，不抛错', () => {
    expect(() => sanitizeRichText('<b>未闭合')).not.toThrow();
    expect(sanitizeRichText('<b>未闭合')).toEqual([
      { kind: 'element', tag: 'b', children: [{ kind: 'text', text: '未闭合' }] },
    ]);
  });

  it('嵌套白名单标签保留层级', () => {
    expect(sanitizeRichText('<b>粗<mark>亮</mark></b>')).toEqual([
      {
        kind: 'element',
        tag: 'b',
        children: [
          { kind: 'text', text: '粗' },
          { kind: 'element', tag: 'mark', children: [{ kind: 'text', text: '亮' }] },
        ],
      },
    ]);
  });

  it('实体按文本语义还原（&lt; 是字符而非标签起点）', () => {
    expect(sanitizeRichText('&lt;不是标签&gt;')).toEqual([{ kind: 'text', text: '<不是标签>' }]);
  });

  it('纯函数：同一输入两次调用结果深等且互不共享可变结构', () => {
    const first = sanitizeRichText('<b>x</b>');
    const second = sanitizeRichText('<b>x</b>');
    expect(first).toEqual(second);
    expect(first[0]).not.toBe(second[0]);
  });
});

describe('parseRichText：解析与清洗的一体入口', () => {
  it('返回同一节点结构（sanitize 是 parse 的别名语义）', () => {
    const source = '<b>x</b><script>y</script>';
    expect(parseRichText(source)).toEqual(sanitizeRichText(source));
  });
});
