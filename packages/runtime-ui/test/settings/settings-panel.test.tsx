import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { PlayerSettings } from '@game/engine';
import { SettingsPanel } from '../../src/settings/index.js';
import type { SettingsPanelProps } from '../../src/settings/index.js';

/**
 * 25 任务 9：设置面板（设计 §6.5 / FR-UI-05）。
 *
 * 设置项即 `PlayerSettings` 的表单化：语言 / 文本速度 / 字号行距 / BGM / 音效 /
 * 图片 / 减弱动画 / 标签开关 / 快捷键说明 / 关于（三版本号，FR-UI-08 数据源）。
 *
 * 断言口径说明：表单是**完全受控**组件（值恒由 props 决定），故交互用例以
 * 「宿主壳」承接 onChange 并回写状态——这既复现真实装配（宿主即设置持有者），
 * 也让断言落在可观察结果（控件值变化）而非仅回调调用。
 */

const SETTINGS: PlayerSettings = {
  lang: 'zh-CN',
  textSpeed: 1,
  fontSize: 16,
  lineHeight: 1.6,
  bgmOn: true,
  sfxOn: false,
  imagesOn: true,
  reducedMotion: false,
  disabledTags: ['tag_horror'],
  wizardDone: true,
};

const VERSIONS = {
  engineVersion: '0.0.0',
  gameVersion: '1.0.0',
  schemaVersion: 1,
};

const TAGS = [
  { id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: true },
  { id: 'tag_romance', nameKey: 'tags.romance.name', defaultOn: true },
];

/** 宿主壳：承接 onChange 并回写（模拟真实的设置持有者） */
function Harness({
  initial = SETTINGS,
  onChange,
  ...rest
}: Omit<SettingsPanelProps, 'settings' | 'onChange'> & {
  readonly initial?: PlayerSettings;
  readonly onChange?: (partial: Partial<PlayerSettings>) => void;
}): React.ReactNode {
  const [settings, setSettings] = useState<PlayerSettings>(initial);
  return (
    <SettingsPanel
      settings={settings}
      langs={rest.langs}
      tags={rest.tags}
      versions={rest.versions}
      nameOf={rest.nameOf}
      {...(rest.shortcuts !== undefined ? { shortcuts: rest.shortcuts } : {})}
      {...(rest.labels !== undefined ? { labels: rest.labels } : {})}
      onChange={(partial) => {
        onChange?.(partial);
        setSettings((prev: PlayerSettings) => ({ ...prev, ...partial }));
      }}
    />
  );
}

function renderSettings(overrides: Partial<SettingsPanelProps> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <StrictMode>
      <Harness
        langs={overrides.langs ?? ['zh-CN', 'en']}
        tags={overrides.tags ?? TAGS}
        versions={overrides.versions ?? VERSIONS}
        nameOf={overrides.nameOf ?? ((key) => key)}
        {...(overrides.shortcuts !== undefined ? { shortcuts: overrides.shortcuts } : {})}
        {...(overrides.labels !== undefined ? { labels: overrides.labels } : {})}
        {...(overrides.settings !== undefined ? { initial: overrides.settings } : {})}
        onChange={onChange}
      />
    </StrictMode>,
  );
  return { ...utils, onChange };
}

