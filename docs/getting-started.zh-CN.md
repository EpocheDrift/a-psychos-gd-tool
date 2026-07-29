# 从零开始

[English](getting-started.md)

这份指南会带你从克隆仓库开始，做出第一张真正能工作的海报，然后把 AI
Agent 通过本地 MCP Companion 连接进来。你不需要提前用过节点编辑器。

## 需要准备什么

- Node.js 20.19+ 或 22+
- 支持 WebGPU 的浏览器：Chrome/Edge 113+ 或 Safari 18+
- Git
- 如果要玩 Agent：Codex、Claude Code 等 MCP 客户端，以及支持 WebGPU 的
  Chrome/Chromium

线上版本适合直接体验人类操作的 Web UI。Agent/MCP 需要在本地使用，因为
Companion 会启动一个只监听本机回环地址的应用和一份隔离的浏览器会话。

## 克隆并启动 Web UI

从 GitHub 复制仓库地址，然后执行：

```sh
git clone <repository-url> a-psychos-gd-tool
cd a-psychos-gd-tool
./scripts/setup.sh
npm run dev
```

用支持 WebGPU 的浏览器打开 Vite 在终端里打印的网址。`setup.sh` 会检查 Node、
安装依赖并下载项目自带的免费字体；重复执行也是安全的。

应用启动后会打开一个已经在渲染的空白工程：里面只有一个图层和一个
**Output** 节点。左边是节点图，右边是画板，浮动的 **layers** 面板决定你当前
正在编辑哪一个图层的节点图。如果想先拆解成品，可以在画板上方的
**start from…** 中手动选择 **Layered poster example**。

常用画布操作：

- 双指滚动平移，捏合缩放。
- 按住空格拖动、鼠标中键拖动或右键拖动也可以平移。
- 在空白处左键拖框可以框选节点。
- Command/Ctrl 点击或 Shift 点击可以追加选择节点。
- Delete/Backspace 删除当前选择。
- Command/Ctrl-Z 撤销，Command/Ctrl-Shift-Z 重做。

## 做出第一张海报

我们要搭出下面这条带类型的处理链：

```text
Text.out
  → Outline Text.text
  → Warp.in
  → Rasterize.vector
  → Recolor.in
  → Output.in
```

### 1. 直接使用空白图层

初始图层已经自带一个不透明的白色 **Output**，所以可以直接在这里搭处理链。
如果在 **layers** 面板点击 `+` 新增图层，新图层的 Output 默认透明，让下面的
图层继续显示；如果要让新图层成为独立海报，就关闭 **transparent**，再选择
背景色。

### 2. 加入五个处理节点

在左侧节点面板展开对应分类并依次点击：

1. **Assets → Text**
2. **Conversion → Outline Text**
3. **Vector ops → Warp**
4. **Conversion → Rasterize**
5. **Raster ops → Recolor**

每次点击都会把节点放在当前视野里没有被占用的位置。拖动节点标题，把它们从左到右
排好。图层自带的 Output 直接复用，不需要再新建一个。

### 3. 连接插口

从每个输出插口拖到下一个输入插口：

1. `Text.out` → `Outline Text.text`
2. `Outline Text.out` → `Warp.in`
3. `Warp.out` → `Rasterize.vector`
4. `Rasterize.out` → `Recolor.in`
5. `Recolor.out` → `Output.in`

插口颜色代表数据类型。如果类型不兼容，或者连线会制造循环，应用会直接拒绝，而
不会在背后偷偷转换。

### 4. 开始设计

可以先试着调这些参数：

- **Text：**修改 `content`、`fontSize`、`weight` 和 `fill`。
- **Warp：**修改 `axis`、`amplitude`、`wavelength` 和 `phase`。
- **Recolor：**给双色映射选择一个深色和一个浅色。
- **Output：**选择图层是否透明；不透明时再设置背景色。
- **Frame：**用画板上方的按钮选择预设，直接输入宽高，或者交换横竖方向。

