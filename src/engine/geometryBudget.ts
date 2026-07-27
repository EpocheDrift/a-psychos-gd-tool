import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import {
  CookResourceLimitError,
  throwIfCookInterrupted,
  type CookControl,
} from './cookControl';

export interface GeometryBudgetControl extends CookControl {
  maxVectorPaths?: number;
  maxVectorCommands?: number;
  maxCanvasPaintPaths?: number;
  maxCanvasPaintCommands?: number;
  maxFlattenedPoints?: number;
  maxBooleanPoints?: number;
  maxGeometryWorkUnits?: number;
  maxRenderableGlyphs?: number;
  maxGeneratedItems?: number;
  geometryBudget?: GeometryBudget;
}

export interface GeometryBudgetSnapshot {
  vectorPaths: number;
  vectorCommands: number;
  flattenedPoints: number;
  booleanPoints: number;
  geometryWorkUnits: number;
  renderableGlyphs: number;
}

type CounterName = keyof GeometryBudgetSnapshot;

const COUNTER_LABELS: Record<CounterName, string> = {
  vectorPaths: 'Vector path containers',
  vectorCommands: 'Vector command work',
  flattenedPoints: 'Flattened path points',
  booleanPoints: 'Boolean operand points',
  geometryWorkUnits: 'Geometry work',
  renderableGlyphs: 'Renderable glyph work',
};

/**
 * Attempt-scoped accounting for synchronous geometry. The coordinator's timer
 * cannot fire while JavaScript owns the main thread, so every bounded loop also
 * checks the absolute deadline directly through this object.
 */
export class GeometryBudget {
  private readonly counts: GeometryBudgetSnapshot = {
    vectorPaths: 0,
    vectorCommands: 0,
    flattenedPoints: 0,
    booleanPoints: 0,
    geometryWorkUnits: 0,
    renderableGlyphs: 0,
  };

  private nextInterruptCheck = 0;

  constructor(private readonly control: GeometryBudgetControl = {}) {
    throwIfCookInterrupted(control);
  }

  snapshot(): GeometryBudgetSnapshot {
    return { ...this.counts };
  }

  checkInterrupt(): void {
    throwIfCookInterrupted(this.control);
  }

  chargeWork(units = 1): void {
    this.charge(
      'geometryWorkUnits',
      units,
      this.limit('maxGeometryWorkUnits'),
      false,
    );
    if (this.counts.geometryWorkUnits >= this.nextInterruptCheck) {
      this.nextInterruptCheck = this.counts.geometryWorkUnits + 256;
      this.checkInterrupt();
    }
  }

  chargeVectorCommands(commands = 1): void {
    this.charge(
      'vectorCommands',
      commands,
      this.limit('maxVectorCommands'),
    );
  }

  chargeVectorPaths(paths = 1): void {
    this.charge(
      'vectorPaths',
      paths,
      this.limit('maxVectorPaths'),
    );
  }

  /**
   * Preflight one combined Path2D before an opaque Canvas2D fill/stroke/clip.
   * These limits are per call, not attempt-cumulative: many small factory
   * paints remain valid while one uninterruptible native call stays bounded.
   */
  assertCanvasPaint(pathCount: number, commandCount: number): void {
    this.checkInterrupt();
    this.assertPeak(
      'Canvas paint path count',
      pathCount,
      this.limit('maxCanvasPaintPaths'),
    );
    this.assertPeak(
      'Canvas paint command count',
      commandCount,
      this.limit('maxCanvasPaintCommands'),
    );
  }

  chargeFlattenedPoints(points = 1): void {
    this.charge(
      'flattenedPoints',
      points,
      this.limit('maxFlattenedPoints'),
    );
  }

  chargeBooleanPoints(points = 1): void {
    this.charge(
      'booleanPoints',
      points,
      this.limit('maxBooleanPoints'),
    );
  }

  chargeGlyphs(glyphs = 1): void {
    this.charge(
      'renderableGlyphs',
      glyphs,
      this.limit('maxRenderableGlyphs'),
    );
  }

  assertGeneratedItems(actual: number): void {
    this.checkInterrupt();
    const maximum = this.limit('maxGeneratedItems');
    if (
      !Number.isSafeInteger(actual)
      || actual < 0
      || actual > maximum
    ) {
      throw new CookResourceLimitError(
        `Generated item count exceeds the configured maximum of ${maximum}.`,
        {
          actualAtLeast: Number.isSafeInteger(actual)
            ? Math.max(0, actual)
            : maximum + 1,
          maximum,
        },
      );
    }
  }

  private charge(
    name: CounterName,
    amount: number,
    maximum: number,
    chargeWork = true,
  ): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new CookResourceLimitError(
        `${COUNTER_LABELS[name]} accounting received an invalid amount.`,
        { actualAtLeast: maximum + 1, maximum },
      );
    }
    const current = this.counts[name];
    if (amount > maximum - current) {
      throw new CookResourceLimitError(
        `${COUNTER_LABELS[name]} exceeds the configured maximum of ${maximum}.`,
        {
          actualAtLeast: Math.min(
            Number.MAX_SAFE_INTEGER,
            current + Math.max(1, amount),
          ),
          maximum,
        },
      );
    }
    this.counts[name] = current + amount;
    if (chargeWork && amount > 0) this.chargeWork(amount);
  }

  private assertPeak(label: string, actual: number, maximum: number): void {
    if (
      !Number.isSafeInteger(actual)
      || actual < 0
      || actual > maximum
    ) {
      throw new CookResourceLimitError(
        `${label} exceeds the configured maximum of ${maximum}.`,
        {
          actualAtLeast: Number.isSafeInteger(actual)
            ? Math.max(0, actual)
            : maximum + 1,
          maximum,
        },
      );
    }
  }

  private limit(
    name:
      | 'maxVectorPaths'
      | 'maxVectorCommands'
      | 'maxCanvasPaintPaths'
      | 'maxCanvasPaintCommands'
      | 'maxFlattenedPoints'
      | 'maxBooleanPoints'
      | 'maxGeometryWorkUnits'
      | 'maxRenderableGlyphs'
      | 'maxGeneratedItems',
  ): number {
    return this.control[name] ?? DEFAULT_AGENT_LIMITS[name];
  }
}

export function geometryBudgetFor(
  control: GeometryBudgetControl = {},
): GeometryBudget {
  return control.geometryBudget ?? new GeometryBudget(control);
}
