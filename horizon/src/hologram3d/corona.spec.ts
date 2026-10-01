import { describe, expect, it } from 'bun:test';
import { PULSE_SECONDS, SCAN_HALF_WIDTH, SCAN_SECONDS } from 'hologram';
import {
  CustomBlending,
  InstancedBufferAttribute,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
} from 'three';
import { STROKE_PAINTS, THINNEST_STROKE_PIXELS } from './body-strokes';
import {
  bloomRadiusAt,
  CORONA_RADIUS_METRES,
  CORONA_RENDER_ORDER,
  type CoronaSpot,
  coronaRadiusAt,
  createCoronas,
  MAX_CORONAS,
  MIN_APPARENT_RADIUS_DEGREES,
  pulseAt,
  scanHeightAt,
} from './corona';
import { glslColour, glslFloat } from './fragment-glsl';
import { HALO_PAINTS } from './halo-union';
import { ALPHA_FROM_LIGHT } from './view-plane-quad';

function spot(x: number, level = 1): CoronaSpot {
  return { position: { x, y: 1.5, z: -2 }, level };
}

function attribute(coronas: ReturnType<typeof createCoronas>, name: string): InstancedBufferAttribute {
  const found = coronas.object.geometry.getAttribute(name);
  if (!(found instanceof InstancedBufferAttribute)) throw new Error(`${name} is not an instanced attribute.`);
  return found;
}

describe('coronaRadiusAt', () => {
  it('is its own radius near by, and never subtends less than the least apparent angle far off', () => {
    const tangent = Math.tan((MIN_APPARENT_RADIUS_DEGREES * Math.PI) / 180);
    const crossover = CORONA_RADIUS_METRES / tangent;
    expect(coronaRadiusAt(1)).toBe(CORONA_RADIUS_METRES);
    expect(coronaRadiusAt(crossover)).toBeCloseTo(CORONA_RADIUS_METRES, 9);
    expect(coronaRadiusAt(crossover * 2)).toBeCloseTo(CORONA_RADIUS_METRES * 2, 9);
  });
});

describe('the rhythm, which is his thinking scan', () => {
  it(`sweeps the band up from below the disc to above it once every ${SCAN_SECONDS} s`, () => {
    expect(scanHeightAt(0)).toBeCloseTo(-1.15, 9);
    expect(scanHeightAt(SCAN_SECONDS / 2)).toBeCloseTo(0, 9);
    expect(scanHeightAt(SCAN_SECONDS * 0.999)).toBeGreaterThan(1.1);
    expect(scanHeightAt(SCAN_SECONDS * 3 + 0.4)).toBeCloseTo(scanHeightAt(0.4), 9);
  });

  it(`blooms for the last ${PULSE_SECONDS} s of each pass`, () => {
    expect(pulseAt(0.2)).toBeUndefined();
    expect(pulseAt(SCAN_SECONDS - PULSE_SECONDS - 0.01)).toBeUndefined();
    expect(pulseAt(SCAN_SECONDS - PULSE_SECONDS)).toBeCloseTo(0, 9);
    expect(pulseAt(SCAN_SECONDS - PULSE_SECONDS / 2)).toBeCloseTo(0.5, 9);
    expect(pulseAt(2 * SCAN_SECONDS - 1e-6)).toBeCloseTo(1, 4);
  });

  it('blooms from near the middle to past the rim', () => {
    expect(bloomRadiusAt(0.2)).toBeUndefined();
    expect(bloomRadiusAt(SCAN_SECONDS - PULSE_SECONDS)).toBeLessThan(0.25);
    expect(bloomRadiusAt(SCAN_SECONDS - 1e-6)).toBeGreaterThan(1.25);
  });
});

