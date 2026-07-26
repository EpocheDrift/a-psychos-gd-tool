// Boolean (vector, vector => vector) — union / subtract / intersect via
// Paper.js in a terminable worker. Inputs are cooperatively flattened on the
// main thread, then the opaque Boolean library call is isolated so an
// AbortSignal/deadline remains enforceable.

import { flattenPaths, boundsOfPaths } from '../engine/path';
import { geometryBudgetFor } from '../engine/geometryBudget';
import type { NodeDef } from '../engine/registry';
import type { VectorValue } from '../engine/values';
import { runBoolean, type BooleanOperation } from './booleanClient';

export const BooleanNode: NodeDef = {
  type: 'Boolean',
  inputs: [
    { name: 'a', type: 'vector' },
    { name: 'b', type: 'vector' },
  ],
  outputs: [{ name: 'out', type: 'vector' }],
  params: [{ name: 'op', kind: 'select', options: ['union', 'subtract', 'intersect'], default: 'subtract' }],
  async cook(inputs, params, ctx) {
    const budget = geometryBudgetFor(ctx);
    const srcA = inputs.a as VectorValue;
    const a = flattenPaths(srcA.paths, 1.5, ctx);
    const b = flattenPaths(
      (inputs.b as VectorValue).paths,
      1.5,
      ctx,
    );
    let points = 0;
    for (const polyline of [...a, ...b]) {
      budget.chargeWork();
      points += polyline.points.length;
      if (!Number.isSafeInteger(points)) {
        points = Number.MAX_SAFE_INTEGER;
        break;
      }
    }
    budget.chargeBooleanPoints(points);
    const paths = await runBoolean(
      a,
      b,
      String(params.op) as BooleanOperation,
      {
        signal: ctx.signal,
        deadline: ctx.deadline,
        revision: ctx.revision,
        maxPendingRequests: ctx.maxPendingWorkerRequests,
        maxBooleanPoints: ctx.maxBooleanPoints,
        maxVectorCommands: ctx.maxVectorCommands,
      },
    );
    budget.chargeVectorPaths(paths.length);
    // the a-side is the operand being carved/kept — its style wins
    const value: VectorValue = {
      kind: 'vector',
      paths,
      bounds: boundsOfPaths(paths, ctx),
      style: srcA.style,
    };
    return { out: value };
  },
};
