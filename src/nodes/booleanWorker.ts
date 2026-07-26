import paper from 'paper';
import type { Polyline } from '../engine/path';
import type { PathCmd } from '../engine/values';
import type { BooleanOperation } from './booleanClient';

interface Request {
  id: number;
  a: Polyline[];
  b: Polyline[];
  op: BooleanOperation;
  maxBooleanPoints: number;
  maxVectorCommands: number;
  timeoutMs?: number;
  deadline?: number;
}

const post = (
  self as unknown as { postMessage: (message: unknown) => void }
).postMessage.bind(self);

let paperReady = false;

self.onmessage = (event: MessageEvent<Request>) => {
  const received = event.data;
  const request: Request = {
    ...received,
    ...(
      typeof received.timeoutMs === 'number'
      && Number.isFinite(received.timeoutMs)
        ? { deadline: performance.now() + Math.max(0, received.timeoutMs) }
        : {}
    ),
  };
  try {
    throwIfExpired(request);
    validateRequest(request);
    const left = toPaperItem(request.a, request);
    const right = toPaperItem(request.b, request);
    let result: paper.PathItem | null = null;
    try {
      // Paper.js is opaque synchronous work. The main-thread broker enforces
      // the deadline by terminating this worker if the operation stalls.
      switch (request.op) {
        case 'union':
          result = left.unite(right, { insert: false });
          break;
        case 'intersect':
          result = left.intersect(right, { insert: false });
          break;
        default:
          result = left.subtract(right, { insert: false });
      }
      throwIfExpired(request);
      post({ id: request.id, paths: fromPaperItem(result, request) });
    } finally {
      result?.remove();
      left.remove();
      right.remove();
    }
  } catch (error) {
    const code = (
      error !== null
      && typeof error === 'object'
      && (
        (error as { code?: unknown }).code === 'TIMEOUT'
        || (error as { code?: unknown }).code === 'RESOURCE_LIMIT'
      )
    )
      ? (error as { code: 'TIMEOUT' | 'RESOURCE_LIMIT' }).code
      : undefined;
    post({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
      ...(code ? { code } : {}),
    });
  }
};

function setupPaper(): typeof paper {
  if (!paperReady) {
    paper.setup(new paper.Size(1, 1));
    paperReady = true;
  }
  return paper;
}

function validateRequest(request: Request): void {
  if (
    !Number.isSafeInteger(request.maxBooleanPoints)
    || request.maxBooleanPoints <= 0
    || !Number.isSafeInteger(request.maxVectorCommands)
    || request.maxVectorCommands <= 0
  ) {
    throw resourceLimit('Boolean worker received invalid limits.');
  }
  let points = 0;
  for (const operand of [request.a, request.b]) {
    if (!Array.isArray(operand)) {
      throw resourceLimit('Boolean worker received malformed operands.');
    }
    for (const polyline of operand) {
      throwIfExpired(request);
      if (!Array.isArray(polyline.points)) {
        throw resourceLimit('Boolean worker received a malformed polyline.');
      }
      points += polyline.points.length;
      if (
        !Number.isSafeInteger(points)
        || points > request.maxBooleanPoints
      ) {
        throw resourceLimit(
          `Boolean operands exceed ${request.maxBooleanPoints} points.`,
        );
      }
    }
  }
}

function toPaperItem(
  polylines: Polyline[],
  request: Request,
): paper.PathItem {
  const Paper = setupPaper();
  const children: paper.Path[] = [];
  for (const polyline of polylines) {
    throwIfExpired(request);
    if (polyline.points.length < 2) continue;
    children.push(new Paper.Path({
      segments: polyline.points.map((point) => [point.x, point.y]),
      closed: true,
      insert: false,
    }));
  }
  if (children.length === 1) return children[0];
  return new Paper.CompoundPath({ children, insert: false });
}

function fromPaperItem(
  item: paper.PathItem,
  request: Request,
): PathCmd[][] {
  const paths = item instanceof paper.CompoundPath
    ? item.children as paper.Path[]
    : [item as paper.Path];
  const output: PathCmd[][] = [];
  let commands = 0;
  for (const path of paths) {
    throwIfExpired(request);
    if (path.segments.length < 2) continue;
    const projected = commands + path.segments.length + 1;
    if (
      !Number.isSafeInteger(projected)
      || projected > request.maxVectorCommands
    ) {
      throw resourceLimit(
        `Boolean output exceeds ${request.maxVectorCommands} vector commands.`,
      );
    }
    commands = projected;
    const pathCommands: PathCmd[] = [{
      type: 'M',
      x: path.segments[0].point.x,
      y: path.segments[0].point.y,
    }];
    for (let index = 1; index < path.segments.length; index++) {
      if ((index & 255) === 0) throwIfExpired(request);
      pathCommands.push({
        type: 'L',
        x: path.segments[index].point.x,
        y: path.segments[index].point.y,
      });
    }
    pathCommands.push({ type: 'Z' });
    output.push(pathCommands);
  }
  return output;
}

function throwIfExpired(request: Request): void {
  if (
    typeof request.deadline === 'number'
    && Number.isFinite(request.deadline)
    && performance.now() >= request.deadline
  ) {
    throw Object.assign(
      new Error('Boolean worker request exceeded its deadline.'),
      { code: 'TIMEOUT' as const },
    );
  }
}

function resourceLimit(message: string): Error {
  return Object.assign(
    new Error(message),
    { code: 'RESOURCE_LIMIT' as const },
  );
}
