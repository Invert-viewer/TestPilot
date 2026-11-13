# 仪表盘布局 — 风格参考

> 指标先行：先给数字，再给图，最后才给细节。

**Theme:** light

仪表盘布局解决的是「一眼看懂」：顶部一排 KPI 卡（3 到 4 张），下面是图表区与明细表。每张 KPI 卡只放三个元素——指标名、数字、变化率，变化率用绿色与红色的 10% 底色块表示，不靠箭头。左侧深色侧栏与浅灰内容区形成固定分区，卡片用 12px 圆角、1px 描边、一级阴影。密度比企业站更高：图表内边距 16px、表格行高 44px、数字用等宽字体对齐。

## Colors

| Name | Value | Token | Role |
|---|---|---|---|
| Near Black | `#111827` | `--color-near-black` | 侧栏底色、标题与主要数字。仪表盘需要比企业站更强的对比。 |
| Mist | `#f9fafb` | `--color-mist` | 内容区画布，卡片浮在其上。 |
| Card White | `#ffffff` | `--color-card-white` | KPI 卡、图表容器与表格底。 |
| Indigo | `#6366f1` | `--color-indigo` | 主行动与图表主序列。全屏只允许一个蓝紫色系。 |
| Positive Green | `#10b981` | `--color-positive` | 增长指标与成功状态。用 10% 底配实色文字，不用实色块。 |
| Negative Red | `#ef4444` | `--color-negative` | 下降指标与错误。与绿色保持同等的面积与字重。 |

## Typography

### Inter — 全站唯一字体。数字用 tabular-nums 保证列对齐，这是仪表盘最重要的排版细节。

- **Substitute:** system-ui, -apple-system, 'Segoe UI', sans-serif
- **Weights:** 400, 500, 600, 700
- **Sizes:** 11, 12, 14, 20, 28, 36
- **Line height:** 1.15 (display), 1.3 (headings), 1.5 (body)
- **Letter spacing:** -0.02em on display, 0.04em on uppercase labels

### JetBrains Mono — 表格数值、ID 与代码片段。等宽让纵向比较成为可能。

- **Substitute:** ui-monospace, SFMono-Regular, Menlo, monospace
- **Weights:** 400, 500
- **Sizes:** 12, 13
- **Line height:** 1.4 (display), 1.4 (headings), 1.5 (body)
- **Letter spacing:** 0 on display, 0.02em on uppercase labels

### Type Scale

| Role | Family | Weight | Size | Line Height | Letter Spacing | Token |
|---|---|---|---|---|---|---|
| display | — | 700 | 36px | 1.15 | -0.02em | `--text-display` |
| heading | — | 600 | 20px | 1.3 | — | `--text-heading` |
| body-lg | — | 500 | 14px | 1.5 | — | `--text-body-lg` |
| body | — | 400 | 13px | 1.5 | — | `--text-body` |
| label | — | 500 | 11px | 1.4 | 0.04em | `--text-label` |

## Spacing & Layout

**Base unit:** 4px
**Density:** compact

### Spacing Scale

| Name | Value | Token |
|---|---|---|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 48 | 48px | `--spacing-48` |

### Border Radius

| Element | Value |
|---|---|
| cards | 12px |
| buttons | 8px |
| inputs | 8px |
| chips | 8px |

- **Page max-width:** 1600px
- **Section gap:** 24px
- **Card padding:** 20px
- **Element gap:** 12px

## Components

### KPI Card

**Role:** 顶部指标卡

白底、12px 圆角、1px #f3f4f6 描边、内边距 20px、阴影 0 1px 2px。第一行 13px 灰字指标名，右侧变化率芯片（11px、500 字重、10% 绿或红底、8px 圆角、padding 2px 8px）；第二行 36px/700 数字，用 tabular-nums；第三行 11px 灰字对比说明。hover 时底色转 #f9fafb、阴影升到 0 4px 12px。

- **States:** hover: ground #f9fafb, shadow up

### Chart Panel

**Role:** 折线、柱状与面积图容器

白底、12px 圆角、1px 描边、内边距 16px。标题 20px/600 与图例同行，图例 11px、色点 8px 圆角。图表本身不留网格竖线，只留水平虚线 1px #f3f4f6。高度固定 280px 或 320px，避免容器抖动。

### Data Table

**Role:** 明细表与活动流

白底、12px 圆角、1px 描边。表头 11px/500 全大写 0.04em、灰底 #f9fafb、高 36px；行高 44px、行间 1px #f3f4f6 分隔、hover 行底色 #f9fafb。数值列右对齐并用等宽字体，状态列用 10% 底芯片。

