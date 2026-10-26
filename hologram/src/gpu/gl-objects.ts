/**
 * What the hologram's GPU passes share: the calls they make on a context (`HologramGl`), the GL
 * enums as numbers, and making the objects they draw with — programs, buffers, vertex arrays and
 * textures — kept as plain data a worklet can carry (`carried`).
 *
 * Every pass takes its context as an argument, typed as the calls it makes, so a browser's
 * `WebGL2RenderingContext` and expo-gl's `ExpoWebGLRenderingContext` both fit, and nothing here
 * imports either.
 */

/** The WebGL 2 calls the GPU passes make — the body's and the picture's — and nothing else: widen this to make another. */
export type HologramGl = Pick<
  WebGL2RenderingContext,
  | 'activeTexture'
  | 'attachShader'
  | 'bindBuffer'
  | 'bindFramebuffer'
  | 'bindTexture'
  | 'bindVertexArray'
  | 'blendColor'
  | 'blendEquationSeparate'
  | 'blendFuncSeparate'
  | 'bufferData'
  | 'checkFramebufferStatus'
  | 'clear'
  | 'clearColor'
  | 'compileShader'
  | 'createBuffer'
  | 'createFramebuffer'
  | 'createProgram'
  | 'createShader'
  | 'createTexture'
  | 'createVertexArray'
  | 'deleteProgram'
  | 'deleteShader'
  | 'disable'
  | 'drawElements'
  | 'enable'
  | 'enableVertexAttribArray'
  | 'framebufferTexture2D'
  | 'getAttribLocation'
  | 'getProgramInfoLog'
  | 'getProgramParameter'
  | 'getShaderInfoLog'
  | 'getShaderParameter'
  | 'getUniformLocation'
  | 'linkProgram'
  | 'shaderSource'
  | 'texImage2D'
  | 'texParameteri'
  | 'uniform1f'
  | 'uniform1i'
  | 'uniform2f'
  | 'uniform3f'
  | 'uniform4f'
  | 'uniformMatrix4fv'
  | 'blendEquation'
  | 'bufferSubData'
  | 'clearDepth'
  | 'clearStencil'
  | 'colorMask'
  | 'depthFunc'
  | 'depthMask'
  | 'stencilFunc'
  | 'stencilMask'
  | 'stencilOp'
  | 'uniformMatrix3fv'
  | 'useProgram'
  | 'vertexAttribPointer'
  | 'viewport'
>;

// The GL enums the GPU passes use, as the numbers the WebGL 2 and OpenGL ES 3 specifications give.
export const VERTEX_SHADER = 0x8b31;
export const FRAGMENT_SHADER = 0x8b30;
export const COMPILE_STATUS = 0x8b81;
export const LINK_STATUS = 0x8b82;
export const ARRAY_BUFFER = 0x8892;
export const ELEMENT_ARRAY_BUFFER = 0x8893;
export const STATIC_DRAW = 0x88e4;
export const FLOAT = 0x1406;
export const UNSIGNED_BYTE = 0x1401;
export const UNSIGNED_SHORT = 0x1403;
export const UNSIGNED_INT = 0x1405;
export const TRIANGLES = 0x0004;
export const TEXTURE_2D = 0x0de1;
export const TEXTURE0 = 0x84c0;
export const RGBA = 0x1908;
export const RGBA8 = 0x8058;
export const TEXTURE_MAG_FILTER = 0x2800;
export const TEXTURE_MIN_FILTER = 0x2801;
export const TEXTURE_WRAP_S = 0x2802;
export const TEXTURE_WRAP_T = 0x2803;
export const LINEAR = 0x2601;
export const REPEAT = 0x2901;
export const CLAMP_TO_EDGE = 0x812f;
export const FRAMEBUFFER = 0x8d40;
export const COLOR_ATTACHMENT0 = 0x8ce0;
export const FRAMEBUFFER_COMPLETE = 0x8cd5;
export const COLOR_BUFFER_BIT = 0x4000;
export const BLEND = 0x0be2;
export const CULL_FACE = 0x0b44;
export const DEPTH_TEST = 0x0b71;
export const STENCIL_TEST = 0x0b90;
export const SCISSOR_TEST = 0x0c11;
export const DITHER = 0x0bd0;
export const FUNC_ADD = 0x8006;
export const MAX = 0x8008;
export const ONE = 1;
export const ONE_MINUS_SRC_COLOR = 0x0301;
export const ONE_MINUS_SRC_ALPHA = 0x0303;
export const CONSTANT_COLOR = 0x8001;
export const CONSTANT_ALPHA = 0x8003;
export const DYNAMIC_DRAW = 0x88e8;
export const STENCIL_BUFFER_BIT = 0x0400;
export const NOTEQUAL = 0x0205;
export const KEEP = 0x1e00;
export const REPLACE = 0x1e01;
export const DEPTH_BUFFER_BIT = 0x0100;
export const LESS = 0x0201;
export const EQUAL = 0x0202;

