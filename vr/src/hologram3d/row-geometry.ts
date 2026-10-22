import { buildRowVertices, type HologramRows } from 'hologram/gpu';
import { BufferAttribute, BufferGeometry } from 'three';

/**
 * The rows' one plain indexed list (`buildRowVertices` in `hologram/gpu`, which says why it is not
 * instanced), as a three.js geometry: made once and drawn by both passes that read the rows, the
 * halo union once a frame and the strokes once per eye.
 */
export function createRowGeometry(rows: HologramRows): BufferGeometry {
  const vertices = buildRowVertices(rows);
  const geometry = new BufferGeometry();
  for (const { name, size, values } of vertices.attributes)
    geometry.setAttribute(name, new BufferAttribute(values, size));
  geometry.setAttribute('corner', new BufferAttribute(vertices.corner, 2));
  geometry.setIndex(new BufferAttribute(vertices.index, 1));
  return geometry;
}
