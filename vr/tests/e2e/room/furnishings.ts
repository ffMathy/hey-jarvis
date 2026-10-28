import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Path,
  PlaneGeometry,
  PointLight,
  RectAreaLight,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { openingIn, type Rect, type RoomBox, type RoomLayout, type RoomSurface, uprightFrameOf } from './room-layout';

/**
 * The emulated living room furnished from photographs: the capture's walls, floor and ceiling in
 * real materials, windows cut into the walls with a park outside, prints where it has wall art, and
 * real furniture models stood in its furniture boxes. Every asset is CC0, from Poly Haven (see
 * `ROOM_ASSET_SOURCES`), and served to the page by the tests (`fixtures.ts`), never fetched.
 *
 * Only what the emulator reports is furnished, and each piece fills its own box, so what is seen is
 * what the app is told is there: Jarvis is never placed inside a sofa the app does not know about.
 */

/** Where each asset came from. All CC0; Poly Haven asks for no attribution, and it is given anyway. */
export const ROOM_ASSET_SOURCES = {
  Sofa_01: 'https://polyhaven.com/a/Sofa_01',
  modern_coffee_table_01: 'https://polyhaven.com/a/modern_coffee_table_01',
  wooden_table_02: 'https://polyhaven.com/a/wooden_table_02',
  gallinera_table: 'https://polyhaven.com/a/gallinera_table',
  wooden_display_shelves_01: 'https://polyhaven.com/a/wooden_display_shelves_01',
  herringbone_parquet: 'https://polyhaven.com/a/herringbone_parquet',
  beige_wall_001: 'https://polyhaven.com/a/beige_wall_001',
  plastered_wall: 'https://polyhaven.com/a/plastered_wall',
  cloudy_vondelpark: 'https://polyhaven.com/a/cloudy_vondelpark (tonemapped JPG, scaled to 4096 × 2048)',
  borghese_gardens: 'https://polyhaven.com/a/borghese_gardens (tonemapped JPG, the two prints cropped from it)',
} as const;

/** A room-aligned box as plain numbers, so a spec can read it out of the page. */
export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

function boundsOf(box: Box3): Bounds {
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

/** What was put in the room, for the spec to check against the boxes it was fitted to. */
export interface FurnishingReport {
  surfaces: Record<string, number>;
  windows: number;
  prints: number;
  /** Each piece, the room-aligned box round it, and the room-aligned box round the capture's box it stands in. */
  furniture: { label: string; piece: string; fitted: Bounds; capture: Bounds }[];
}

export interface Furnishings {
  object: Group;
  /** The park seen through the windows: an equirectangular photograph, for the scene's background. */
  outside: Texture;
  report: FurnishingReport;
}

/**
 * The capture's furniture boxes, by label, and which model stands in each. `turn` is how far a model
 * is turned about the vertical to face +z, glTF's front, when it was not modelled facing it.
 */
type Piece = { model: keyof typeof ROOM_ASSET_SOURCES; tiles?: true; turn?: number } | { lamp: true };

function pieceFor(box: RoomBox): Piece | undefined {
  switch (box.label) {
    case 'couch':
      return { model: 'Sofa_01' };
    case 'shelf':
      return { model: 'wooden_display_shelves_01', tiles: true, turn: -Math.PI / 2 };
    case 'lamp':
      return { lamp: true };
    case 'table':
    case 'desk':
      if (box.height < 0.5) return { model: 'modern_coffee_table_01' };
      if (box.height < 0.7) return { model: 'gallinera_table' };
      return { model: 'wooden_table_02' };
    default:
      return undefined;
  }
}

/** Real-world sizes of the texture sets, in metres, from Poly Haven's own listing. */
const TEXTURE_METRES = { herringbone_parquet: 3.4, beige_wall_001: 3, plastered_wall: 2 } as const;

const PRINTS = ['print_borghese_pines.jpg', 'print_borghese_pine.jpg'] as const;

const WHITE_PAINT = new MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.45 });
const FRAME_BLACK = new MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.5, metalness: 0.1 });
const GLASS = new MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.08,
  depthWrite: false,
});

/** How thick a wall looks at its windows, how wide a window's frame is, and how far a baseboard stands. */
const WALL_DEPTH = 0.18;
const FRAME_WIDTH = 0.06;
const MULLION_EVERY = 1.1;
const BASEBOARD = { height: 0.09, depth: 0.015 } as const;