每次修改参数，右边画板都会重新渲染。Rasterize 是明确的“矢量变像素”步骤，所以
Recolor 能接它的输出，却不能直接接还没变成像素的 Text 或 Warp。

## 保存、载入和导出

画板上方的工程操作用途不同：

- **start from…** 会在确认后用全新的空白工程或内置示例替换当前工程。如果还想
  保留现在的节点图，请先保存。
- **save project** 下载一份可移植的 `.gfxproject.json`，其中也包含已经导入的
  图片资源。以后想继续编辑节点图，就保存它。
- **load project** 用兼容的工程文件替换当前文档。如果当前作品还需要，载入前先
  保存。
- **export png** 下载当前这一版渲染出来的准确 PNG。只有最新文档 revision 已经
  渲染完成时，它才会变成可点击状态。

应用也会把带版本的工作数据保存在浏览器存储里。不过真正适合备份和换机器使用的，
仍然是下载出来的工程文件。

## 接下来可以玩的三个例子

### 环形或波浪文字

把两条输入一起接进 Place：

```text
Text → Split ───────────────→ Place.elements
Math Function ──────────────→ Place.layout
Place.out → Output.in
```

Split 会把一句文字拆成多个仍然保持文字属性的元素；Math Function 提供圆、螺旋或
波浪形槽位；Place 再把字符分配到这些槽位上。

### 重复图形系统

```text
Shape → Duplicator ─────────→ Place.elements
Grid ───────────────────────→ Place.layout
Place.out → Output.in
```

可以修改多边形、复制数量、网格行列和间距。再把 Random 接在 Grid 后面，就能加入
固定随机种子的位移、旋转或大小变化。

### 图片效果海报

```text
Image → Blur → Dither → Recolor → Output
```

在 Image 节点点击 **upload**，选择 PNG、JPEG 或 WebP，然后尝试 Image 的
fit/scale 和各个效果参数。进阶版可以加入 Remove Background；它会运行
RMBG-1.4，第一次使用时可能需要下载模型。

## 大约 10 分钟接入 Agent

MCP Companion 给 Agent 的是一套刻意收窄的设计 API。它不会提供 shell、任意文件
系统、任意网络、浏览器导航、页面代码执行或鼠标控制工具。你的 MCP 宿主本身可能
另外拥有这些权限，但 Companion 仍然只接受明确命名的 `gfx_*` 操作，以及你在
浏览器中批准的权限。

### 1. 构建 Agent 产物

在仓库根目录执行：

```sh
npm install
npm run build:agent
npm run build:mcp
```

### 2. 两种启动方式只选一种

同一次使用不要把下面两种方式混在一起。

#### 方式 A——让 MCP 客户端启动（推荐）

在 MCP 客户端中配置构建后的入口，而且必须使用绝对路径：

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/a-psychos-gd-tool/packages/mcp-companion/dist/index.js"
  ]
}
```

修改配置后重新加载或重启 MCP 客户端。客户端会在需要时自己启动并管理这个 stdio
进程，所以不要再去另一个终端同时运行 `npm run mcp:start`。

#### 方式 B——手动启动

需要直接观察或调试时，可以运行：

```sh
npm run mcp:start
```

这条命令会构建并启动同一套 stdio Companion。此时不要再让另一个 MCP 客户端启动
第二份进程，因为固定的 `127.0.0.1:5199` 端口只能被一个进程占用。

### 3. 先从只读开始

不加任何 flag 时，Companion 只请求 `read` 和 `preview`。默认六个工具可以读取
能力、文档和渲染状态，验证文档，等待渲染，以及取得预览。

隔离的 Chrome 窗口打开后：

1. 点击 **Connect Agent**。
2. 检查它请求的权限。
3. 只勾选这次确实需要的 scope。
4. 批准连接。

进程重启、页面刷新、30 分钟过期、连接中断或点击 **Revoke now** 后，都需要重新
配对。

第一次可以把这句话发给 Agent：

> 先调用 `gfx_get_capabilities` 和 `gfx_get_document`，不要做任何修改。告诉我当前
> frame、revision、layers 和可用节点类型，然后等我确认。

### 4. 确认后再增加编辑权限

先停止只读会话，再在客户端配置的 `args` 中增加 `--allow-edit`：

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/a-psychos-gd-tool/packages/mcp-companion/dist/index.js",
    "--allow-edit"
  ]
}
```

