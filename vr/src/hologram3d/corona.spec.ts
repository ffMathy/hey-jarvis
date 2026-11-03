import { describe, expect, it } from 'bun:test';
import { SCAN_SECONDS, SCAN_SOFTNESS, scanAt } from 'hologram';
import { glslColour, glslFloat, HALO_PAINTS, STROKE_PAINTS, THINNEST_STROKE_PIXELS } from 'hologram/gpu';
import {
  CustomBlending,
  InstancedBufferAttribute,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
} from 'three';
import {
  CORONA_RADIUS_METRES,
  CORONA_RENDER_ORDER,
  CORONA_SCAN_TRAVEL,
  type CoronaSpot,
  coronaRadiusAt,
  createCoronas,
  MAX_CORONAS,
  MIN_APPARENT_RADIUS_DEGREES,
  scanHeightAt,
} from './corona';
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

describe('the rhythm, which is his thinking band', () => {
  it(`glides the band up from the bottom of the disc for ${SCAN_SECONDS} s, and back down for as long`, () => {
    expect(scanHeightAt(0)).toBeCloseTo(-CORONA_SCAN_TRAVEL, 9);
    expect(scanHeightAt(SCAN_SECONDS / 2)).toBeCloseTo(0, 9);
    expect(scanHeightAt(SCAN_SECONDS)).toBeCloseTo(CORONA_SCAN_TRAVEL, 9);
    expect(scanHeightAt(SCAN_SECONDS * 1.5)).toBeCloseTo(0, 9);
    expect(scanHeightAt(SCAN_SECONDS * 2)).toBeCloseTo(-CORONA_SCAN_TRAVEL, 9);
    // Up all the way through the first pass, and down all the way through the second.
    const step = SCAN_SECONDS / 100;
    for (let time = step; time <= SCAN_SECONDS; time += step) {
      expect(scanHeightAt(time)).toBeGreaterThan(scanHeightAt(time - step));
      expect(scanHeightAt(time + SCAN_SECONDS)).toBeLessThan(scanHeightAt(time + SCAN_SECONDS - step));
    }
    expect(scanHeightAt(SCAN_SECONDS * 6 + 0.4)).toBeCloseTo(scanHeightAt(0.4), 9);
  });

  it('keeps his time: where his band is up his height, over its own travel', () => {
    for (const time of [0, 0.3, 1.1, 2.6, 3.9, 47.25]) {
      expect(scanHeightAt(time)).toBeCloseTo(CORONA_SCAN_TRAVEL * scanAt(time), 12);
    }
  });

  it('turns back inside the disc, never leaping from the top to the bottom', () => {
    // A frame's step anywhere on the swing moves the band only a little: it never jumps.
    const frame = 1 / 72;
    let largestStep = 0;
    let highest = Number.NEGATIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;
    for (let time = 0; time < 4 * SCAN_SECONDS; time += frame) {
      largestStep = Math.max(largestStep, Math.abs(scanHeightAt(time + frame) - scanHeightAt(time)));
      highest = Math.max(highest, scanHeightAt(time));
      lowest = Math.min(lowest, scanHeightAt(time));
    }
    expect(largestStep).toBeLessThan(0.02);
    expect(highest).toBeLessThan(0.86);
    expect(lowest).toBeGreaterThan(-0.86);
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

  it("paints with his palette and keeps his band's time, taken from where they are defined", () => {
    const { fragmentShader, vertexShader } = createCoronas().object.material;
    expect(fragmentShader).toContain(`HALO = ${glslColour(HALO_PAINTS.colour)}`);
    expect(fragmentShader).toContain(`BRIGHT = ${glslColour(STROKE_PAINTS.bright.colour)}`);
    expect(fragmentShader).toContain(`DIM = ${glslColour(STROKE_PAINTS.dim.colour)}`);
    expect(fragmentShader).toContain(`HOT = ${glslColour(STROKE_PAINTS.hot.colour)}`);
    expect(fragmentShader).toContain(`SCAN_SECONDS = ${glslFloat(SCAN_SECONDS)}`);
    expect(fragmentShader).toContain(`SCAN_SOFTNESS = ${glslFloat(SCAN_SOFTNESS)}`);
    expect(fragmentShader).toContain(`SCAN_TRAVEL = ${glslFloat(CORONA_SCAN_TRAVEL)}`);
    expect(fragmentShader).toContain(`THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)}`);
    expect(vertexShader).toContain(`RADIUS = ${glslFloat(CORONA_RADIUS_METRES)}`);
    // GLSL leaves a negative number raised to a power undefined, so every square is multiplied out.
    expect(fragmentShader).not.toContain('pow(');
  });

  it('works the band out as his scanAt does, and blooms no ring as a pass ends', () => {
    const { fragmentShader } = createCoronas().object.material;
    expect(fragmentShader).toContain('-SCAN_TRAVEL * cos(PI * swing / SCAN_SECONDS)');
    expect(fragmentShader).toContain('exp(-apart * apart)');
    expect(fragmentShader.toLowerCase()).not.toContain('bloom');
    expect(fragmentShader.toLowerCase()).not.toContain('pulse');
  });
});