export async function furnishRoom(layout: RoomLayout, assetsUrl: string): Promise<Furnishings> {
  const textures = new TextureLoader().setPath(assetsUrl);
  const models = new GLTFLoader().setPath(assetsUrl);
  const object = new Group();
  object.name = 'furnished room';
  const report: FurnishingReport = { surfaces: {}, windows: 0, prints: 0, furniture: [] };
  const [outside] = await Promise.all([
    textures.loadAsync('cloudy_vondelpark_4k.jpg'),
    addShell(layout, textures, object, report),
    addPrints(layout, textures, object, report),
    addFurniture(layout, models, object, report),
  ]);
  outside.colorSpace = SRGBColorSpace;
  return { object, outside, report };
}

/** The walls, floor and ceiling, with the windows cut into the walls and set in them. */
async function addShell(layout: RoomLayout, textures: TextureLoader, object: Group, report: FurnishingReport) {
  const [floor, wall, ceiling] = await Promise.all([
    surfaceMaterial(textures, 'herringbone_parquet', 0xffffff),
    surfaceMaterial(textures, 'beige_wall_001', 0xffffff),
    surfaceMaterial(textures, 'plastered_wall', 0xfbfaf7),
  ]);
  const materials: Record<string, Material> = { floor, wall, ceiling };
  const openings = layout.surfaces.filter((surface) => surface.label === 'window');
  for (const surface of layout.surfaces) {
    const material = materials[surface.label];
    if (material === undefined) continue;
    const isWall = surface.label === 'wall';
    const holes = isWall ? openings.flatMap((opening) => openingIn(surface, opening) ?? []) : [];
    object.add(shellOf(surface, holes, material));
    if (isWall) object.add(baseboardOf(surface));
    report.surfaces[surface.label] = (report.surfaces[surface.label] ?? 0) + 1;
  }
  for (const opening of openings) {
    object.add(windowOf(opening));
    report.windows += 1;
  }
}

/** A framed photograph on each of the capture's pieces of wall art. */
async function addPrints(layout: RoomLayout, textures: TextureLoader, object: Group, report: FurnishingReport) {
  const art = layout.surfaces.filter((surface) => surface.label === 'wall art');
  const prints = await Promise.all(art.map((_, index) => textures.loadAsync(PRINTS[index % PRINTS.length] ?? '')));
  art.forEach((surface, index) => {
    const print = prints[index];
    if (print === undefined) return;
    print.colorSpace = SRGBColorSpace;
    object.add(printOf(surface, print));
    report.prints += 1;
  });
}

/** A piece of furniture in each of the capture's furniture boxes that has one, each model loaded once. */
async function addFurniture(layout: RoomLayout, models: GLTFLoader, object: Group, report: FurnishingReport) {
  const loaded = new Map<string, Promise<Object3D>>();
  const load = (model: string) => {
    let scene = loaded.get(model);
    if (scene === undefined) {
      scene = models.loadAsync(`${model}/${model}.gltf`).then((gltf) => gltf.scene);
      loaded.set(model, scene);
    }
    return scene;
  };
  for (const box of layout.boxes) {
    const piece = pieceFor(box);
    if (piece === undefined) continue;
    const furniture =
      'lamp' in piece
        ? lampOf(box)
        : fitted(facingFront(await load(piece.model), piece.turn ?? 0), box, piece.tiles === true);
    object.add(furniture);
    report.furniture.push({
      label: box.label,
      piece: 'lamp' in piece ? 'lamp' : piece.model,
      fitted: boundsOf(new Box3().setFromObject(furniture)),
      capture: boundsOf(box.bounds),
    });
  }
}

async function surfaceMaterial(textures: TextureLoader, name: keyof typeof TEXTURE_METRES, tint: number) {
  const [map, normalMap, arm] = await Promise.all(
    ['diff', 'nor_gl', 'arm'].map((kind) => textures.loadAsync(`${name}/${name}_${kind}_1k.jpg`)),
  );
  if (map === undefined || normalMap === undefined || arm === undefined) throw new Error(`${name} did not load.`);
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, normalMap, arm]) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    // The shell's texture coordinates are metres along the surface, so one repeat is the photograph's own size.
    texture.repeat.setScalar(1 / TEXTURE_METRES[name]);
    texture.anisotropy = 8;
  }
  return new MeshStandardMaterial({
    color: tint,
    map,
    normalMap,
    aoMap: arm,
    roughnessMap: arm,
    metalness: 0,
    side: DoubleSide,
  });
}

/**
 * A plane of the capture as a surface, with `holes` cut in it: built in the plane's own (u, v) and
 * turned into its x-z exactly as `@iwer/sem` builds its own planes, so it lies where the app is told.
 */
