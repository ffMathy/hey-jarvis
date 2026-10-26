import {
  createHologramScene,
  type HologramFrameState,
  pictureSceneOf,
  type SatelliteOrbit,
  SCENE_SEED,
} from 'hologram';
import { createGpuPicture, drawGpuPicture, type GpuPicture } from 'hologram/gpu';
import {
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/**
 * How many pixels across the picture is.
 *
 * At 1.6 m the square is about 29° across, which on a Quest 3 is some 700 display pixels — but
 * the phone's own look is drawn at under half its screen resolution and scaled up, so 512 is
 * already sharper than the look it copies, at a quarter of the cost of 1024.
 */
export const PICTURE_SIZE_PIXELS = 512;

/** The headset draws its satellites in the room (`satellites.ts`), so none are drawn into his picture. */
export const NO_SATELLITES: readonly SatelliteOrbit[] = [];

/** What of three's renderer the picture is drawn through. */
export type PictureRenderer = Pick<WebGLRenderer, 'getContext' | 'getRenderTarget' | 'setRenderTarget' | 'resetState'>;

/** The phone's picture of everything but his body, drawn each frame into a texture the view-plane quad shows. */
export interface PictureTarget {
  /** The picture, bottom row first as a framebuffer is: the right way up in the quad's own coordinates. */
  texture: Texture;
  target: WebGLRenderTarget;
  /**
   * Draws `state` (`analyseFrame(frame, 1)`) with `satellites` over it into the target, then
   * hands three back whatever it was drawing into.
   */
  draw(state: HologramFrameState, satellites: readonly SatelliteOrbit[]): void;
  /** Lets go of the target; the picture's programs are the context's (see `pictures`). */
  dispose(): void;
}

/** GL's own bits for the colour, depth and stencil buffers, for the clear. */
const COLOUR_DEPTH_AND_STENCIL = 0x4000 | 0x0100 | 0x0400;

/**
 * The picture's programs, buffers and textures, made once on each context.
 *
 * They hold nothing of one hologram but its scene, which is SCENE_SEED's for every one of them,
 * and `hologram/gpu` has no call that deletes them, so a preview that makes a fresh hologram for
 * every still would otherwise compile a dozen programs each time and leave the last set behind.
 * Keyed weakly, so a room's are gone with its renderer's context.
 */
const pictures = new WeakMap<WebGL2RenderingContext, GpuPicture>();

/** The WebGL 2 context three draws with: three.js asks for nothing else, so anything else is a bug. */
function webGl2Of(renderer: PictureRenderer): WebGL2RenderingContext {
  const context = renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext)) throw new Error('three.js is not drawing with WebGL 2.');
  return context;
}

/**
 * The picture on `context`, made the first time it is asked for, with three's view of the GL state
 * reset round it: compiling and uploading binds programs, buffers and textures behind three's back.
 */
function pictureOn(renderer: PictureRenderer, context: WebGL2RenderingContext): GpuPicture {
  const made = pictures.get(context);
  if (made !== undefined) return made;
  renderer.resetState();
  const picture = createGpuPicture(context, pictureSceneOf(createHologramScene(SCENE_SEED)));
  renderer.resetState();
  pictures.set(context, picture);
  return picture;
}

/**
 * The target the picture is drawn into: a `size`-pixel square of bytes, with the depth and stencil
 * buffers the picture needs under it (`gpu-picture.ts` says why), and no colour space, since its
 * bytes are raw encoded sRGB as the phone's are and three is to convert nothing on the way in or out.
 */
export function createPictureRenderTarget(size: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(size, size, {
    type: UnsignedByteType,
    format: RGBAFormat,
    depthBuffer: true,
    stencilBuffer: true,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  target.texture.colorSpace = NoColorSpace;
  return target;
}

/**
 * A `size`-pixel target, drawn into with `hologram/gpu`'s picture on three's own context: the inner
 * shells, the lines, the core, the rim, the truss, the crescent, the fray, the chips — every layer
 * of the phone's drawing that leaves his body out. His body is drawn in three dimensions beside it.
 *
 * It is cleared to transparent black every frame and drawn unfaded: every layer of
 * him is premultiplied light Screened over that, which is the light alone, and the quad fades it with
 * the rest of him and turns it into colour and alpha for the passthrough.
 */
export function createPictureTarget(renderer: PictureRenderer, size: number = PICTURE_SIZE_PIXELS): PictureTarget {
  const context = webGl2Of(renderer);
  const picture = pictureOn(renderer, context);
  const target = createPictureRenderTarget(size);

  return {
    texture: target.texture,
    target,
    draw(state, satellites) {
      const previousTarget = renderer.getRenderTarget();
      // From GL's defaults, whatever three left set — a colour mask, a stencil mask, a scissor — and
      // then the target bound, as three binds one, with its viewport.
      renderer.resetState();
      renderer.setRenderTarget(target);
      context.clearColor(0, 0, 0, 0);
      context.clearDepth(1);
      context.clearStencil(0);
      context.depthMask(true);
      context.clear(COLOUR_DEPTH_AND_STENCIL);
      drawGpuPicture(context, picture, { state, pixels: size, satellites });
      // The picture leaves its blend on and its own programs, arrays and textures bound, none of
      // which three knows about; resetting forgets its target too, so that is bound again after.
      renderer.resetState();
      renderer.setRenderTarget(previousTarget);
    },
    dispose() {
      target.dispose();
    },
  };
}
