# Node reference

English · [简体中文](node-reference.zh-CN.md)

This is the human-readable map of the 31 public node types. The runtime
registry and Agent capability manifest remain the machine-readable sources of
truth.

## Wire types

Wires carry `text`, `vector`, `raster`, `alpha`, `layout`, or `elements`.
Content moves down the explicit `text → vector → raster` conversion ladder;
nothing silently changes type. `elements` is a list of placed vector, raster,
or live-text values. White union sockets accept the types printed beside them.

`?` below marks an optional input. `any` on Duplicator means
`vector | raster | text | elements`.

## Nodes

| Category | Node | Wires | Purpose |
| --- | --- | --- | --- |
| Assets | Text | `→ text` | Shape live text with fill, stroke, kerning, and synthetic weight. |
| Assets | Shape | `→ vector` | Create a rectangle, ellipse, or polygon with fill and stroke. |
| Assets | Image | `→ raster` | Place a validated PNG/JPEG/WebP asset on the frame. |
| Assets | Noise | `→ raster` | Generate deterministic value noise or grain at frame resolution. |
| Text | Split | `text → elements` | Split live text into positioned character or word elements. |
| Vector | Displace | `vector → vector` | Jitter path points with seeded noise fields. |
| Vector | Warp | `vector → vector` | Apply a sine displacement along the x or y axis. |
| Vector | Boolean | `vector, vector → vector` | Union, subtract, or intersect two vectors. |
| Raster | Blur | `raster → raster` | Apply a separable Gaussian blur. |
| Raster | Dither | `raster → raster` | Apply ordered, level-based dithering. |
| Raster | ASCII | `raster → raster` | Rebuild an image from brightness-selected monospace cells. |
| Raster | Recolor | `raster → raster` | Map luminance onto a two-color ramp. |
| Raster | Chroma Key | `raster → raster` | Remove a selected color with tolerance and softness. |
| Layout | Grid | `(raster/alpha mask?) → layout` | Create weighted row/column slots with gaps, flow, and optional masking. |
| Layout | Sample Path | `vector (+ raster/alpha mask?) → layout` | Sample even arc-length slots along a path. |
| Layout | Math Function | `(raster/alpha mask?) → layout` | Create slots along a circle, spiral, or wave. |
| Layout | Random | `layout? (+ raster/alpha mask?) → layout` | Create random slots or add seeded jitter to an existing layout. |
| Layout | Weight | `layout (+ raster?) → layout` | Write a signal channel such as noise, luma, progress, or distance. |
| Layout | Filter | `layout → layout` | Keep slots by interval, threshold, or seeded chance. |
| Placement | Duplicator | `any → elements` | Make independently transformable copies of content. |
| Placement | Place | `elements, layout → elements` | Assign elements to slots with anchors and signal-driven transforms. |
| Conversion | Outline Text | `text → vector` | Convert glyphs to vector paths. |
| Conversion | Rasterize | `vector → raster` | Draw vector paths at frame resolution. |
| Conversion | Trace | `raster → vector` | Convert pixels to region or edge paths in a worker. |
| Conversion | Remove Background | `raster → raster` | Segment a foreground with the pinned RMBG-1.4 model. |
| Conversion | Outline Image | `raster → vector` | Trace a hollow outline around an alpha silhouette. |
| Conversion | To Alpha | `raster → alpha` | Extract a luminance or alpha mask. |
| Conversion | Draw Layout | `layout → vector` | Draw layout slots as debug geometry. |
| Conversion | Flatten | `elements → vector` | Bake placed vector elements and transforms into one vector. |
| Composition | Composite | `raster/elements ×2 (+ alpha?) → raster` | Blend an overlay and base with optional masking. |
| Output | Output | `raster/elements → raster` | Composite a layer onto its artboard; this is the graph's cook root. |

## Where to go next

- Build three small graphs in [Getting started](getting-started.md#three-things-to-try-next).
- Query the exact current schemas with `gfx_get_capabilities` in an Agent
  session.
- Contributors should treat `src/nodes/index.ts` and the public capability
  manifest as authoritative when this page and code disagree.