function shellOf(surface: RoomSurface, holes: Rect[], material: Material) {
  const shape = rectanglePath(new Shape(), surface.rect);
  shape.holes = holes.map((hole) => rectanglePath(new Path(), hole));
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  // The ambient occlusion map is read from the second set of coordinates unless told otherwise; they are the same here.
  geometry.setAttribute('uv1', geometry.getAttribute('uv'));
  const mesh = new Mesh(geometry, material);
  mesh.applyMatrix4(surface.matrix);
  mesh.name = surface.label;
  return mesh;
}

function rectanglePath<Outline extends Path>(path: Outline, rect: Rect): Outline {
  path.moveTo(rect.minU, rect.minV);
  path.lineTo(rect.maxU, rect.minV);
  path.lineTo(rect.maxU, rect.maxV);
  path.lineTo(rect.minU, rect.maxV);
  path.closePath();
  return path;
}

/** A box in a surface's upright frame: `centre` across, up and out of it, and `size` along the same. */
function boxIn(basis: Group, material: Material, centre: Vector3, size: Vector3) {
  const mesh = new Mesh(new BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.copy(centre);
  basis.add(mesh);
  return mesh;
}

function uprightGroup(surface: RoomSurface) {
  const { basis, width, height } = uprightFrameOf(surface);
  const group = new Group();
  group.applyMatrix4(basis);
  return { group, width, height };
}

function baseboardOf(wall: RoomSurface) {
  const { group, width, height } = uprightGroup(wall);
  group.name = 'baseboard';
  const bottom = -height / 2;
  boxIn(
    group,
    WHITE_PAINT,
    new Vector3(0, bottom + BASEBOARD.height / 2, BASEBOARD.depth / 2),
    new Vector3(width, BASEBOARD.height, BASEBOARD.depth),
  );
  return group;
}

/**
 * A window in the hole cut for it: the wall's depth round the hole, a painted frame with a mullion
 * about every metre, a sill into the room, faintly reflecting glass, and the daylight that comes in.
 */
function windowOf(opening: RoomSurface) {
  const { group, width, height } = uprightGroup(opening);
  group.name = 'window';
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const reveal = new Vector3(0, 0, -WALL_DEPTH / 2);
  boxIn(group, WHITE_PAINT, reveal.clone().setY(halfHeight + 0.005), new Vector3(width, 0.01, WALL_DEPTH));
  boxIn(group, WHITE_PAINT, reveal.clone().setY(-halfHeight - 0.005), new Vector3(width, 0.01, WALL_DEPTH));
  boxIn(group, WHITE_PAINT, reveal.clone().setX(-halfWidth - 0.005), new Vector3(0.01, height, WALL_DEPTH));
  boxIn(group, WHITE_PAINT, reveal.clone().setX(halfWidth + 0.005), new Vector3(0.01, height, WALL_DEPTH));

  const pane = -WALL_DEPTH * 0.6;
  const frameDepth = 0.07;
  const along = (x: number, y: number) => new Vector3(x, y, pane);
  boxIn(group, WHITE_PAINT, along(0, halfHeight - FRAME_WIDTH / 2), new Vector3(width, FRAME_WIDTH, frameDepth));
  boxIn(group, WHITE_PAINT, along(0, -halfHeight + FRAME_WIDTH / 2), new Vector3(width, FRAME_WIDTH, frameDepth));
  const panes = Math.max(1, Math.round(width / MULLION_EVERY));
  for (let index = 0; index <= panes; index += 1) {
    const x = -halfWidth + (index * width) / panes;
    const clamped = Math.min(halfWidth - FRAME_WIDTH / 2, Math.max(-halfWidth + FRAME_WIDTH / 2, x));
    boxIn(group, WHITE_PAINT, along(clamped, 0), new Vector3(FRAME_WIDTH, height, frameDepth));
  }
  boxIn(group, WHITE_PAINT, along(0, 0.1), new Vector3(width, FRAME_WIDTH * 0.7, frameDepth));
  boxIn(group, WHITE_PAINT, new Vector3(0, -halfHeight - 0.02, 0.06), new Vector3(width + 0.12, 0.035, 0.22));

  const glass = new Mesh(new PlaneGeometry(width, height), GLASS);
  glass.position.set(0, 0, pane);
  group.add(glass);

  // Overcast daylight through the opening, onto everything in front of it.
  const daylight = new RectAreaLight(0xe6eef8, 3.2, width, height);
  daylight.position.set(0, 0, 0.01);
  // A light shines down its own −z; the frame's +z is into the room.
  daylight.rotation.y = Math.PI;
  group.add(daylight);
  return group;
}

/** A photograph behind glass in a thin black frame with a white mount, filling the capture's wall art. */
function printOf(art: RoomSurface, print: Texture<HTMLImageElement>) {
  const { group, width, height } = uprightGroup(art);
  group.name = 'print';
  const depth = 0.03;
  const border = 0.025;
  boxIn(group, FRAME_BLACK, new Vector3(0, height / 2 - border / 2, depth / 2), new Vector3(width, border, depth));
  boxIn(group, FRAME_BLACK, new Vector3(0, -height / 2 + border / 2, depth / 2), new Vector3(width, border, depth));
  boxIn(group, FRAME_BLACK, new Vector3(-width / 2 + border / 2, 0, depth / 2), new Vector3(border, height, depth));
  boxIn(group, FRAME_BLACK, new Vector3(width / 2 - border / 2, 0, depth / 2), new Vector3(border, height, depth));
  const mount = new Mesh(
    new PlaneGeometry(width - border * 2, height - border * 2),
    new MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.9 }),
  );
  mount.position.z = depth * 0.4;
  group.add(mount);
  const image = pictureSizeWithin(
    print.image,
    new Vector2(width - border * 2, height - border * 2).multiplyScalar(0.8),
  );
  const picture = new Mesh(
    new PlaneGeometry(image.x, image.y),
    new MeshStandardMaterial({ map: print, roughness: 0.6 }),
  );
  picture.position.z = depth * 0.4 + 0.001;
  group.add(picture);
  return group;
}

