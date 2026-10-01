import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry } from 'three';
import type { HologramRows } from './body-rows';

/** The rows as instance attributes, made once and shared by every draw that reads them. */
export interface RowAttributes {
  rest: InstancedBufferAttribute;
  shape: InstancedBufferAttribute;
  hashes: InstancedBufferAttribute;
  identity: InstancedBufferAttribute;
  thinning: InstancedBufferAttribute;
  count: number;
}

export function createRowAttributes(rows: HologramRows): RowAttributes {
  return {
    rest: new InstancedBufferAttribute(rows.rest, 4),
    shape: new InstancedBufferAttribute(rows.shape, 4),
    hashes: new InstancedBufferAttribute(rows.hashes, 4),
    identity: new InstancedBufferAttribute(rows.identity, 4),
    thinning: new InstancedBufferAttribute(rows.thinning, 1),
    count: rows.count,
  };
}

/**
 * One quad per row, instanced: four corners at ±1, which each draw's vertex shader stretches over
 * whatever that row is this frame. The rows' attributes are shared, so the GPU holds them once
 * however many draws read them.
 */
export function createRowGeometry(attributes: RowAttributes): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('rest', attributes.rest);
  geometry.setAttribute('shape', attributes.shape);
  geometry.setAttribute('hashes', attributes.hashes);
  geometry.setAttribute('identity', attributes.identity);
  geometry.setAttribute('thinning', attributes.thinning);
  geometry.instanceCount = attributes.count;
  return geometry;
}
