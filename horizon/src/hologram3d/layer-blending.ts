import {
  AddEquation,
  ConstantAlphaFactor,
  ConstantColorFactor,
  CustomBlending,
  type Material,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
} from 'three';

/**
 * How every part of him is laid over the room: Screen, faded as one layer.
 *
 * Every paint on the phone is Screen-blended over black — result = paint + behind × (1 − paint),
 * which for premultiplied light is ONE, ONE_MINUS_SRC_COLOR — and while he arrives or leaves the
 * whole drawing is faded as one layer (a saveLayer at `arrival`). Fading each part by itself
 * instead is brighter wherever parts overlap, since Screen(k·a, k·b) is more than k·Screen(a, b):
 * the brightest of him held up almost half as bright again as he left.
 *
 * So each part is drawn unfaded, and the fade k is the blend's constant colour instead:
 * result = k × part + behind × (1 − part). Starting from nothing, that is k × Screen of every part
 * so far, in any order — exactly the phone's faded layer — as long as what is behind is his own
 * light, which it is: the room is added by the compositor after the page has drawn.
 *
 * Alpha goes the same way (the constant alpha, and ONE_MINUS_SRC_ALPHA), so what he hides of the
 * room fades with him. See ALPHA_FROM_LIGHT for what alpha each part writes.
 */
export const LAYER_BLENDING = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: ConstantColorFactor,
  blendDst: OneMinusSrcColorFactor,
  blendEquationAlpha: AddEquation,
  blendSrcAlpha: ConstantAlphaFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
} as const;

/** Sets how much of a part drawn with LAYER_BLENDING shows: 1 in full, 0 not at all. */
export function setLayerFade(material: Material, fade: number) {
  material.blendColor.setScalar(fade);
  material.blendAlpha = fade;
}
