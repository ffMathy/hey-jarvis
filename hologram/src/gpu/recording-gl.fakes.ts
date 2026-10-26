import type { HologramGl } from './gl-objects';

/**
 * A GL context for the specs that only writes down what it is asked — which passes, in what order,
 * into which target, blended how — and makes its GL objects as a browser or expo-gl would. Whether
 * the pixels are right is the browser's to say, in the headset's tests.
 */

export type Call = [string, ...unknown[]];

/** A GL object as a browser makes one: an instance of a class of its own, with nothing on it to read. */
export class BrowserObject {}

/** A uniform's location as a browser makes one, named here so a test can tell which uniform a call sets. */
export class BrowserLocation {
  constructor(readonly name: string) {}
}

/** A GL object as expo-gl makes one on a device: an instance of a class of its own, with the id expo-gl reads it by. */
export class ExpoObject {
  constructor(readonly id: number) {}
}

/** How a context makes its GL objects and its uniforms' locations. */
interface GlObjects {
  made(): object;
  location(name: string): object;
}

const BROWSER_OBJECTS: GlObjects = { made: () => new BrowserObject(), location: (name) => new BrowserLocation(name) };

export function expoObjects(): GlObjects {
  let made = 0;
  return { made: () => new ExpoObject(++made), location: () => new ExpoObject(++made) };
}

/** A context that hands out a fresh object for every create, says yes to every status, and writes every call into `calls`. */
export function recordingGl(calls: Call[], objects = BROWSER_OBJECTS): HologramGl {
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    createShader: objects.made,
    createProgram: objects.made,
    createBuffer: objects.made,
    createTexture: objects.made,
    createFramebuffer: objects.made,
    createVertexArray: objects.made,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program, name) => objects.location(String(name)),
    getAttribLocation: (_program, name) => (name === 'corner' ? 0 : 1),
    checkFramebufferStatus: () => 0x8cd5,
  };
  // A Proxy is typed as its target, and the calls are answered by its `get` rather than by the
  // target's own members, which TypeScript cannot see: every call HologramGl names is answered.
  return new Proxy(
    {},
    {
      get:
        (_target, name: string) =>
        (...args: unknown[]) => {
          calls.push([name, ...args]);
          return answers[name]?.(...args);
        },
    },
  ) as HologramGl;
}

/**
 * Where in `value` there is something the worklets runtime would refuse to copy from the JS thread to
 * the UI thread: anything but a primitive, a plain object, an array or a typed array.
 */
export function uncopyable(value: unknown, path: string): string[] {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return [];
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) return [path];
  return Object.entries(value).flatMap(([key, inner]: [string, unknown]) => uncopyable(inner, `${path}.${key}`));
}