describe('createCoronas', () => {
  it('draws nothing until it is given a corona', () => {
    const coronas = createCoronas();
    expect(coronas.object.visible).toBe(false);
    expect(coronas.object.geometry.instanceCount).toBe(0);
    coronas.dispose();
  });

  it('draws one instance per corona, where it is and as lit as it is, clamped to 0–1', () => {
    const coronas = createCoronas();
    coronas.set([spot(0.5, 1), spot(-1, 0.25), spot(2, 3)]);
    expect(coronas.object.visible).toBe(true);
    expect(coronas.object.geometry.instanceCount).toBe(3);
    const centres = attribute(coronas, 'centre');
    const levels = attribute(coronas, 'level');
    expect([centres.getX(1), centres.getY(1), centres.getZ(1)]).toEqual([-1, 1.5, -2]);
    expect([levels.getX(0), levels.getX(1), levels.getX(2)]).toEqual([1, 0.25, 1]);
    coronas.set([]);
    expect(coronas.object.visible).toBe(false);
    coronas.dispose();
  });

  it(`draws at most ${MAX_CORONAS}, the first given — which the lifetime lists brightest first`, () => {
    const coronas = createCoronas();
    coronas.set(Array.from({ length: MAX_CORONAS + 5 }, (_, index) => spot(index)));
    expect(coronas.object.geometry.instanceCount).toBe(MAX_CORONAS);
    expect(attribute(coronas, 'centre').getX(MAX_CORONAS - 1)).toBe(MAX_CORONAS - 1);
    coronas.dispose();
  });

  it('moves its clock on and turns to the centre eye each frame', () => {
    const coronas = createCoronas();
    coronas.update(0.5, { x: 0, y: 1.6, z: 0 });
    coronas.update(0.25, { x: 0.1, y: 1.7, z: 0.2 });
    expect(coronas.time).toBeCloseTo(0.75, 9);
    const uniforms = coronas.object.material.uniforms;
    expect(uniforms.eye.value.toArray()).toEqual([0.1, 1.7, 0.2]);
    coronas.time = 10;
    expect(uniforms.time.value).toBe(10);
    coronas.dispose();
  });

  it('is laid over the room as his layers are: Screen in colour and alpha, no depth, before the panels', () => {
    const coronas = createCoronas();
    const { material } = coronas.object;
    expect(material.blending).toBe(CustomBlending);
    expect(material.blendSrc).toBe(OneFactor);
    expect(material.blendDst).toBe(OneMinusSrcColorFactor);
    expect(material.blendSrcAlpha).toBe(OneFactor);
    expect(material.blendDstAlpha).toBe(OneMinusSrcAlphaFactor);
    expect(material.premultipliedAlpha).toBe(true);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(coronas.object.renderOrder).toBe(CORONA_RENDER_ORDER);
    expect(CORONA_RENDER_ORDER).toBeLessThan(10);
    expect(coronas.object.frustumCulled).toBe(false);
    coronas.dispose();
  });

  it('hides as much of the room as it lights, by the factor his layers use, and can be tuned', () => {
    const coronas = createCoronas();
    expect(coronas.alphaFactor).toBe(ALPHA_FROM_LIGHT);
    coronas.alphaFactor = 0.6;
    expect(coronas.object.material.uniforms.alphaFromLight.value).toBe(0.6);
    expect(coronas.object.material.fragmentShader).toContain('alphaFromLight * brightest');
    coronas.dispose();
  });

  it("paints with his palette and keeps his scan's time, taken from where they are defined", () => {
    const { fragmentShader, vertexShader } = createCoronas().object.material;
    expect(fragmentShader).toContain(`HALO = ${glslColour(HALO_PAINTS.colour)}`);
    expect(fragmentShader).toContain(`BRIGHT = ${glslColour(STROKE_PAINTS.bright.colour)}`);
    expect(fragmentShader).toContain(`DIM = ${glslColour(STROKE_PAINTS.dim.colour)}`);
    expect(fragmentShader).toContain(`HOT = ${glslColour(STROKE_PAINTS.hot.colour)}`);
    expect(fragmentShader).toContain(`SCAN_SECONDS = ${glslFloat(SCAN_SECONDS)}`);
    expect(fragmentShader).toContain(`PULSE_SECONDS = ${glslFloat(PULSE_SECONDS)}`);
    expect(fragmentShader).toContain(`SCAN_HALF_WIDTH = ${glslFloat(SCAN_HALF_WIDTH)}`);
    expect(fragmentShader).toContain(`THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)}`);
    expect(vertexShader).toContain(`RADIUS = ${glslFloat(CORONA_RADIUS_METRES)}`);
    // GLSL leaves a negative number raised to a power undefined, so every square is multiplied out.
    expect(fragmentShader).not.toContain('pow(');
  });
});