describe('SettingsPanel：文本与显示项（FR-UI-05 / FR-READ-05）', () => {
  it('语言选择列出所有已注册语言，切换回调 onChange({lang}) 并生效', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    const select = screen.getByLabelText('语言');
    expect(select).toHaveValue('zh-CN');
    await user.selectOptions(select, 'en');
    expect(screen.getByLabelText('语言')).toHaveValue('en');
    expect(onChange).toHaveBeenCalledWith({ lang: 'en' });
  });

  it('文本速度/字号/行距为受控数值输入，变更回写后呈现新值', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    const speed = screen.getByLabelText('文本速度');
    expect(speed).toHaveValue(1);
    await user.clear(speed);
    await user.type(speed, '2');
    expect(onChange).toHaveBeenCalledWith({ textSpeed: 2 });
    expect(screen.getByLabelText('文本速度')).toHaveValue(2);

    const fontSize = screen.getByLabelText('字号');
    await user.clear(fontSize);
    await user.type(fontSize, '18');
    expect(onChange).toHaveBeenCalledWith({ fontSize: 18 });
    expect(screen.getByLabelText('字号')).toHaveValue(18);

    const lineHeight = screen.getByLabelText('行距');
    await user.clear(lineHeight);
    await user.type(lineHeight, '2.0');
    expect(onChange).toHaveBeenCalledWith({ lineHeight: 2 });
    expect(screen.getByLabelText('行距')).toHaveValue(2);
  });

  it('减弱动画开关（NFR-26）与媒体开关反映当前值', () => {
    renderSettings();
    expect(screen.getByLabelText('减弱动画')).not.toBeChecked();
    expect(screen.getByLabelText('背景音乐')).toBeChecked();
    expect(screen.getByLabelText('音效')).not.toBeChecked();
    expect(screen.getByLabelText('图片')).toBeChecked();
  });

  it('媒体/动画开关翻转回调布尔值并回写勾选态', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.click(screen.getByLabelText('减弱动画'));
    expect(onChange).toHaveBeenCalledWith({ reducedMotion: true });
    expect(screen.getByLabelText('减弱动画')).toBeChecked();
    await user.click(screen.getByLabelText('音效'));
    expect(onChange).toHaveBeenCalledWith({ sfxOn: true });
    expect(screen.getByLabelText('音效')).toBeChecked();
  });
});

describe('SettingsPanel：内容标签开关（FR-CGRD-03）', () => {
  it('以开关列出全部标签，勾选态 = 未被禁用', () => {
    renderSettings();
    expect(screen.getByLabelText('tags.horror.name')).not.toBeChecked();
    expect(screen.getByLabelText('tags.romance.name')).toBeChecked();
  });

  it('切换标签回调 disabledTags 新数组并回写（不原地改传入数组）', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.click(screen.getByLabelText('tags.romance.name'));
    expect(onChange).toHaveBeenCalledWith({ disabledTags: ['tag_horror', 'tag_romance'] });
    expect(screen.getByLabelText('tags.romance.name')).not.toBeChecked();
    // 原始常量未被修改（受控纯净：变更产出新数组）
    expect(SETTINGS.disabledTags).toEqual(['tag_horror']);
  });

  it('重新启用标签从禁用集移除', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();
    await user.click(screen.getByLabelText('tags.horror.name'));
    expect(onChange).toHaveBeenCalledWith({ disabledTags: [] });
    expect(screen.getByLabelText('tags.horror.name')).toBeChecked();
  });
});

describe('SettingsPanel：快捷键说明与关于（FR-READ-06 / FR-UI-08）', () => {
  it('快捷键映射表可查（默认五类键位）', () => {
    renderSettings();
    expect(screen.getByText('空格 / 回车')).toBeInTheDocument();
    expect(screen.getByText('1-9')).toBeInTheDocument();
    expect(screen.getByText('S / L')).toBeInTheDocument();
    expect(screen.getByText('H')).toBeInTheDocument();
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });

  it('三版本号全部展示（引擎/游戏/schema）', () => {
    renderSettings();
    expect(screen.getByText('0.0.0')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('快捷键表可经 props 覆盖（自定义映射）', () => {
    renderSettings({ shortcuts: [{ keys: 'Q', action: '退出' }] });
    expect(screen.getByText('Q')).toBeInTheDocument();
    expect(screen.getByText('退出')).toBeInTheDocument();
    expect(screen.queryByText('S / L')).not.toBeInTheDocument();
  });

  it('标签为空时不渲染标签区块（无标题噪声）', () => {
    renderSettings({ tags: [] });
    expect(screen.queryByRole('heading', { name: '内容标签' })).not.toBeInTheDocument();
  });
});
