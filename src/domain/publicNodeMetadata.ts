import type { ParamSpec } from '../engine/registry';

export type GpuRequirement = 'none' | 'optional' | 'required';
export type ExecutionRuntime = 'cpu' | 'gpu' | 'worker' | 'model';
export type ExecutionNetwork = 'none' | 'asset-read' | 'model-download';
export type ExecutionCost = 'low' | 'medium' | 'high';

export interface NodePublicMetadata {
  description: string;
  gpuRequirement: GpuRequirement;
  asynchronous: boolean;
  expensive: boolean;
  externalDownload: boolean;
  execution: {
    runtime: ExecutionRuntime;
    network: ExecutionNetwork;
    cost: ExecutionCost;
    deterministic: boolean;
  };
}

function metadata(
  description: string,
  runtime: ExecutionRuntime,
  cost: ExecutionCost,
  options: {
    gpu?: GpuRequirement;
    asynchronous?: boolean;
    expensive?: boolean;
    network?: ExecutionNetwork;
    deterministic?: boolean;
    externalDownload?: boolean;
  } = {},
): NodePublicMetadata {
  return {
    description,
    gpuRequirement: options.gpu ?? 'none',
    asynchronous: options.asynchronous ?? false,
    expensive: options.expensive ?? false,
    externalDownload: options.externalDownload ?? false,
    execution: {
      runtime,
      network: options.network ?? 'none',
      cost,
      deterministic: options.deterministic ?? true,
    },
  };
}

