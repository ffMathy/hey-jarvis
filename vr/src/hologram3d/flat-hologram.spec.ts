import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import type { CanvasKit, GrDirectContext, Surface } from 'canvaskit-wasm';
import { type HologramFrame, VOICE_BAND_COUNT } from 'hologram';
import { loadPainter, type Painter } from './canvaskit';
import { createFlatHologram } from './flat-hologram';

/**
 * The flat drawing against the real CanvasKit, with the browser around it faked: Bun has no
 * OffscreenCanvas and no WebGL. The fake browser names its GPU and hands out contexts that record
 * being lost; CanvasKit's GPU calls are replaced by ones that can be told to fail as the real ones
 * do and record what was deleted, and they draw on a CPU surface, so every frame is really drawn.
 */

const WEBGL_RENDERER = 0x1f01;
const UNMASKED_RENDERER_WEBGL = 0x9246;
const SIZE = 64;

/** What the page's GPU reports itself as, and every canvas it was asked for. */
const browser = { renderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)', canvases: [] as FakeOffscreenCanvas[] };

class FakeWebGl {
  readonly RENDERER = WEBGL_RENDERER;
  lost = false;
  getExtension(name: string) {
    if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL };
    if (name === 'WEBGL_lose_context') {
      return {
        loseContext: () => {
          this.lost = true;
        },
      };
    }
    return null;
  }
  getParameter() {
    return browser.renderer;
  }
}

class FakeOffscreenCanvas {
  webgl: FakeWebGl | undefined;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    browser.canvases.push(this);
  }
  getContext(type: string) {
    if (type === 'webgl2' || type === 'webgl') {
      this.webgl ??= new FakeWebGl();
      return this.webgl;
    }
    if (type === '2d') return { putImageData: () => undefined };
    return null;
  }
  transferToImageBitmap() {
    return { close: () => undefined };
  }
}

/** Where CanvasKit's CPU surface puts its pixels when it is flushed onto its canvas. */
class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

class FakeGrDirectContext implements GrDirectContext {
  readonly _type = 'GrDirectContext';
  deleted = false;
  delete() {
    this.deleted = true;
  }
  deleteLater() {
    this.deleted = true;
  }
  isAliasOf(other: unknown) {
    return other === this;
  }
  isDeleted() {
    return this.deleted;
  }
  getResourceCacheLimitBytes() {
    return 0;
  }
  getResourceCacheUsageBytes() {
    return 0;
  }
  releaseResourcesAndAbandonContext() {
    this.deleted = true;
  }
  setResourceCacheLimitBytes() {}
}

/** How each of CanvasKit's GPU steps is to go: CanvasKit answers 0 or null, or throws. */
interface GpuSteps {
  context?: 'made' | 'refused';
  grContext?: 'made' | 'null' | 'throws';
  surface?: 'made' | 'null' | 'throws';
}

/** What was made and deleted along the way. */
interface GpuRecord {
  contextCanvas: HTMLCanvasElement | OffscreenCanvas | undefined;
  grContext: FakeGrDirectContext | undefined;
  gpuSurfaceDeleted: boolean;
  deletedContexts: number[];
  cpuSurfaceDisposed: boolean;
}

const CONTEXT_HANDLE = 7;

let real: Painter;

/** A painter over the real CanvasKit whose GPU steps go as `steps` says, and a Skia that counts live paths. */
function painterWith(steps: GpuSteps = {}) {
  const record: GpuRecord = {
    contextCanvas: undefined,
    grContext: undefined,
    gpuSurfaceDeleted: false,
    deletedContexts: [],
    cpuSurfaceDisposed: false,
  };
  const canvasKit: CanvasKit = {
    ...real.canvasKit,
    GetWebGLContext: (canvas) => {
      if (steps.context === 'refused') return 0;
      canvas.getContext('webgl2');
      record.contextCanvas = canvas;
      return CONTEXT_HANDLE;
    },
    MakeWebGLContext: () => {
      if (steps.grContext === 'throws') throw new Error('Skia could not use this WebGL');
      if (steps.grContext === 'null') return null;
      record.grContext = new FakeGrDirectContext();
      return record.grContext;
    },
    MakeOnScreenGLSurface: (grContext, width, height) => {
      // CanvasKit reads the GrDirectContext before anything else, which throws for a null one.
      grContext.isDeleted();
      if (steps.surface === 'throws') throw new Error('The surface could not be wrapped');
      if (steps.surface === 'null') return null;
      const surface: Surface | null = real.canvasKit.MakeSurface(width, height);
      if (surface === null) return null;
      const deleteSurface = surface.delete.bind(surface);
      surface.delete = () => {
        record.gpuSurfaceDeleted = true;
        deleteSurface();
      };
      surface.reportBackendTypeIsGPU = () => true;
      return surface;
    },
    deleteContext: (handle) => {
      record.deletedContexts.push(handle);
    },
    MakeSWCanvasSurface: (canvas) => {
      const surface = real.canvasKit.MakeSWCanvasSurface(canvas);
      if (surface === null) return null;
      const disposeSurface = surface.dispose.bind(surface);
      surface.dispose = () => {
        record.cpuSurfaceDisposed = true;
        disposeSurface();
      };
      return surface;
    },
  };
  const alive = new Set<object>();
  const skia = JsiSkApi(real.canvasKit);
  const Path = new Proxy(skia.Path, {
    get(target, property, receiver) {
      if (property !== 'MakeFromCmds') return Reflect.get(target, property, receiver);
      const makeFromCmds: typeof target.MakeFromCmds = (commands) => {
        const path = target.MakeFromCmds(commands);
        if (path === null) return path;
        alive.add(path);
        const dispose = path.dispose.bind(path);
        path.dispose = () => {
          alive.delete(path);
          dispose();
        };
        return path;
      };
      return makeFromCmds;
    },
  });
  const painter: Painter = { canvasKit, skia: { ...skia, Path } };
  return { painter, record, alive };
}