如果采用手动启动，则执行：

```sh
npm run mcp:start -- --allow-edit
```

重新连接，在 Chrome 里勾选 `edit` scope 并批准。命令行允许和浏览器授权两层都要
满足，缺一不可。

第一次写入可以把这句话发给 Agent：

> 先读取当前文档和能力。新建一个图层，不要修改已有图层；用一次原子事务创建
> Text → Outline Text → Warp → Rasterize → Recolor → Output。使用稳定的
> request ID 和当前 expected revision。等待这次提交对应的准确 render revision
> 完成，再取得预览，并告诉我新建的图层/节点 ID、采用的参数和最终 revision。

每次写入都会检查 revision，并且保持原子性和幂等性。“事务提交成功”和“画面渲染
成功”是两件独立的事，所以让 Agent 等待准确 revision 再拿预览，可以避免把旧画面
当成新结果。

### 5. 只有任务需要时才增加其他权限

- `--allow-assets` 加浏览器里的 `assets` 授权，会开放有大小边界、按内容寻址的
  图片上传/列表/元数据/删除工具。宿主 Agent 可以用它自己获批的权限读取本地文件，
  再通过 `gfx_put_asset` 传入图片；Companion 本身并不会因此获得通用文件系统权限。
- `--allow-model` 加浏览器里的 `model` 授权，会开放固定本地 RMBG-1.4 模型的状态
  和准备工具。第一次下载仍然需要人在 Chrome 里另行查看许可证并点击确认。

这些 flag 可以组合，但一开始就全部开放，会失去渐进审批的意义。

## 常见问题

### 浏览器不支持 WebGPU

换用受支持的浏览器，并确认硬件加速和 WebGPU 已经开启。没有 WebGPU，Web UI
无法渲染海报。

### 应用提示找不到字体

执行：

```sh
./scripts/get-font.sh
```

然后重启开发服务器。

### 连线怎么都接不上

检查插口名称和颜色。节点图只允许兼容类型，而且不允许循环。记住这里的明确转换
顺序：`text → vector → raster`。

### 新图层为什么是透明的

这样可以直接叠加在下面的图层上。如果希望它自己铺满画板，关闭新图层 Output
的 **transparent** 并设置背景色。

### export png 按钮不能点击

等待最新修改渲染完成。如果某个节点报错，要先解决报错；PNG 导出必须对应当前
revision 的准确渲染结果。

### Agent 返回 `PAIRING_NOT_APPROVED`

切回隔离的 Chrome 窗口，点击 **Connect Agent**，勾选请求的权限并批准。刷新页面
或重启进程以后，旧批准会失效。

### 找不到预期的 MCP 工具

进程 flag 决定这个工具是否存在，浏览器审批决定它能不能真正执行。用匹配的
`--allow-*` flag 重启进程，并在 Chrome 里批准同名 scope。

### Agent 返回 revision 冲突

让它重新调用 `gfx_get_document`，取得最新 `expectedRevision` 后再重试。不要把
旧事务不加检查地重复应用到已经变化的文档上。

### 5199 端口已被占用

停止另一份 Companion 进程。固定的本机回环地址是安全设计的一部分，因此不会自动
换到其他端口。

### Chrome 没有自动启动

手动指定可执行文件：

```sh
npm run mcp:start -- --chrome /absolute/path/to/chrome
```

如果由客户端管理进程，就在 `args` 末尾追加 `"--chrome"` 和 Chrome 的绝对路径，
或者设置 `CHROME` 环境变量。

完整的工具、安全、生命周期和验证细节，请继续阅读
[本地 MCP Companion 参考文档](../packages/mcp-companion/README.md)。