export interface LinkedProgram {
  program: WebGLProgram;
  /** Every uniform the program reads, by name; null for one the compiler dropped. */
  uniforms: Record<string, WebGLUniformLocation | null>;
}

/**
 * A GL object as the body keeps it: a plain `{ id }` for one expo-gl made, which is all expo-gl reads
 * of it, and the object itself for a browser's, which has no `id` (see `GpuBody` in `gpu-body.ts`).
 */
export function carried<Handle extends object>(handle: Handle): Handle | { id: number } {
  return 'id' in handle && typeof handle.id === 'number' ? { id: handle.id } : handle;
}

export function compile(gl: HologramGl, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("The hologram's GPU passes could not make a shader.");
  // GLSL ES 3.00, as three's RawShaderMaterial with GLSL3 compiles the headset's.
  gl.shaderSource(shader, `#version 300 es\n${source}`);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`The hologram's GPU shader did not compile: ${log}`);
  }
  return shader;
}

export function link(
  gl: HologramGl,
  vertexSource: string,
  fragmentSource: string,
  uniformNames: string[],
): LinkedProgram {
  const program = gl.createProgram();
  if (program === null) throw new Error("The hologram's GPU passes could not make a program.");
  const vertex = compile(gl, VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`The hologram's GPU program did not link: ${log}`);
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniformNames) {
    const location = gl.getUniformLocation(program, name);
    uniforms[name] = location === null ? null : carried(location);
  }
  return { program: carried(program), uniforms };
}

export function arrayBuffer(gl: HologramGl, target: number, data: ArrayBufferView): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error("The hologram's GPU passes could not make a buffer.");
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, STATIC_DRAW);
  return buffer;
}

/** A vertex array for `program` over the named buffers, each of its size in floats a vertex, and the index. */
export function vertexArray(
  gl: HologramGl,
  program: WebGLProgram,
  attributes: [string, WebGLBuffer, number][],
  index: WebGLBuffer,
): WebGLVertexArrayObject {
  const array = gl.createVertexArray();
  if (array === null) throw new Error("The hologram's GPU passes could not make a vertex array.");
  gl.bindVertexArray(array);
  for (const [name, buffer, size] of attributes) {
    const location = gl.getAttribLocation(program, name);
    // A program that does not read an attribute is not given it.
    if (location < 0) continue;
    gl.bindBuffer(ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, FLOAT, false, 0, 0);
  }
  gl.bindBuffer(ELEMENT_ARRAY_BUFFER, index);
  gl.bindVertexArray(null);
  return array;
}

export function texture(gl: HologramGl, wrap: number): WebGLTexture {
  const made = gl.createTexture();
  if (made === null) throw new Error("The hologram's GPU passes could not make a texture.");
  gl.bindTexture(TEXTURE_2D, made);
  gl.texParameteri(TEXTURE_2D, TEXTURE_MIN_FILTER, LINEAR);
  gl.texParameteri(TEXTURE_2D, TEXTURE_MAG_FILTER, LINEAR);
  gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_S, wrap);
  gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_T, wrap);
  return made;
}
