/**
 * Writing JavaScript numbers into GLSL source, for every shader the hologram's GPU passes build.
 */

/** A number as a GLSL float literal: always with a decimal point, which GLSL insists on. */
export function glslFloat(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/**
 * A hex colour as a GLSL vec3 of its raw, encoded bytes — he was designed in Skia, which blends the
 * encoded values with no linearising, so the shaders do too.
 */
export function glslColour(hex: number): string {
  const channel = (shift: number) => glslFloat(((hex >> shift) & 0xff) / 255);
  return `vec3(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