/** Whether the WebGL context CanvasKit was given has been lost on purpose. */
function contextLost(record: GpuRecord) {
  return record.contextCanvas instanceof FakeOffscreenCanvas && record.contextCanvas.webgl?.lost === true;
}

/** He is arriving, `index` frames in: the rim fades in, so its ladder ring is rebuilt every few frames. */
function arriving(index: number): HologramFrame {
  return {
    time: 2 + index / 72,
    level: 0.4,
    bands: new Array(VOICE_BAND_COUNT).fill(0.3),
    speaking: true,
    agitation: 1,
    burstAge: 0.3,
    burstStrength: 1,
    burstCount: 2,
    appearance: Math.min(1, 0.64 + Math.floor(index / 3) * 0.06),
    thinking: 0,
    presence: 1,
    density: 0,
  };
}

beforeAll(async () => {
  real = await loadPainter(new URL('../../node_modules/canvaskit-wasm/bin/full/', import.meta.url));
  // Bun has neither; CanvasKit's CPU surface asks for both by name.
  Object.defineProperty(globalThis, 'OffscreenCanvas', { value: FakeOffscreenCanvas, configurable: true });
  Object.defineProperty(globalThis, 'ImageData', { value: FakeImageData, configurable: true });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  Reflect.deleteProperty(globalThis, 'ImageData');
});

beforeEach(() => {
  browser.renderer = 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)';
  browser.canvases = [];
});

describe('the flat drawing’s surface', () => {
  it('draws on the GPU when there is a real one', () => {
    const { painter } = painterWith();
    const flat = createFlatHologram(painter, SIZE);
    expect(flat.kind).toBe('webgl');
    flat.draw(arriving(0));
    flat.dispose();
  });

  it('lets go of the surface, Skia’s context and the WebGL context when disposed', () => {
    const { painter, record } = painterWith();
    const flat = createFlatHologram(painter, SIZE);
    flat.draw(arriving(0));
    flat.dispose();
    expect(record.gpuSurfaceDeleted).toBe(true);
    expect(record.grContext?.deleted).toBe(true);
    expect(record.deletedContexts).toEqual([CONTEXT_HANDLE]);
    expect(contextLost(record)).toBe(true);
    // A second dispose has nothing left to delete.
    flat.dispose();
    expect(record.deletedContexts).toEqual([CONTEXT_HANDLE]);
  });

  it('draws on the CPU when the only WebGL is a software one, and frees its pixels when disposed', () => {
    browser.renderer = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
    const { painter, record } = painterWith();
    const flat = createFlatHologram(painter, SIZE);
    expect(flat.kind).toBe('cpu');
    expect(record.contextCanvas).toBeUndefined();
    flat.draw(arriving(0));
    flat.dispose();
    expect(record.cpuSurfaceDisposed).toBe(true);
  });

  const failures: Array<[string, GpuSteps]> = [
    ['the browser refuses CanvasKit a WebGL context', { context: 'refused' }],
    ['Skia cannot make its GrDirectContext', { grContext: 'null' }],
    ['making the GrDirectContext throws', { grContext: 'throws' }],
    ['CanvasKit cannot make the surface', { surface: 'null' }],
    ['making the surface throws', { surface: 'throws' }],
  ];
  for (const [what, steps] of failures) {
    it(`falls back to the CPU when ${what}, leaving nothing of the attempt behind`, () => {
      const { painter, record } = painterWith(steps);
      const flat = createFlatHologram(painter, SIZE);
      expect(flat.kind).toBe('cpu');
      flat.draw(arriving(0));
      if (record.contextCanvas !== undefined) {
        expect(record.deletedContexts).toEqual([CONTEXT_HANDLE]);
        expect(contextLost(record)).toBe(true);
      }
      if (record.grContext !== undefined) expect(record.grContext.deleted).toBe(true);
      flat.dispose();
      expect(record.cpuSurfaceDisposed).toBe(true);
    });
  }
});

describe('the flat drawing’s paths', () => {
  it('lets go of every path a frame made once it is drawn, and of the rest when disposed', () => {
    const { painter, alive } = painterWith();
    const flat = createFlatHologram(painter, SIZE);
    const lasting = alive.size;
    for (let index = 0; index < 24; index++) {
      flat.draw(arriving(index));
      // The ladder ring's five paths are all that may outlive the frame that built them.
      expect(alive.size - lasting).toBeLessThanOrEqual(5);
    }
    flat.dispose();
    expect(alive.size).toBe(0);
  });
});