/** The largest size with the picture's own proportions that fits inside `space`. */
function pictureSizeWithin({ width, height }: HTMLImageElement, space: Vector2) {
  const scale = Math.min(space.x / width, space.y / height);
  return new Vector2(width * scale, height * scale);
}

/** `model` turned by `turn` about the vertical, inside a group of its own, so it can be measured and fitted as turned. */
function facingFront(model: Object3D, turn: number) {
  const turned = new Group();
  const copy = model.clone(true);
  copy.rotation.y = turn;
  turned.add(copy);
  return turned;
}

/**
 * A model standing in `box`: scaled to its width, height and depth, its front (+z, as glTF has it)
 * turned to the box's front, on the box's floor. Shelving is repeated across and up the box in units
 * as near the model's own size as fit, so a wall of shelves is a wall of the same unit rather than
 * one unit stretched.
 */
function fitted(model: Object3D, box: RoomBox, tiles: boolean) {
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  const across = tiles ? Math.max(1, Math.round(box.width / size.x)) : 1;
  const up = tiles ? Math.max(1, Math.round(box.height / size.y)) : 1;
  const unit = new Vector3(box.width / across, box.height / up, box.depth);
  const piece = new Group();
  piece.name = box.label;
  for (let column = 0; column < across; column += 1) {
    for (let row = 0; row < up; row += 1) {
      const copy = model.clone(true);
      const bounds = new Box3().setFromObject(copy);
      const centre = bounds.getCenter(new Vector3());
      const scale = new Vector3(unit.x / size.x, unit.y / size.y, unit.z / size.z);
      copy.scale.multiply(scale);
      copy.position.set(
        -centre.x * scale.x + (column + 0.5) * unit.x - box.width / 2,
        -bounds.min.y * scale.y + row * unit.y,
        -centre.z * scale.z,
      );
      piece.add(copy);
    }
  }
  piece.position.copy(box.base);
  piece.rotation.y = Math.atan2(box.front.x, box.front.z);
  return piece;
}

/** A table lamp in the capture's lamp box: a glazed ceramic base and a linen shade, lit. */
function lampOf(box: RoomBox) {
  const lamp = new Group();
  lamp.name = 'lamp';
  const radius = Math.min(box.width, box.depth) / 2;
  const baseHeight = box.height * 0.55;
  const profile = [0, 0.55, 0.85, 1, 0.95, 0.7, 0.35, 0.18, 0.18].map(
    (width, index, all) => new Vector2(width * radius * 0.55, (index / (all.length - 1)) * baseHeight),
  );
  const base = new Mesh(
    new LatheGeometry(profile, 32),
    new MeshStandardMaterial({ color: 0x5f7b78, roughness: 0.18, metalness: 0.05 }),
  );
  lamp.add(base);
  const shadeHeight = box.height - baseHeight;
  const shade = new Mesh(
    new CylinderGeometry(radius * 0.7, radius, shadeHeight, 40, 1, true),
    new MeshStandardMaterial({
      color: 0xf1e8d8,
      emissive: 0xffd9a0,
      emissiveIntensity: 0.55,
      roughness: 0.95,
      side: DoubleSide,
    }),
  );
  shade.position.y = baseHeight + shadeHeight / 2;
  lamp.add(shade);
  const bulb = new PointLight(0xffc98a, 0.6, 3, 2);
  bulb.position.y = baseHeight + shadeHeight * 0.4;
  lamp.add(bulb);
  lamp.position.copy(box.base);
  return lamp;
}