### Sidebar Rail

**Role:** 左侧导航

宽 240px、近黑填充、白字 70%、固定。项目高 40px、8px 圆角、图标 18px；选中项白 10% 底配纯白，hover 白 6%。分组之间 24px 间距加 1px 白 8% 分隔线。

## Do's and Don'ts

### Do

- KPI 卡只放名称、数字、变化率三件事
- 数字用 tabular-nums 保证列对齐
- 变化率用 10% 底色芯片，不用箭头与强调色块
- 图表只留水平虚线，不放竖网格
- 表格行高 44px，数值右对齐
- 图表高度固定，避免布局抖动

### Don't

- 不要在一张 KPI 卡里塞图表或按钮
- 不要用彩虹配色区分数据系列
- 不要用超过 12px 的卡片圆角
- 不要用重阴影或发光
- 不要让表格行高低于 40px
- 不要把筛选器藏在二级菜单里

## Surfaces

| Level | Name | Value | Purpose |
|---|---|---|---|
| 0 | Mist | `#f9fafb` | 内容画布 |
| 1 | Card White | `#ffffff` | KPI 卡、图表、表格 |
| 2 | Rail | `#111827` | 侧边导航 |

## Elevation

- **Card:** `0 1px 2px rgba(17,24,39,0.06)`
- **Hover:** `0 4px 12px rgba(17,24,39,0.08)`

## Imagery

图表是主要视觉元素，不用摄影。允许头像、产品缩略图与图标。图表配色必须与强调色同源，不用离线彩虹色。

## Layout

侧栏 240px 固定，内容区上限 1600px、内边距 24px。顶部 KPI 行为 12 栏栅格，3 到 4 张卡等宽；下面图表区两栏 2:1；表格满宽。区块间距 24px，卡片间距 16px。

## Agent Prompt Guide

### Implementation Contract

- 以用户请求中的页面、用户任务和真实内容为依据，只实施指定范围；标明缺失的业务信息，不编造数据或能力。
- 先检查现有项目、技术栈与组件；沿用项目结构、路由和依赖，复用已有组件，不重建未要求的页面或功能。
- 沿用项目断点，调整窄屏与桌面的网格和留白；保留信息层级，避免意外横向溢出。
- 对本次涉及的交互，处理键盘焦点与减少动态效果；补齐适用的禁用、加载、空内容与错误状态。
- 完成后按项目现有脚本检查，仅报告实际运行的测试与视觉检查，并列出未验证项。

QUICK COLOR REFERENCE:

- text: `#111827`
- background: `#f9fafb`
- card: `#ffffff`
- accent: `#6366f1`
- positive: `#10b981`
- negative: `#ef4444`

EXAMPLE COMPONENT PROMPTS:

1. 做一个仪表盘 KPI 行：三张白卡（12px 圆角、1px #f3f4f6 描边、内边距 20px、阴影 0 1px 2px rgba(17,24,39,0.06)）。每张卡第一行是 13px #6b7280 指标名，右侧 11px 变化率芯片（10% 绿底 + #10b981 文字、8px 圆角、padding 2px 8px）；第二行 36px/700 数字，font-variant-numeric: tabular-nums；第三行 11px #9ca3af 对比说明。hover 时底色 #f9fafb、阴影升到 0 4px 12px。

## Similar Brands

- **Linear** — 同样的深色侧栏与应用级密度
- **Stripe** — 同为数据密度高的产品界面，但 Stripe 用紫与网格背景

## Quick Start

```css

:root {
  /* Colors */
  --color-near-black: #111827;
  --color-mist: #f9fafb;
  --color-card-white: #ffffff;
  --color-indigo: #6366f1;
  --color-positive: #10b981;
  --color-negative: #ef4444;

  /* Typography — Font Families */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-display: 36px;
  --leading-display: 1.15;
  --tracking-display: -0.02em;
  --text-heading: 20px;
  --leading-heading: 1.3;
  --text-body-lg: 14px;
  --leading-body-lg: 1.5;
  --text-body: 13px;
  --leading-body: 1.5;
  --text-label: 11px;
  --leading-label: 1.4;
  --tracking-label: 0.04em;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;

  /* Layout */
  --page-max-width: 1600px;
  --section-gap: 24px;
  --card-padding: 20px;
  --element-gap: 12px;
  --density: compact;

  /* Border Radius */
  --radius-cards: 12px;
  --radius-buttons: 8px;
  --radius-inputs: 8px;
  --radius-chips: 8px;

  /* Surfaces */
  --surface-mist: #f9fafb;
  --surface-card-white: #ffffff;
  --surface-rail: #111827;
}

```
