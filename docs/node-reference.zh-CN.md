# 节点参考

[English](node-reference.md) · 简体中文

这里按类别列出 31 种公开节点，方便人快速查阅。运行时 Registry 与 Agent capability
manifest 仍是机器可读的最终依据。

## 连线类型

连线传递 `text`、`vector`、`raster`、`alpha`、`layout` 或 `elements`。
内容转换遵循显式的 `text → vector → raster` 阶梯，不会静默换类型。
`elements` 是已经放置的矢量、栅格或 live text 列表；白色 union 插口可以接收旁边
标出的多种类型。

下表的 `?` 表示可选输入。Duplicator 的 `any` 表示
`vector | raster | text | elements`。

## 节点

| 类别 | 节点 | 连线 | 用途 |
| --- | --- | --- | --- |
| 素材 | Text | `→ text` | 生成带填充、描边、字距和模拟字重的 live text。 |
| 素材 | Shape | `→ vector` | 生成矩形、椭圆或多边形。 |
| 素材 | Image | `→ raster` | 把经过校验的 PNG/JPEG/WebP 素材放入 Frame。 |
| 素材 | Noise | `→ raster` | 生成可复现的 value noise 或 grain。 |
| 文字 | Split | `text → elements` | 按字符或单词拆成保留位置的文字元素。 |
| 矢量 | Displace | `vector → vector` | 用固定 seed 的噪声扰动路径点。 |
| 矢量 | Warp | `vector → vector` | 沿 x 或 y 方向做正弦变形。 |
| 矢量 | Boolean | `vector, vector → vector` | 对两个矢量做合并、相减或相交。 |
| 栅格 | Blur | `raster → raster` | 高斯模糊。 |
| 栅格 | Dither | `raster → raster` | 有序色阶抖动。 |
| 栅格 | ASCII | `raster → raster` | 按亮度用等宽字符单元重建图像。 |
| 栅格 | Recolor | `raster → raster` | 把亮度映射为双色渐变。 |
| 栅格 | Chroma Key | `raster → raster` | 按容差和柔化程度去除指定颜色。 |
| 排版 | Grid | `(raster/alpha mask?) → layout` | 生成带权重、间距、流向和可选遮罩的网格槽位。 |
| 排版 | Sample Path | `vector (+ raster/alpha mask?) → layout` | 沿路径等弧长采样槽位。 |
| 排版 | Math Function | `(raster/alpha mask?) → layout` | 沿圆、螺旋或波浪生成槽位。 |
| 排版 | Random | `layout? (+ raster/alpha mask?) → layout` | 随机生成槽位，或给已有 layout 加固定 seed 的扰动。 |
| 排版 | Weight | `layout (+ raster?) → layout` | 写入噪声、亮度、进度或距离等信号通道。 |
| 排版 | Filter | `layout → layout` | 按间隔、阈值或固定随机规则筛选槽位。 |
| 放置 | Duplicator | `any → elements` | 复制内容，并让每份副本拥有独立变换。 |
| 放置 | Place | `elements, layout → elements` | 用 anchor 和信号驱动的变换把元素分配到槽位。 |
| 转换 | Outline Text | `text → vector` | 把字形变成矢量路径。 |
| 转换 | Rasterize | `vector → raster` | 按 Frame 分辨率绘制矢量。 |
| 转换 | Trace | `raster → vector` | 在 Worker 中把像素描成区域或边缘路径。 |
| 转换 | Remove Background | `raster → raster` | 用固定 RMBG-1.4 模型分割前景。 |
| 转换 | Outline Image | `raster → vector` | 沿 alpha 轮廓描出空心矢量边线。 |
| 转换 | To Alpha | `raster → alpha` | 提取亮度或透明度遮罩。 |
| 转换 | Draw Layout | `layout → vector` | 把槽位画成调试几何。 |
| 转换 | Flatten | `elements → vector` | 把矢量元素及其变换烘焙成一个矢量。 |
| 合成 | Composite | `raster/elements ×2 (+ alpha?) → raster` | 用可选遮罩混合底图和叠加内容。 |
| 输出 | Output | `raster/elements → raster` | 合成图层画板，也是节点图的计算根。 |

## 下一步

- 跟着[中文入门教程](getting-started.zh-CN.md#接下来可以玩的三个例子)搭三个小图。
- Agent 会话中调用 `gfx_get_capabilities`，读取当前精确 schema。
- 如果本文与代码不一致，贡献者应以 `src/nodes/index.ts` 和公开 capability manifest
  为准。
