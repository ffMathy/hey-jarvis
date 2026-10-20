import { describe, expect, it } from 'bun:test';
import { MAX_SATELLITES } from 'hologram';
import { CustomBlending, InstancedBufferAttribute, OneFactor, OneMinusSrcColorFactor } from 'three';
import type { SatelliteSpot } from '../satellites/satellite-spots';
import { CORONA_RENDER_ORDER } from './corona';
import {
  createSatellites,
  MIN_APPARENT_RADIUS_DEGREES,
  SATELLITE_RADIUS_METRES,
  SATELLITE_RENDER_ORDER,
  satelliteRadiusAt,
} from './satellites';

function spot(x: number, overrides: Partial<SatelliteSpot> = {}): SatelliteSpot {
  return { position: { x, y: 1.4, z: -1.5 }, glyph: 3, level: 1, flare: 0, asking: false, ...overrides };
}

function attribute(satellites: ReturnType<typeof createSatellites>, name: string): InstancedBufferAttribute {
  const found = satellites.object.geometry.getAttribute(name);
  if (!(found instanceof InstancedBufferAttribute)) throw new Error(`${name} is not an instanced attribute.`);
  return found;
}

describe('satelliteRadiusAt', () => {
  it('is its own radius near by, and never subtends less than the least apparent angle far off', () => {
    const crossover = SATELLITE_RADIUS_METRES / Math.tan((MIN_APPARENT_RADIUS_DEGREES * Math.PI) / 180);
    expect(satelliteRadiusAt(1)).toBe(SATELLITE_RADIUS_METRES);
    expect(satelliteRadiusAt(crossover * 3)).toBeCloseTo(SATELLITE_RADIUS_METRES * 3, 9);
  });
});

describe('the satellites’ draw', () => {
  it('is one instance per satellite, carrying where, which glyph, how lit, its flare and whether it asks', () => {
    const satellites = createSatellites();
    satellites.set([spot(0.1, { glyph: 0, level: 0.4 }), spot(-0.2, { glyph: 6, flare: 0.5, asking: true })]);

    expect(satellites.object.geometry.instanceCount).toBe(2);
    expect(satellites.object.visible).toBe(true);
    expect(attribute(satellites, 'centre').getX(1)).toBeCloseTo(-0.2, 6);
    expect(attribute(satellites, 'glyph').getX(1)).toBe(6);
    expect(attribute(satellites, 'level').getX(0)).toBeCloseTo(0.4, 6);
    expect(attribute(satellites, 'flare').getX(1)).toBeCloseTo(0.5, 6);
    expect(attribute(satellites, 'asking').getX(1)).toBe(1);
    expect(attribute(satellites, 'asking').getX(0)).toBe(0);
  });

  it(`draws at most ${MAX_SATELLITES}, clamps what it is handed, and hides when there are none`, () => {
    const satellites = createSatellites();
    satellites.set(Array.from({ length: MAX_SATELLITES + 4 }, (_, index) => spot(index, { level: 3, flare: -1 })));

    expect(satellites.object.geometry.instanceCount).toBe(MAX_SATELLITES);
    expect(attribute(satellites, 'level').getX(0)).toBe(1);
    expect(attribute(satellites, 'flare').getX(0)).toBe(0);

    satellites.set([]);
    expect(satellites.object.visible).toBe(false);
  });

  it('is drawn after his coronas and before the text panels, Screen-blended with no depth, as his layers are', () => {
    const { object } = createSatellites();

    expect(SATELLITE_RENDER_ORDER).toBeGreaterThan(CORONA_RENDER_ORDER);
    expect(SATELLITE_RENDER_ORDER).toBeLessThan(10);
    expect(object.renderOrder).toBe(SATELLITE_RENDER_ORDER);
    expect(object.frustumCulled).toBe(false);
    expect(object.material.blending).toBe(CustomBlending);
    expect(object.material.blendSrc).toBe(OneFactor);
    expect(object.material.blendDst).toBe(OneMinusSrcColorFactor);
    expect(object.material.depthTest).toBe(false);
    expect(object.material.depthWrite).toBe(false);
  });

  it('turns every glyph to the centre eye it is handed each frame', () => {
    const satellites = createSatellites();
    satellites.update(0.016, { x: 0.3, y: 1.6, z: 0.1 });

    const uniforms = satellites.object.material.uniforms;
    expect(uniforms.eye?.value.toArray()).toEqual([0.3, 1.6, 0.1]);
    expect(uniforms.time?.value).toBeCloseTo(0.016, 9);
  });
});