/** Pure public metadata. Executable cook functions are deliberately absent. */
export const NODE_PUBLIC_METADATA: Readonly<Record<string, NodePublicMetadata>> = Object.freeze({
  Text: metadata('Shapes editable text with a resolved font and emits live text with fill, stroke, and synthetic weight styling.', 'cpu', 'low'),
  Shape: metadata('Generates a centered rectangle, ellipse, or polygon as styled vector geometry.', 'cpu', 'low'),
  Image: metadata('Decodes an approved embedded or bundled image and fits, transforms, and uploads it to a frame-sized transparent raster.', 'cpu', 'medium', {
    gpu: 'required',
    asynchronous: true,
    expensive: true,
    network: 'asset-read',
  }),
  Noise: metadata('Generates a deterministic seeded value-noise or grain raster at the document frame size.', 'cpu', 'high', {
    gpu: 'required',
    expensive: true,
  }),
  Split: metadata('Splits live text into character or word elements while preserving shaped positions.', 'cpu', 'low'),
  Displace: metadata('Displaces flattened vector points with deterministic seeded noise.', 'cpu', 'medium'),
  Warp: metadata('Applies a sinusoidal warp to vector geometry along the selected axis.', 'cpu', 'medium'),
  Boolean: metadata('Combines two vector inputs with union, subtraction, or intersection.', 'cpu', 'high', {
    expensive: true,
  }),
  Blur: metadata('Applies a separable Gaussian blur to a raster.', 'gpu', 'high', {
    gpu: 'required',
    expensive: true,
  }),
  Dither: metadata('Applies ordered Bayer dithering with configurable quantization levels and cell scale.', 'gpu', 'medium', {
    gpu: 'required',
  }),
  ASCII: metadata('Reconstructs a raster with cells sampled through a built-in ASCII glyph ramp.', 'gpu', 'medium', {
    gpu: 'required',
  }),
  Recolor: metadata('Maps raster luminance between configurable dark and light colors.', 'gpu', 'low', {
    gpu: 'required',
  }),
  ChromaKey: metadata('Reduces raster alpha around a selected key color with tolerance and softness.', 'gpu', 'low', {
    gpu: 'required',
  }),
  Grid: metadata('Creates a frame-aware grid layout with configurable tracks, padding, flow, and an optional mask.', 'cpu', 'medium', {
    gpu: 'optional',
    asynchronous: true,
    expensive: true,
  }),
  SamplePath: metadata('Samples a vector path at even arc-length intervals to produce layout placements.', 'cpu', 'high', {
    gpu: 'optional',
    asynchronous: true,
    expensive: true,
  }),
  Function: metadata('Generates circle, spiral, or wave layout placements at a requested spacing.', 'cpu', 'high', {
    gpu: 'optional',
    asynchronous: true,
    expensive: true,
  }),
  Random: metadata('Generates seeded random placements or jitters an existing layout, optionally constrained by a mask.', 'cpu', 'high', {
    gpu: 'optional',
    asynchronous: true,
    expensive: true,
  }),
  Weight: metadata('Writes a named layout signal from noise, image sampling, geometry, progress, or a safe arithmetic expression.', 'cpu', 'medium', {
    gpu: 'optional',
    asynchronous: true,
    expensive: true,
  }),
  Filter: metadata('Removes layout placements by interval, signal threshold, or seeded random selection.', 'cpu', 'low'),
  Duplicator: metadata('Repeats vector, raster, text, or element content into an indexed element collection.', 'cpu', 'high', {
    expensive: true,
  }),
  Place: metadata('Maps elements onto layout placements and applies channel-driven scale, rotation, or blur bindings.', 'cpu', 'high', {
    expensive: true,
  }),
  Outline: metadata('Converts live text glyphs into styled vector paths using the resolved font.', 'cpu', 'medium'),
  Rasterize: metadata('Centers and paints vector geometry into a frame-sized transparent raster.', 'cpu', 'medium', {
    gpu: 'required',
  }),
  Trace: metadata('Reads back a raster and traces filled regions or Sobel edges into vector paths in a worker.', 'worker', 'high', {
    gpu: 'required',
    asynchronous: true,
    expensive: true,
  }),
  RemoveBackground: metadata('Segments the foreground with the RMBG model and writes the mask into raster alpha.', 'model', 'high', {
    gpu: 'required',
    asynchronous: true,
    expensive: true,
    network: 'model-download',
    deterministic: false,
    externalDownload: true,
  }),
  OutlineImage: metadata('Reads back raster alpha and traces a hollow vector outline around its silhouette in a worker.', 'worker', 'high', {
    gpu: 'required',
    asynchronous: true,
    expensive: true,
  }),
  ToAlpha: metadata('Converts raster luminance or alpha into a thresholded, optionally softened alpha mask.', 'gpu', 'low', {
    gpu: 'required',
  }),
  DrawLayout: metadata('Draws layout cells, points, and rotation ticks as vector geometry.', 'cpu', 'medium'),
  Flatten: metadata('Bakes text/vector element transforms into one vector value; raster elements are unsupported.', 'cpu', 'high', {
    expensive: true,
  }),
  Composite: metadata('Blends base and overlay raster/elements inputs with opacity and an optional alpha mask.', 'gpu', 'high', {
    gpu: 'required',
  }),
  Output: metadata('Renders optional raster or elements content over a solid or transparent frame and serves as the layer root.', 'gpu', 'medium', {
    gpu: 'required',
  }),
});

export type ParamFormat =
  | 'plain-text-v1'
  | 'font-key-v1'
  | 'positive-number-list-v1'
  | 'math-expression-v1'
  | 'channel-name-v1'
  | 'image-data-uri-v1'
  | 'asset-id-v1'
  | 'binds-json-string-v1';

export interface ParamPublicMetadata {
  description: string;
  integer?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxBytes?: number;
  format?: ParamFormat;
  expressionVariables?: readonly string[];
  agentWritable?: boolean;
}

const INTEGER_PARAMS = new Set([
  'Shape.sides',
  'Duplicator.count',
  'Grid.columns',
  'Grid.rows',
  'Filter.n',
  'OutlineImage.thickness',
  'Noise.seed',
  'Displace.seed',
  'Random.seed',
  'Weight.seed',
  'Filter.seed',
  'Place.seed',
  'Dither.levels',
  'Dither.scale',
  'ASCII.cell',
  'Trace.minArea',
  'OutlineImage.minArea',
  'OutlineImage.threshold',
]);

