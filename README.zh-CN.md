# a-psychos-gd-tool

[English](README.md) · 简体中文

**在线版本：** [a-psychos-gd-tool.vercel.app](https://a-psychos-gd-tool.vercel.app/)

需要支持 WebGPU 的浏览器，例如 Chrome/Edge 113+ 或 Safari 18+。

这是一个运行在浏览器和 GPU 上的节点式平面设计工具。你通过连线搭建海报：
文字可以转成矢量轮廓，矢量可以变形和组合，栅格图像可以模糊、抖动或重新
着色。类型转换全部由显式节点完成，不会在背后偷偷转换。修改参数时，引擎
只重新计算真正受影响的下游节点，因此复杂节点图也能保持交互性。

**状态：** 实验性项目，仍在积极开发中。目前包含 31 种节点、撤销/重做、
带版本的本地工作存档，以及可移植的项目保存/载入。

## 从这里开始

- **第一次使用 Web UI：** 跟着
  [10 分钟中文海报教程](docs/getting-started.zh-CN.md#做出第一张海报)
  完成第一张作品。
- **连接 Codex、Claude Code 或其他 MCP 宿主：** 阅读
  [Agent MCP 入门](docs/getting-started.zh-CN.md#大约-10-分钟接入-agent)。
- **查看完整英文技术说明和节点词典：** 阅读 [English README](README.md)。
- **审阅 Agent-ready v1：** 先看
  [中文审批简报](docs/agent-adaptation/approval-brief.zh-CN.md)，需要技术细节
  时再进入 [Agent 适配文档](docs/agent-adaptation/README.md)。

## 环境要求

- **Node.js 20.19+ 或 22+**（Vite 7 的要求）
- **支持 WebGPU 的浏览器：** Chrome/Edge 113+ 或 Safari 18+
- 只有浏览器渲染需要 GPU；无头引擎测试不需要 GPU

## 快速启动

在已经克隆好的仓库根目录运行：

```sh
./scripts/setup.sh   # 检查 Node、安装依赖、获取自由字体
npm run dev          # 用浏览器打开终端打印的地址
```

应用会打开一个已经开始计算的示例节点图。你可以从节点面板添加节点，在插口
之间拖动连线。插口颜色表示类型，不合法的连接会被直接拒绝。

画布操作类似 Figma：

- 触控板双指滚动平移，捏合缩放；
- `Space` + 拖动，或鼠标中键/右键拖动，也可以平移；
- 左键拖框批量选择节点；
- `⌘`/`Shift` + 点击追加单个节点；
- `Delete` 删除选择内容；
- 多节点移动会记录为一次撤销操作。

常用开发命令：

```sh
npm test              # 应用、Companion 和权限边界测试；不需要 GPU
npm run typecheck     # 应用与 Companion TypeScript 检查
npm run build         # 构建普通应用、Agent 应用和 MCP Companion
npm run check:mcp     # 真实 stdio + Chrome/WebGPU Agent 闭环
```

## 核心概念

### 带类型的连线和转换阶梯

连线中的值有明确类型：`text`、`vector`、`raster`、`alpha`、`layout` 和
`elements`。内容转换遵循：

```text
text → vector → raster
```

例如 `Outline Text` 把文字变为矢量，`Rasterize` 把矢量变为像素，
`Trace` 则可以把像素重新描摹为矢量。转换不会隐式发生；你在图里看到的节点
就是实际计算过程。

### Elements 与排版

`elements` 表示一个或多个待放置的设计元素。`Grid`、`Math Function`、
`Sample Path` 和 `Random` 产生位置槽位，`Place` 决定元素如何进入这些
槽位。一个最小的散布图只需要：

```text
Shape → Place ← Grid
          ↓
        Output
```

### Frame

每个文档有一个统一画板尺寸。`Rasterize`、`Noise`、`Output` 等节点会在
这个尺寸下计算。修改 Frame 时，只会重新计算真正依赖画板尺寸的节点及其
下游。

### Layers

文档是一个有顺序的图层栈，每个图层都是一张独立节点图，并拥有自己的
`Output`。Layers 面板可以：

- 调整图层顺序和可见性；
- 切换当前编辑的节点图；
- 设置透明度和混合模式。

新图层的 `Output` 默认透明，因此可以自然叠加在下面的图层上。各图层拥有
独立缓存，修改一层不会让其他层重新计算。

### 缓存

引擎从 `Output` 向上游按需计算，并使用节点类型、参数和上游内容哈希作为
缓存键。调整一个参数时，上游节点通常命中缓存，只有当前节点和下游需要更新。

## 节点概览

完整插口定义和英文说明见 [English README 的 Nodes 表](README.md#nodes)。

| 类别 | 节点 |
| --- | --- |
| 素材 | Text、Shape、Image、Noise |
| 文字 | Split |
| 矢量 | Displace、Warp、Boolean |
| 栅格效果 | Blur、Dither、ASCII、Recolor、Chroma Key |
| 排版 | Grid、Sample Path、Math Function、Random、Weight、Filter |
| 放置 | Duplicator、Place |
| 类型转换 | Outline Text、Rasterize、Trace、Remove Background、Outline Image、To Alpha、Draw Layout、Flatten |
| 合成 | Composite |
| 输出 | Output |

## 架构

- `src/engine/`：JSON 文档图、节点注册表、按需求值和哈希缓存；
- `src/gpu/`：WebGPU 封装、纹理池和 WGSL shader；
- `src/nodes/`：节点定义，`src/nodes/index.ts` 是节点面板的事实来源；
- `src/store.ts`：Zustand 状态和文档编辑动作；
- `src/editor/`：节点画布、插口和连线；
- `src/util/`：字体、表达式、颜色和噪声工具。

## AI Agent 适配

Agent-ready v1 已实现，并于 2026-07-27 获得项目所有者正式批准。该批准不自动
合并集成 PR，也不等于生产发布或商业许可放行。普通生产构建不会暴露 Agent
全局接口；显式的本地 Agent 构建通过固定 loopback 服务、隔离 Chrome、浏览器
人工配对和 scope 授权，连接到本地 stdio MCP Companion。

默认权限只有 `read` 和 `preview`。下面三类权限需要命令行允许，并在浏览器
中再次由人确认：

- `edit`：原子修改节点图；
- `assets`：上传受限大小、按内容寻址的 PNG/JPEG/WebP；
- `model`：运行固定并经过校验的本地 RMBG-1.4 模型。

这里要区分两层权限：

1. Codex 或 Claude Code 宿主本来拥有的 shell、工作区、网络等权限，由宿主
   环境和用户批准策略管理；
2. 本项目的 Graphic Design MCP 只提供经过 allowlist 的设计工具，不会额外
   变成 shell、通用文件系统、任意 URL、CDP、页面执行或浏览器导航入口。

换句话说，这个项目保证的是 **MCP 自己保持窄边界**，而不是替其他 Agent
宿主撤销它们已经拥有的权限。

构建与使用方式见 [MCP Companion 文档](packages/mcp-companion/README.md)；
方案、风险和交付证据见
[`docs/agent-adaptation/`](docs/agent-adaptation/README.md)。

## 浏览器与 Agent 验证

完整 WebGPU smoke suite：

```sh
npm run smoke:serve
npm run smoke:all
```

`smoke:serve` 构建并服务固定的 `dist-agent` 静态产物，不是 Agent 源码开发
服务器。普通代码和产物安全检查可以运行：

```sh
npm run check:agent-build
npm run check:mcp
```

具体测试、fixture 和浏览器要求见
[Browser and WebGPU smoke tests](docs/testing/browser-smoke.md)。

## 路线图

已经完成：

1. 引擎、节点编辑器和带类型连线；
2. 文字、矢量、栅格、排版、放置与合成节点；
3. 多图层、Frame、缓存、撤销/重做；
4. PNG 导出、工作存档和项目保存/载入；
5. 内容寻址图片素材和固定 RMBG-1.4 去背景；
6. 本地 Agent MCP、浏览器配对、权限控制和闭环视觉评测。

计划中：

- 更多异步模型节点；
- 可编辑路径的 `.ai`/SVG 导出；
- 栅格和 Frame 裁切节点；
- 更多文字、矢量、栅格和 elements 操作。

## 参与贡献

欢迎提交 Issue 和 PR。CI 会运行 TypeScript 检查、应用与 Companion 测试、
普通/Agent 构建、真实 MCP/Chrome 闭环和 Agent 产物安全检查。修改渲染或
Agent runtime 时，还应运行：

```sh
npm run check:mcp
npm run check:agent-build
```

## 许可证

项目使用 [MIT License](LICENSE)。

仓库中的 [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)
（`public/fonts/`）使用
[SIL Open Font License 1.1](public/fonts/OFL.txt)。
