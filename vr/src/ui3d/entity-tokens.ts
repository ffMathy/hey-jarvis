import {
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
} from 'three';
import { TOKEN_RADIUS_METRES } from '../entities/grab';
import type { Vector3Like } from '../xr/ray';
import { UI_COLOURS } from './ui-colours';

/**
 * The tokens sir takes and puts down while placing things: a small bright orb in a ring, one per
 * entity — in its drawer slot, where it stands in the room, or in his hand.
 *
 * Every token is one instance of two instanced meshes, so any number of them is two draws: the orb,
 * and a ring round it, both turned to face the eyes so the ring reads as a ring from anywhere. The
 * orb is a flat disc: drawn unlit, a sphere looks exactly like the disc it covers, and a disc's
 * outline is round to well under a pixel however near the eyes it is carried, for a fraction of a
 * sphere's triangles. Their edges are smoothed by the renderer's multisampling (`xr/xr-stage.ts`):
 * the emulator's pictures, at half a headset's density, show no steps along them, so they are not
 * drawn as distance fields the way his strokes and coronas are. The ring's colour says
 * what the token is: the accent, sir's own colour, for one waiting to be placed or being carried;
 * the text colour for one already standing in the room; the danger colour for one whose anchor is
 * gone. Jarvis's orange is kept for his corona, so what sir handles never looks like what Jarvis is
 * doing. Drawn over everything but the text, and through walls: a token placed behind the sofa is
 * still there to be moved.
 *
 * Outside placing things, each placed entity is a `marker`: the orb alone, small, with no ring, so
 * sir can see what there is to point at — or, on a phone, to tap — without it looking like something
 * to pick up. It never shrinks below {@link MARKER_MIN_DEGREES} across, so a lamp across the room
 * still has one.
 */

export type TokenLook = 'waiting' | 'placed' | 'lost' | 'carried' | 'marker';

/** One token to draw. */
export interface TokenSpot {
  position: Vector3Like;
  look: TokenLook;
}

export interface EntityTokens {
  readonly objects: readonly Object3D[];
  /** The tokens to draw from the next render on, each ring facing `eye`. */
  set(spots: readonly TokenSpot[], eye: Vector3Like): void;
  dispose(): void;
}

/** The most tokens drawn at once: a page of the drawer, and more placed things than any room holds. */
export const MAX_TOKENS = 96;

/** How big an orb is drawn: the size the grab takes it at. */
const ORB_RADIUS_METRES = TOKEN_RADIUS_METRES * 0.7;

/** The ring around it: about the size the grab takes a token at, so it frames what can be taken. */
const RING_INNER_METRES = TOKEN_RADIUS_METRES * 0.8;
const RING_OUTER_METRES = TOKEN_RADIUS_METRES * 0.95;

/** How much bigger a carried token is: it is the one sir is looking at. */
const CARRIED_SCALE = 1.35;

/** How big a marker is near to, against an orb: a dot, not a thing to take. */
const MARKER_SCALE = 0.5;

/** The least angle a marker's radius subtends at the eye. */
export const MARKER_MIN_DEGREES = 0.35;

/** How much an orb is scaled to be a marker at `distance` from the eye. */
export function markerScaleAt(distance: number): number {
  const least = (distance * Math.tan((MARKER_MIN_DEGREES * Math.PI) / 180)) / ORB_RADIUS_METRES;
  return Math.max(MARKER_SCALE, least);
}

/** How much a token's orb is scaled, `distance` from the eye: a marker by its least angle, a carried one up. */
function orbScaleOf(look: TokenLook, distance: number): number {
  if (look === 'marker') return markerScaleAt(distance);
  return look === 'carried' ? CARRIED_SCALE : 1;
}

const RING_COLOURS: Record<TokenLook, string> = {
  waiting: UI_COLOURS.accent,
  carried: UI_COLOURS.accent,
  placed: UI_COLOURS.text,
  lost: UI_COLOURS.danger,
  // Never seen: a marker's ring is scaled away.
  marker: UI_COLOURS.text,
};

const ORB_COLOURS: Record<TokenLook, string> = {
  waiting: '#bae6fd',
  carried: '#e0f2fe',
  placed: '#cbd5e1',
  lost: '#fecaca',
  marker: '#e0f2fe',
};

function instanced(geometry: CircleGeometry | RingGeometry, material: MeshBasicMaterial): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, MAX_TOKENS);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  // Instances are wherever the tokens are; the geometry's own bounds at the origin say nothing.
  mesh.frustumCulled = false;
  // Over the drawer (8), under the labels and panels (10).
  mesh.renderOrder = 9;
  return mesh;
}

export function createEntityTokens(): EntityTokens {
  // Transparent although it is solid: three draws every opaque mesh before any transparent one,
  // whatever their render order, and the drawer's board is transparent — an opaque orb would be
  // painted over by the board it floats in front of.
  const orbMaterial = new MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  });
  const ringMaterial = new MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
    opacity: 0.95,
    side: DoubleSide,
  });
  const orbs = instanced(new CircleGeometry(ORB_RADIUS_METRES, 48), orbMaterial);
  const rings = instanced(new RingGeometry(RING_INNER_METRES, RING_OUTER_METRES, 40), ringMaterial);
  const placement = new Object3D();
  const colour = new Color();

  /** Puts token `index`'s orb and ring at `spot`, both turned to face `eye`, in its look's size and colours. */
  function placeToken(index: number, spot: TokenSpot, eye: Vector3Like) {
    placement.position.set(spot.position.x, spot.position.y, spot.position.z);
    placement.lookAt(eye.x, eye.y, eye.z);
    const distance = Math.hypot(spot.position.x - eye.x, spot.position.y - eye.y, spot.position.z - eye.z);
    placement.scale.setScalar(orbScaleOf(spot.look, distance));
    placement.updateMatrix();
    orbs.setMatrixAt(index, placement.matrix);
    // A marker is the orb alone. Its ring is scaled to nothing rather than left out, so the orbs and
    // the rings keep one instance a token at the same index.
    if (spot.look === 'marker') {
      placement.scale.setScalar(0);
      placement.updateMatrix();
    }
    rings.setMatrixAt(index, placement.matrix);
    // The palette is sRGB, as the page's is; three keeps instance colours linear.
    orbs.setColorAt(index, colour.set(ORB_COLOURS[spot.look]));
    rings.setColorAt(index, colour.set(RING_COLOURS[spot.look]));
  }

  return {
    objects: [orbs, rings],
    set(spots, eye) {
      const count = Math.min(spots.length, MAX_TOKENS);
      for (let index = 0; index < count; index++) {
        const spot = spots[index];
        if (spot !== undefined) placeToken(index, spot, eye);
      }
      for (const mesh of [orbs, rings]) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      for (const mesh of [orbs, rings]) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      orbMaterial.dispose();
      ringMaterial.dispose();
    },
  };
}