const PARAM_OVERRIDES: Readonly<Record<string, Partial<ParamPublicMetadata>>> = Object.freeze({
  'Text.content': { format: 'plain-text-v1', maxLength: 65_536, maxBytes: 65_536 },
  'Text.font': {
    format: 'font-key-v1',
    minLength: 1,
    maxLength: 128,
    agentWritable: false,
  },
  'Grid.weightsX': { format: 'positive-number-list-v1', maxLength: 2_048, maxBytes: 2_048 },
  'Grid.weightsY': { format: 'positive-number-list-v1', maxLength: 2_048, maxBytes: 2_048 },
  'Grid.exprX': {
    format: 'math-expression-v1',
    maxLength: 2_048,
    maxBytes: 2_048,
    expressionVariables: ['i', 'n', 't'],
  },
  'Grid.exprY': {
    format: 'math-expression-v1',
    maxLength: 2_048,
    maxBytes: 2_048,
    expressionVariables: ['i', 'n', 't'],
  },
  'Weight.expr': {
    format: 'math-expression-v1',
    maxLength: 2_048,
    maxBytes: 2_048,
    expressionVariables: ['i', 'n', 'progress', 't', 'x', 'y', 'w'],
  },
  'Image.src': {
    format: 'image-data-uri-v1',
    agentWritable: false,
  },
  'Image.assetId': {
    format: 'asset-id-v1',
    minLength: 0,
    maxLength: 70,
    maxBytes: 70,
    agentWritable: true,
  },
  'Filter.channel': {
    format: 'channel-name-v1',
    minLength: 1,
    maxLength: 128,
  },
  'Place.binds': {
    format: 'binds-json-string-v1',
    agentWritable: true,
  },
  'Blur.radius': { maximum: 4096 },
});

const PARAM_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  'Text.content': 'The Unicode text content to shape.',
  'Text.font': 'A human-selected font key available in the current document session.',
  'Image.src': 'An approved embedded PNG, JPEG, or WebP data URI, the bundled factory image, or an empty value.',
  'Image.assetId': 'An empty value or a content-addressed image asset ID already present in this project.',
  'Grid.weightsX': 'A comma- or whitespace-separated list of positive horizontal track weights.',
  'Grid.weightsY': 'A comma- or whitespace-separated list of positive vertical track weights.',
  'Grid.exprX': 'A safe arithmetic expression over i, n, and t for horizontal track weights.',
  'Grid.exprY': 'A safe arithmetic expression over i, n, and t for vertical track weights.',
  'Weight.expr': 'A safe arithmetic expression used to author the selected layout channel.',
  'Filter.channel': 'The built-in or Weight-authored layout channel to test.',
  'Place.binds': 'Structured channel bindings encoded as JSON in persisted version 3 documents.',
});

function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

export function getParamPublicMetadata(
  nodeType: string,
  param: ParamSpec,
): ParamPublicMetadata {
  const key = `${nodeType}.${param.name}`;
  const override = PARAM_OVERRIDES[key] ?? {};
  const generic: Partial<ParamPublicMetadata> =
    param.kind === 'channel'
      ? { format: 'channel-name-v1', minLength: 1, maxLength: 128 }
      : param.kind === 'image'
        ? {
            format: 'asset-id-v1',
            minLength: 0,
            maxLength: 70,
            maxBytes: 70,
            agentWritable: true,
          }
        : param.kind === 'binds'
          ? { format: 'binds-json-string-v1' }
          : param.kind === 'string'
            ? { format: 'plain-text-v1', maxLength: 65_536, maxBytes: 65_536 }
            : {};
  return {
    description:
      PARAM_DESCRIPTION_OVERRIDES[key]
      ?? `Configures ${humanize(param.name)} for the ${nodeType} node.`,
    ...generic,
    ...(INTEGER_PARAMS.has(key) ? { integer: true } : {}),
    ...override,
  };
}
