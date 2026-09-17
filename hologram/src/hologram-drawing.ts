// The J.A.R.V.I.S. hologram: the golden sphere of light that stands in for Tony
// Stark's AI in the Avengers: Age of Ultron lab scene, drawn every frame with React
// Native Skia's imperative canvas API from a Reanimated worklet.
//
// WHAT IT DEPICTS
// The film's J.A.R.V.I.S.: a round, glowing, translucent amber ball, brightest at its core
// and never dark inside — a see-through cloud of small lights rather than a painted surface,
// the warm volume behind them only a haze — textured with short bright "circuit" strokes,
// bounded by one dominant rim element at a time (a bright crescent on the left limb, a
// segmented ladder ring, or a thin ring) and a small hooked ring at the core. The film's
// large slow protrusions are deliberately not drawn: see the script below. Everything is
// warm orange to amber: no blue, no white, no halo past 1.1R. Measurements and requirements come from the film study
// (jarvis-reference.md), cited below by section.
//
// LAYERS, drawn back to front (unit space, R = 1, y down; clock angles in degrees
// clockwise from 12 o'clock)
//   (no warm volume)    The film's ball is a lit cloud, and this drawing used to paint one: a
//                       textured circle of amber haze under everything, arriving patch by patch
//                       while the ball formed. It is gone, at the user's asking — "I just want
//                       the particles to speak for themselves". Nothing lights the places where
//                       no fragment lands now, so the ball is see-through to the background
//                       between its strokes and reads as a swarm rather than as a surface. That
//                       is a deliberate departure from the film study's section 6.4, which wants
//                       an opaque volume and under 5% of the disc dark; do not read the dark
//                       between the particles as a regression and paint it back in.
//   drawInnerShells     the whorl: two wide spiral arms winding out of the core to 0.76R,
//                       furry with short fragments across them, plus the long loop rising 37°
//                       past the core, the saturated ")" arc at 0.57R and the faint near half of
//                       the edge-on ellipse — all of it turning the other way; and data streaks
//   drawBody            the fragment body's dim and mid strokes: 1680 fragments inside 0.94R
//                       (four in five plain dashes, the rest L, bracket, T, Z glyphs, rings and
//                       cell outlines mostly near the core; median 0.083R, clumped into the mass
//                       with bare fill between the clumps, heavier on the left) and a
//                       336-fragment turning shell in the lower hemisphere. Half of those between
//                       0.3R and 0.62R ride the counter-turning inner layer; the rest are pinned.
//                       Every tier carries a halo of its own — two nested rings that step up from
//                       nothing at the outer reach to the stroke — so the light between the
//                       strokes comes from the strokes rather than from the wash behind them, and
//                       goes out and comes back on each fragment's own clock. Mid and
//                       bright strokes vary in brightness along their length (a tiled sparkle
//                       texture). Fewer strokes than the film's, each wider than its hairlines
//                       would be, so the texture reads as ribbons rather than as line art (film
//                       run widths 0.022-0.031R)
//   drawLines           comet arcs curling from the core to the lower right; radial spokes
//                       or a swoosh fan of hairlines when the script calls for them
//   drawCore            elongated bloom with a darker middle, the hooked 0.1R ring softened by
//                       its glow, the bar, and a furry knot of spikes on the ring's upper left,
//                       re-drawn 6 times a second
//   drawBodyHighlights  the bright fragments with a wide glow that steps down to nothing over
//                       its outer half, and a narrow hot core
//                       (the film's #ffd26c, pulled toward orange so stacked strokes stay
//                       amber)
//   drawThinRing        a hairline circle at 1R, brightest from 1 to 4 o'clock, over a lumpy ridge
//                       of light just inside the limb that rolls with the rim layer, painted as
//                       a band rather than a disc (see LIMB_RIDGE_BAND)
//   drawTruss           the rolling rim layer: the ladder truss (a hot outer rail at 1.035R, a
//                       finer inner rail at 0.935R, amber haze between them, fine rungs about
//                       every 9°, circuit traces, paired hanging struts, 190° of arc in three
//                       pieces), the thin ring's ticks where they pass 1-5 o'clock, and the fan
//                       of strands on the right
//   drawCrescent        the bright left crescent from 11 o'clock round to 7: four strands in
//                       width tiers (glow, thin #dca131, medium, wide, #ffda53 core) and a
//                       tight limb bloom (a radial ring profile times a sweep mask, painted
//                       as a band round the limb rather than as a disc — see LIMB_BLOOM_BAND)
//   drawFray            while he talks: strands fraying off the upper-left limb, streak arcs
//                       at 1.2-1.27R, and horizontal streaks slipping out of the right limb
//                       equator at 9 o'clock and a shorter, finer one at the upper left; then the
//                       ribbon loop, hook tendril, streak bundle and pole fan (glowing rails,
//                       never quite regular)
//   drawChips           the latest burst's rim chips: solid amber slabs that break up rather
//                       than fade
//   drawAccents         the jagged lightning filament and the very rare two-frame red segment
//   drawIntro           only while materialising: point of light, sparks, band pieces, the spoked
//                       dial (pieces of uneven length that thin to a rail and break into ragged
//                       chips), and the tilted equatorial ring of rails and fine ticks
//
// IDLE MOTION (section 3; nothing breathes, pulses or flickers as a whole)
// - The outer rim layer rolls clockwise in the screen plane at 11°/s: the truss, the thin
//   ring's ticks, and the breaks in the crescent's strands (the crescent's brightness
//   itself stays on the left, where the film shows it).
// - The inner layer — the whorl, the loop, the ")" arc and half of the fragments between
//   0.3R and 0.62R — turns counter-clockwise at 5°/s about the core;
//   the strand fan turns counter-clockwise at 3.5°/s and fades in and out on a 14 s cycle.
//   Nothing outside 0.62R turns either way: that band is where the film's body stands still,
//   and it is the pinned fragments in it that have to hold the picture there.
// - The rest of the fragment body does not turn. Each fragment lives on its own clock, lit for
//   0.18-0.4 s, growing out of nothing and shrinking back into it over a third of that, and
//   re-lighting up to FRAGMENT_WANDER along or across from where it was — about a tenth renewed
//   per film frame, as measured, which with twice as many fragments is what makes the idle ball
//   read as alive rather than as a still picture: 4.2 luma of change per 1/24 s over the 256 px
//   square, against 1.6 before, where the film shows 5-10. (That figure hardly moves with the
//   window it is measured over — 4.18, 4.21, 4.21, 4.15 at 6, 8, 10 and 16 s — because in
//   silence every clock here runs at a fixed rate.) Below
//   the core, a shell turns about the vertical axis at 0.21 rad/s, so its front drifts
//   right at 0.1-0.2 R/s and its dimmer back drifts left: the film's counter-streams.
// - The core's brightness drifts ±3% over about 12 s; comet arcs grow, slide and fade
//   over 5-9 s each.
// - A script (a loop of 12 epochs, 3-8 s each, about 59 s in all, plus a second track
//   on a 41 s period) decides which rim element dominates — the other two stay faintly
//   present, handing over within 1.2 s — whether spokes, a swoosh or a lightning filament
//   show, how dense the fragments are (0.9-1.02), and when the red segment flashes.
//
//   It used to bring out a protrusion per epoch as well, on two tracks: truss booms, ribbon
//   loops, hook tendrils, streak bundles and pole fans standing off the limb, each growing
//   over 0.5-1.5 s, holding 1-3 s and dissolving through a hollow outline into sparks. They
//   are the film's, and they are gone at the user's request: on a phone, where the sphere is
//   small and the loop comes round every minute, they read as an arm swinging out of the ball
//   in the same pattern rather than as the scenery of Tony's lab.
//
// HOW THE FRAME DRIVES IT (see analyseFrame). The film's sphere does not brighten or
// swell with his voice, so neither does this one: disc brightness while talking stays
// within a few percent of silence and the silhouette within 1%. Speech shows as activity.
//   time        drives every clock above; every rate is fixed, so nothing depends on
//               level × time and nothing jumps.
//   level       deliberately unused: loudness has no counterpart in the film.
//   speaking    unused too: agitation already says whether he is talking, and a flag that
//               flips within one frame would make the sphere jump.
//   agitation   gated by the intro (below), then:
//               - mix = 0.5·agitation: calm fragments whose ids fall below mix fade out and
//                 fast fragments (lit 0.06-0.14 s) whose ids fall below 2·mix fade in. Half
//                 and no more, because the two make up for each other exactly at that share
//                 and not past it; so the count lit, and the brightness, hold while the churn
//                 nearly doubles: over the check's recorded line, 4.18 luma per 1/24 s silent
//                 against 7.77 while he talks, both measured over the first six seconds of it.
//                 (Unlike the silent figure the speaking one does depend on that window, because
//                 the recording falls quiet: over sixteen seconds it reads 6.07 against 4.15,
//                 still half again as much, and the drawing this replaced degraded the same way.)
//                 Each
//                 fragment also re-lights up to a fifth of a radius from where it was, less so
//                 the nearer the limb it is — the silhouette must not move with his voice
//               - hotShare = 1 − 0.35·agitation: the share of bright fragments still drawn
//                 bright. Their hot cores all but go (−95%), which is what takes the film's
//                 luma-200 highlights out on "Doctor." while the strokes stay bright
//               - spread = agitation·(0.7 + 0.3·low), low = clamp((mean of bands 0-5 −
//                 0.35) / 0.45): the crescent's strands move from 0.965-1.03R out to
//                 0.94/1.02/1.10/1.19R, thin (wide tier −62%, medium −45%), open gaps, the
//                 outer two gather 28° toward the upper left and shorten 40%, and every strand
//                 keeps streaming out and back at about 0.1 R/s. Its hot core fades as
//                 (1 − spread)², while its limb bloom holds, so the silhouette does not shrink;
//                 the crescent shows at no less than
//                 0.65·agitation even when another element leads
//               - fray = agitation·(0.55 + 0.45·high), high = clamp((mean of bands 14-23 −
//                 0.2) / 0.45): which fray strands (drifting out 0.12R per cycle), streak
//                 arcs and right-limb streaks (0.3 R/s) show; each is a slot on its own clock
//                 that agitation only lets through, fading by length
//   burstAge, burstStrength, burstCount
//               while burstAge < 0.2 s the latest burst's 3 + round(2·strength) chips are drawn
//               (the strength as the tracker gave it, so a burst in flight while the ball is
//               still forming cannot gain a chip): #f59a30 slabs with a hot middle and a soft
//               edge, leaving the left limb about mid-height (clock 255-290°, or split between
//               250° and 300° for one burst in three, chosen by hashing burstCount) from 1.04R.
//               One leads, up to 0.33R along the limb by 0.14R across and thrown at 1.6-2.3 R/s;
//               the others are half its length or less at 0.9-2.1 R/s, spread over 50° of limb
//               round it rather than stacked at one clock. A small onset throws three, a loud
//               one five. All of them fall 8-22° counter-clockwise toward 8 o'clock. Fully lit
//               for 0.13 s, then each thins, shortens and snaps in two until it is gone at
//               0.2 s. For 0.18 s the crescent loses pieces within 16° of the launch point.
//               Bursts come in flurries of four a quarter of a second apart and then rest for
//               0.6 s (the tracker's rule). On the check's recorded line that works out at
//               1.33 bursts a second of speech, so chips are on screen for about a third of
//               the frames he speaks in — the density of the film's "Doctor.", which shows
//               them in 10 of its 37 frames. How many onsets the line offers is set by the
//               tracker's ONSET_RISE, which cannot fall much further without a swell counting
//               as an onset. Only the latest burst is ever still in flight.
//   appearance  keyframe time k = appearance / 0.75: the film's section 5 keyframes run
//               over k 0-1 (2.7 s of MATERIALISE_SECONDS = 3.6 s) and the crescent grows
//               back in over k 1-1.33. Point of light k 0-0.32; sparks from 0.06 (a row
//               the spoked dial snaps on within 0.12, in pieces of
//               uneven length, brightens to 0.3, loses its spokes by 0.64 and its right arc by
//               0.69, and stays solid and hot until it breaks up over 0.7-0.9, each piece thinning
//               to its outer rail, shortening from one end and drifting off the band; the tilted
//               equatorial ring of rails and fine ticks (front and right side only) sweeps in over
//               0.62-0.77 and drops out piece by piece over 0.84-0.96. The fragments arrive in
//               patches, behind the band on the left first (revealKey), over 0.45-0.69, and the
//               fill follows them patch by patch over 0.55-0.81; both run hot over 0.55-1, with
//               a ragged left limb until 0.78-1; inner shells from 0.62, the core from 0.72,
//               the rim layer from 0.84, and agitation and chips only
//               from 0.8. At appearance 1 nothing of the intro is left.
//
// PERFORMANCE AND WORKLET RULES
// - drawHologram and every helper it calls are worklets ('worklet' directive) that use
//   only their arguments and module-level number constants: no module-level mutable state,
//   no closures over outer values, no Math.random while drawing. Randomness comes from the
//   seeded scene, and per-cycle variation from an integer hash.
// - The scene is flat number arrays (about 20,000 numbers), cloned into the worklet runtime
//   once. Doubling the fragment body would have put it half as far over that again, so the
//   body's rows lost two numbers each instead (see buildBody). The fill and sparkle
//   textures and the whorl are built straight into Skia images and paths from a seed in
//   the resources, so they are never copied. The textures are small
//   (128² and 64²) and built with table lookups and separable noise, because this runs on the
//   JS thread at every mount, on a phone, under an interpreter with no JIT.
// - Build the scene and the resources ONCE per mounted canvas (a stable useMemo with no
//   changing dependencies). The resources hold mutable PathBuilders, so two mounted
//   canvases must never share one resources object.
// - Every PathBuilder is made once in createHologramResources, reset at the start of each
//   frame (so an exception mid-frame cannot leak contours into the next one) and reused:
//   detach() hands out the path and resets the builder.
// - Every paint uses Screen blending, so faint overlapping strokes add up like light: glow
//   comes from nested strokes, gradients and the prebuilt textures, with no blur filters —
//   a Gaussian mask filter was measured and costs more than the ring it would replace,
//   because its price follows a path's bounding box rather than its ink. It is drawn over
//   black.
// - Three rules keep the widest paints affordable. A shader that is transparent over most of
//   the disc is painted as a band, not a disc (LIMB_BLOOM_BAND); the particle halos — the
//   widest strokes here, seven paths a frame at two rings each — are the one thing drawn
//   without antialiasing (HALO_ANTIALIASED); and the inner of those two rings is butt-capped,
//   where a fragment's halo is otherwise almost all cap (see drawParticleHalo). About a quarter
//   of the frame between them, which is what lets this drawing render faster than the sparser
//   one it replaced while carrying twice as many particles.
// - Geometry lives in unit space under canvas.translate(centre)·scale(R), so gradient
//   shaders are built once, and the rolling layers are drawn under canvas.rotate. Beyond
//   paints, gradients and path builders, the textures use Data.fromBytes, Image.MakeImage
//   (raster RGBA from bytes), Image.makeShaderOptions, Shader.MakeColor and Matrix().scale;
//   like Shader.MakeBlend, MakeSweepGradient and PathBuilder.addCircle, each exists in React
//   Native Skia 2.6.2's JSI API and in CanvasKit alike.
import type { SkCanvas, Skia } from '@shopify/react-native-skia';
// The enums come from the package's type module rather than from its root, which
// imports react-native and so cannot load under `bun test` — where this file is
// drawn for real, headlessly, in hologram-drawing.spec.ts. They are the same values.
import {
  AlphaType,
  BlendMode,
  ColorType,
  FilterMode,
  MipmapMode,
  PaintStyle,
  StrokeCap,
  TileMode,
} from '@shopify/react-native-skia/lib/module/skia/types';

/** What one frame of the hologram is drawn from. */
export interface HologramFrame {
  /** Seconds since the hologram mounted, accumulated per frame. All motion derives from this. */
  time: number;
  /** Jarvis's voice level, eased, 0–1. */
  level: number;
  /** Frequency bands of his voice, eased, 0–1 each, lowest first (see voice-levels.ts). */
  bands: number[];
  /** Whether he is speaking, as opposed to the conversation merely being open. */
  speaking: boolean;
  /** 0–1 speech-activity envelope: rises over about 0.15 s while speech is present, releases over about 0.4 s. */
  agitation: number;
  /** Seconds since the latest chip burst began; 10 or more when there has been none. */
  burstAge: number;
  /** 0–1 strength of the latest burst. */
  burstStrength: number;
  /** How many bursts there have been, so each throws its chips from a different, repeatable place. */
  burstCount: number;
  /** 0–1 materialisation progress, 1 = formed: the view passes min(1, time / MATERIALISE_SECONDS). */
  appearance: number;
  /**
   * 0–1: how much of him is here at all. 1 unless he is leaving.
   *
   * Not the same thing as {@link appearance}, and that is the point: appearance runs the
   * materialisation, and running *that* backwards would bring the intro's swirling dial back on
   * the way out. This fades and shrinks the formed sphere instead, which is the arrival's own
   * gesture without its ceremony.
   */
  presence: number;
  /**
   * 0–1: how much of Jarvis's attention is on a thought rather than on you.
   *
   * Not a voice, and deliberately nothing like one. See {@link SCAN_SECONDS}: at 1 the swarm goes
   * quiet and a plane sweeps up through him, lighting only what it passes. The view eases this in
   * and out so entering and leaving a thought is a fade rather than a switch.
   */
  thinking: number;
}

/**
 * The part of Skia the hologram draws with, and no more.
 *
 * Narrow on purpose. The app passes Skia from the package root; the headless test
 * passes the same API built over CanvasKit from the package's `lib/module` build,
 * whose declarations TypeScript treats as a separate copy. The members used here
 * are identical in both, so asking only for those lets both pass without a cast.
 */
export type HologramSkia = Pick<typeof Skia, 'Color' | 'Data' | 'Image' | 'Matrix' | 'Paint' | 'Path' | 'Shader'>;

/** The canvas calls the hologram makes, for the same reason. */
export type HologramCanvas = Pick<
  SkCanvas,
  'drawCircle' | 'drawPath' | 'restore' | 'rotate' | 'save' | 'saveLayer' | 'scale' | 'translate'
>;

type SkiaApiType = HologramSkia;

// ---- constants (unit space: the sphere's radius R is 1, y points down) ---------------------
// Clock angles are degrees clockwise from 12 o'clock, as the film study measures them.

/**
 * How long the view takes to count appearance from 0 to 1. The film's keyframes
 * reach a formed ball at 2.7 s (see FORMED_APPEARANCE); the last 0.9 s grows the
 * bright left crescent back in, as the film's does once the ball has formed.
 */
export const MATERIALISE_SECONDS = 1.4;
/** The appearance at which the film's materialisation keyframes reach "formed": 2.7 s of 3.6. */
const FORMED_APPEARANCE = 0.75;

/**
 * Sphere radius as a fraction of the square, at rest.
 *
 * Small, and it does not mean what it looks like it means. The square is not the screen: the view
 * makes it half again wider (see `useWholeScreenHologramSize`), so this fraction times that is a
 * sphere about 0.6 of the screen across — which is what you actually see.
 *
 * The room is for what leaves him. Chips are thrown to about 1.6R on a syllable and the sphere is
 * swollen by up to SWELL_WITH_VOICE while that happens, so the drawing needs something near 1.9R
 * of square around the middle or they are cut off in mid-air. It had 1.56R, and the user saw
 * exactly that: "some of the particles that flow outwards are clipped ... its particles should be
 * able to extend further out without being clipped." It has 2.1R now.
 *
 * Paying for that in canvas rather than in sphere is deliberate, and it is nearly free: Skia only
 * rasterises what is drawn, the drawn things are all sized from the sphere, and the shadow is
 * capped in sphere radii too (BACKDROP_REACH). What the extra square costs is the surface it is
 * cleared on, not the picture painted into it.
 */
export const SPHERE_FRACTION = 0.235;
/** The outer rim layer rolls clockwise in the screen plane: one turn in about 33 s, as the film's ladder ring. */
export const ROLL_DEGREES_PER_SECOND = 11;
/**
 * The inner layer turns the other way (shot d: -1.6 to -5.4°/s): the whorl, the loop, and half
 * of the shell's fragments between 0.3R and 0.62R — the band the whorl itself turns in, and the
 * only band the rim-roll check lets drift.
 */
export const SHELL_DEGREES_PER_SECOND = -5;
/** The lower hemisphere's equatorial shell turns about the vertical axis, which reads as a sideways stream. */
const STREAM_RADIANS_PER_SECOND = 0.21;
/**
 * The body turns about the vertical axis, like a globe.
 *
 * The film's does not — its interior is measured at under 1-3°/s, and the drawing held it
 * pinned for that reason. On a phone it read as inert: the rim rolling round a still ball is
 * a much weaker cue than the ball itself turning, so the user asked for the constant rotation
 * the first hologram had back. This is that one's rate, 0.26 rad/s, a turn every 24 s.
 */
const BODY_RADIANS_PER_SECOND = 0.26;
/** How long one turn of the body takes. */
export const BODY_TURN_SECONDS = (2 * Math.PI) / BODY_RADIANS_PER_SECOND;

/** How far the body has turned, in radians, at `time`. */
export function bodyTurnRadians(time: number) {
  'worklet';
  return time * BODY_RADIANS_PER_SECOND;
}
/**
 * How much brighter the whole drawing gets while Jarvis speaks. **A tenth, at the user's asking.**
 *
 * Back to the film, after a long way round. The film's sphere holds its brightness to within about
 * 3% through "Doctor." and shows speech as *behaviour*: fragments turning over faster, the
 * crescent splitting, the limb fraying, slabs of light breaking off on syllable onsets. This
 * drawing pinned that, then departed from it — the user could not tell on a phone whether he was
 * talking, so a glow went in at 0.3, and then 0.8, 2.4, 1.6, 1.1 and 1.35 as each version was seen
 * on a real screen. With the sphere now most of the screen wide and the sparks drawn out into
 * lines, the movement reads on its own, and the user has asked for the brightening gone: "the glow
 * of the sparks shouldn't increase. Just their positions outwards as it is today."
 *
 * It was set to 0 first, which is the film exactly, and the user then asked for a tenth back — so
 * what is here is a hint rather than a signal, under the few percent the film itself varies by.
 * The rest of what speech does is untouched by it: the swell, the spread, the fray, the chips and
 * the churn are all movement, and movement is what says he is talking.
 *
 * It is a number rather than a deleted mechanism precisely because it has been asked for in both
 * directions six times. Raising it is one edit.
 */
export const GLOW_WITH_VOICE = 0.1;
/** How much of the glow answers "is he talking at all" rather than "how loudly". */
const GLOW_FROM_ENVELOPE = 0.65;
/**
 * How much bigger the whole sphere grows at full voice.
 *
 * The film's holds its radius to within 1%, and the drawing used to as well — a sphere that
 * swells with the voice was exactly the "level meter" the film study warned against. This is
 * the user's call, after the glow alone still read as too quiet a signal on a phone: it
 * pulsates now, and 8% is enough to see without the silhouette lurching.
 */
const SWELL_WITH_VOICE = 0.18;
/** How small the sphere starts before it grows into place. */
const ARRIVAL_SMALLEST = 0.55;
const DEGREES_TO_RADIANS = 0.017453292519943295;
/** The core sits a hair up and left of centre, well inside the film's 0.08R. */
const CORE_X = -0.02;
const CORE_Y = -0.02;
/** How long a burst's chips stay fully lit, in seconds, and when the last of them has broken up and gone. */
const CHIP_HOLD_SECONDS = 0.13;
const CHIP_GONE_SECONDS = 0.2;

// Strides of the flat scene tables (the builders describe the fields).
const BODY_STRIDE = 10;
const STREAM_STRIDE = 11;
const CRESCENT_PIECE_STRIDE = 3;
const CRESCENT_PIECES_PER_STRAND = 14;
const TRUSS_PIECE_STRIDE = 6;
const FRAY_STRIDE = 5;
const STREAK_ARC_STRIDE = 6;
const LIMB_STREAK_STRIDE = 5;
const RING_TICK_STRIDE = 2;
const EPOCH_STRIDE = 10;
const COMET_STRIDE = 5;
/** Side of the tiled sparkle texture in texels, and how wide a texel is on the sphere: a stroke spans about two. */
const SPARKLE_TEXTURE_TEXELS = 64;
const SPARKLE_TEXEL_SIZE = 0.018;

/**
 * The limb bloom and the limb ridge are rings of light round the edge of the ball, and their
 * shaders are transparent over everything inside about 0.89R. Painting them as filled discs
 * still shades every pixel of the disc and blends a transparent result over it, which on these
 * two — the widest layers in the drawing — was a twelfth of the whole frame for nothing. They
 * are painted as bands instead: a stroked circle of these widths, centred so the band covers
 * everything the shader is not transparent over, with the inner edge well inside the transparent
 * part so its antialiasing multiplies by zero and the pixels come out identical. Measured over
 * a script's worth of frames — the intro, silence, three speaking levels and five burst ages,
 * at 384 px — not one channel of one pixel differs, and the frame is 8% cheaper.
 */
/**
 * The backdrop's shadow: black under the sphere, gone by the edge of the square it is drawn in.
 *
 * Jarvis is drawn over whatever the user was already looking at — a home screen, another app —
 * and on a pale one he washed out: warm amber strokes over a bright photograph read as a smudge
 * rather than as a hologram. This is a soft shadow under him, so the sphere always has something
 * dark to sit against wherever it is summoned. Asked for by the user, and their phrasing is the
 * design: "black in the center and transparent towards the edges, to help emphasize it and pop it
 * out more".
 *
 * **Its reach is not a constant, and that is the whole point.** It was 2.1 sphere radii, which at
 * this SPHERE_FRACTION is wider than the square the hologram is given — so the circle was cut off
 * by the canvas and the shadow ended in four straight edges, a visible box around Jarvis on the
 * home screen. The reach is worked out per frame instead, as exactly half the square, so the
 * shadow is the square's inscribed circle: it reaches zero precisely where it would otherwise be
 * clipped, and the corners past it are left untouched. It holds whatever the voice does to the
 * sphere's size, which is what made the old fixed reach wrong in two different ways at once.
 *
 * It is inside the arrival fade, so it comes up with him rather than appearing first as a dark
 * disc on an empty screen.
 */
/**
 * Side of the backdrop's prebuilt ramp, in texels.
 *
 * Drawn from a texture rather than from a gradient shader, and the difference is not small: a
 * radial gradient evaluated over a circle this wide — several times the sphere's own area
 * — cost 11 ms a frame at 384 px, a 42% rise on the whole drawing, which on a phone the user had
 * already called laggy is not a trade worth making for a shadow. Sampling a small image costs
 * nothing measurable. Ninety-six texels across four radii is a change of about one alpha level per
 * two output pixels at any size a phone or a watch draws, so there is nothing to band.
 */
/**
 * What Jarvis does while he is working rather than talking: a plane sweeps up through him.
 *
 * The user asked for a thinking state that does "something completely different", and everything
 * else the sphere does is some mixture of turning, churning and glowing. This is none of those. A
 * horizontal plane travels from the bottom of the ball to the top, and only the fragments it is
 * passing stay lit — the rest fall to {@link SCAN_FLOOR} of their strength, so the swarm goes
 * quiet and a single bright band crosses it. Whatever the band touches is promoted to the bright
 * tier, so the pass reads as a line of attention moving through him rather than as a shadow.
 *
 * It is reading himself, a slice at a time. When the plane reaches the top a ring blooms out from
 * the core to the limb — see {@link PULSE_SECONDS} — and the next pass begins. That bloom is the
 * step finishing, and it is why thinking needs no chip bursts: bursts are what speech does, and a
 * thought that looked like speech would be the one thing this must not be.
 *
 * A pass is slow on purpose. Fast, it reads as a scanner in a film; at this rate it reads as
 * deliberate, which is the half of Jarvis this is for.
 */
const SCAN_SECONDS = 2.6;
/** How wide the lit band is, in sphere radii: a quarter of him at a time. */
const SCAN_HALF_WIDTH = 0.38;
/** What is left of a fragment the plane is nowhere near. Not zero: he is thinking, not gone. */
const SCAN_FLOOR = 0.12;
/** How near the middle of the band a fragment has to be to be lit to the bright tier. */
const SCAN_BRIGHT_NEARNESS = 0.55;
/** How long the ring takes to bloom from the core to past the limb, at the end of each pass. */
const PULSE_SECONDS = 0.55;

const BACKDROP_TEXELS = 96;
/**
 * The backdrop's darkness, as distance from its middle — 0 to 1 across its reach — paired with
 * alpha.
 *
 * It holds nearly flat out to 0.55, which covers the sphere and a little past its limb, so the
 * whole of Jarvis sits on the same dark and only what is beyond him fades. A ramp that started
 * falling at the middle left the limb half as dark as the core, and the sphere read as sitting in
 * a dip rather than on a shadow. The last stop is zero, which is what lets the circle end exactly
 * at the square's edge with nothing to see there.
 *
 * Raised from 0xcc to 0xf4 at the middle, at the user's asking: over a bright home screen the
 * lighter version left him sitting in a haze rather than on something. Under him it is now all but
 * black, which is what a hologram is supposed to be seen against.
 */
const BACKDROP_RAMP = [0, 0xf4, 0.66, 0xe2, 0.8, 0x9a, 0.92, 0x38, 1, 0];
/**
 * How far the shadow reaches, in sphere radii.
 *
 * Far enough to be a shadow around him rather than a disc behind him, and no further: past this it
 * is paying for pixels out where the chips fly, which nobody reads as shadow. The ramp above is in
 * fractions of *this*, and 0.66 of it is 1.05R — so the flat part covers the sphere and stops just
 * past the limb, which is the edge Jarvis actually has to read against.
 */
const BACKDROP_REACH = 1.6;
const LIMB_BLOOM_RADIUS = 0.995;
const LIMB_BLOOM_BAND = 0.25;
const LIMB_RIDGE_RADIUS = 0.955;
const LIMB_RIDGE_BAND = 0.17;

/**
 * The particle halos are the one thing in the drawing painted without antialiasing, and that is
 * what pays for their second ring.
 *
 * Analytic antialiasing of a wide stroke is expensive out of all proportion to what it buys
 * here: on this drawing, switching it on for the halo paints alone takes the frame loop from
 * 3651 ms to 4430 ms — a fifth of the whole frame — because the halos are the widest strokes in
 * the scene and there are seven paths of them a frame. What it buys is a smooth edge, and a halo
 * ring's edge is a step of eighteen luma against the amber behind it. So the saving pays for the
 * second ring and more: two aliased rings come in *under* the single antialiased pass they
 * replace (by 56 to 303 ms over several runs), and halve that step at the same time. What it
 * costs is one jagged pixel on an eighteen-luma boundary: invisible at 1:1 and only findable at
 * four times magnification.
 *
 * Still false with the halo now built of {@link HALO_RINGS} rings rather than two. The outermost
 * carries a fifth of the alpha two rings gave it, so its edge is a step of about four luma —
 * turning antialiasing on for it costs a fifth of the whole frame's rasterising and, side by
 * side at six times magnification, is barely tellable from this.
 */
const HALO_ANTIALIASED = false;

/** A fragment is lit for this share of its clock's cycle, fading in and out over a third of that at each end. */
const FRAGMENT_DUTY = 0.6;
/**
 * A body fragment's code holds its class — brightness (0-2) + 3 × pool + 6 × rides the turning
 * shell, so 0 to 11 — and its glyph above that, at this step. See {@link buildBody} for why the
 * two share a number.
 */
const FRAGMENT_CODE_GLYPH_STEP = 12;
/**
 * The multiplier that turns a fragment's id into its blink phase. Any multiplier with a long
 * fractional part scatters a uniform id into a uniform phase; this one is far from every other
 * multiplier the id is hashed by, so no two of its uses line up.
 */
const FRAGMENT_PHASE_FROM_ID = 37.9;
/**
 * How lit a fragment must be to be drawn at all. Below this it is a tenth of its length under a
 * paint that does not fade with it, so it costs a path verb and shows a dot. It is also how
 * abruptly a fragment arrives — the paint is set once for the whole tier, so a fragment cut off
 * at this strength appears at full colour, however short — and with twice as many fragments,
 * both of those matter: much higher and every arrival is a step rather than a fade; much lower
 * and a twentieth of the frame's verbs go on strokes too short to see.
 */
const FRAGMENT_FAINTEST = 0.1;
/**
 * How far from its place a fragment may re-light, in R, on top of the half-length it already
 * slides along itself. Getting on for two median fragment lengths: far enough that the stroke that goes
 * out and the one that comes on light different pixels — which is what the film's turnover
 * counts — and near enough that the mass, the clumping and the crowded left half stay put.
 */
const FRAGMENT_WANDER = 0.06;

/** The rim element that dominates takes this long to hand over to the next. */
const HANDOVER_SECONDS = 1.2;

// ---- scene: random geometry, built once on the JS thread ---------------------------------

type Random = () => number;

/** A Mulberry32-style seeded generator: the same seed always builds the same hologram. */
function createRandom(seed: number): Random {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How much of the film's fragment mass a spot keeps. The mass is uneven: the
 * left half of the ball is nearly full, the upper right thinner and the lower
 * right thinnest (shot g: 94-98% orange on the left, 66% upper right, 41% lower right).
 */
function massWeight(x: number, y: number) {
  if (x < 0) return y < 0 ? 1 : 0.93;
  return y < 0 ? 0.78 : 0.52;
}

/**
 * Where the fragments crowd: the film's circuit texture comes in clumps and bands
 * with darker, emptier stretches between them, not as an even pepper.
 */
function clusterWeight(x: number, y: number) {
  const waves =
    Math.sin(5.3 * x + 1.7) * Math.sin(4.1 * y - 0.6 + 1.9 * x) +
    0.6 * Math.sin(9.7 * y + 2.3 * x + 0.4) +
    0.35 * Math.sin(13.1 * x - 7.3 * y + 2.9);
  return Math.min(1, Math.max(0.04, 0.5 + 0.48 * waves));
}

/** A fragment's direction: mostly near-horizontal, a fifth vertical, the rest diagonal; tangential near the limb. */
function pickFragmentAngle(random: Random, x: number, y: number) {
  const radius = Math.hypot(x, y);
  if (radius > 0.8 && random() < 0.35) return Math.atan2(y, x) + Math.PI / 2 + (random() - 0.5) * 0.3;
  const roll = random();
  if (roll < 0.52) return (random() - 0.5) * 0.42;
  if (roll < 0.7) return Math.PI / 2 + (random() - 0.5) * 0.35;
  return random() * Math.PI;
}

/**
 * A fragment's length: median 0.083R, 90th percentile 0.17R, and a few long streaks up to 0.38R.
 *
 * Longer than the film's, at the user's asking, and the reason is the stroke width rather than
 * the film. A body stroke is 0.014-0.0165R wide, so at the median length this used to have —
 * 0.036R, which is what the study measures — a fragment was barely twice as long as it was wide,
 * and a capsule that stubby reads as a bead, not as a spark. At this median it is five times its
 * own width, which is the point at which the eye calls it a line.
 *
 * Nothing else about them changed: the same count, the same places, the same glyph mix. They are
 * only drawn out.
 */
function pickFragmentLength(random: Random) {
  if (random() < 0.03) return 0.18 + random() * 0.2;
  return 0.03 + 0.15 * random() ** 1.5;
}

/**
 * A fragment's shape: 0 dash, 1 L, 2 bracket, 3 T, 4 Z, 5 tiny ring, 6 cell outline.
 *
 * Four fragments in five are plain dashes. With twice as many fragments in the body as
 * before, the mix leans further toward the two-verb dash than the film's own count would
 * (it shows rather more corners and brackets): a path verb costs the same whatever it
 * draws, so this is what pays for the second thousand strokes. The glyphs that read as
 * circuitry are still there, and they are still where the eye goes — round the core, where
 * pickGlyphAndLength keeps them.
 */
function pickGlyph(random: Random) {
  const roll = random();
  if (roll < 0.84) return 0;
  if (roll < 0.9) return 1;
  if (roll < 0.93) return 2;
  if (roll < 0.96) return 3;
  if (roll < 0.98) return 4;
  if (roll < 0.995) return 5;
  return 6;
}

/** Brightness class: 0 dim, 1 mid, 2 bright (the bright ones are the hot highlights speech thins out). */
function pickBrightness(random: Random) {
  const roll = random();
  if (roll < 0.12) return 2;
  return roll < 0.62 ? 1 : 0;
}

/**
 * How often a fragment's clock cycles. Calm fragments (pool 0) stay lit 0.6-1.3 s; agitated
 * ones (pool 1) about a third of that, so swapping calm for agitated fragments roughly triples
 * the churn. A third and not a tenth, because a fragment that goes out and comes back inside
 * a couple of frames reads as noise rather than as motion — and noise is the one thing Jarvis
 * should never look like.
 *
 * DELIBERATELY SLOWER THAN THE FILM, and slower than the two rounds before it. The film
 * measures 0.2-0.6 s and renews about a tenth of the body per film frame, which this drawing
 * matched at 0.34-0.72 s calm and 0.05-0.12 s while speaking. On a phone that read as a sizzle
 * — the user's word — in both states: a surface boiling rather than a machine thinking. What
 * is wanted here is "overwhelming calm and compute power", so the calm pool is about twice as
 * slow as the film's and the fast pool between three and four times slower than it was.
 *
 * Measured over five moments at 256 px: the speaking churn halves, from 3.22 per pixel per
 * frame to 1.65, which is where the sizzle was. Idle falls by a fifth, 0.77 to 0.62, and no
 * further however slow this pool gets — what is left there is the ball turning, not fragments
 * changing, and the turn is still at the film's rate. Speech continues to change the ball
 * nearly three times as fast as silence, which is what `hologram-drawing.spec.ts` requires and
 * what keeps him plainly alive while he talks.
 */
function pickFragmentRate(random: Random, pool: number) {
  const litSeconds = pool === 0 ? 0.6 + random() * 0.7 : 0.2 + random() * 0.18;
  return FRAGMENT_DUTY / litSeconds;
}

/**
 * A fragment's shape and how long it is, written into out[0] and out[1]. Rings and cell outlines
 * crowd round the core; further out most of them are plain dashes. However it hops, a fragment
 * stays inside the limb.
 */
function pickGlyphAndLength(random: Random, x: number, y: number, radius: number, out: number[]) {
  const picked = pickGlyph(random);
  const scatter = x * 37.1 + y * 11.3;
  const glyph = picked >= 5 && radius > 0.4 && scatter - Math.floor(scatter) < 0.75 ? 0 : picked;
  out[0] = glyph;
  out[1] = Math.max(
    0.012,
    Math.min(glyph === 6 ? 0.04 + random() * 0.07 : pickFragmentLength(random), (1.02 - radius) / 1.1),
  );
}

/**
 * The fragment body: the film's "circuit" texture of short bright strokes, nearly all of them
 * pinned in screen space (the film's body does not spin). Stride {@link BODY_STRIDE}: x, y,
 * unit direction x, y, length, rate (cycles per second), id (0..1), a code packing the
 * glyph and the fragment's class (see {@link FRAGMENT_CODE_GLYPH_STEP}), and the order it
 * arrives in while the ball forms (see {@link revealOrder}).
 *
 * Twice as many fragments as before, so that the light comes from the particles rather than
 * from the wash behind them. Twice the rows would have put the scene over the size a phone
 * should clone into the worklet runtime at every mount, so each row lost two numbers instead:
 * the glyph rides in the class code, and the blink phase is a hash of the id rather than a
 * random of its own — a hash of a uniform number is as uniform and as uncorrelated as a
 * second draw would have been, and the id is already the fragment's handle for everything
 * else that has to vary independently.
 *
 * Two pools share the same places. Pool 0 is the calm set; pool 1, half its size,
 * cycles twice as fast and only shows while he talks, standing in for calm fragments
 * whose ids it takes over — so the count lit, and the brightness, stay the same.
 *
 * A quarter of the fragments between 0.3R and 0.85R ride the counter-turning inner shell
 * instead of being pinned: the film's features in those bands drift back at 2-6°/s (section 3)
 * while the body as a whole stays put.
 */
function buildBody(random: Random) {
  const body: number[] = [];
  const shape = [0, 0];
  const fragmentCount = 1000;
  while (body.length < fragmentCount * BODY_STRIDE) {
    // the body stops just inside the rim layer, which rolls over it
    const radius = Math.sqrt(random()) * 0.94;
    const angle = random() * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    // the lower hemisphere's stream carries some of the mass there
    const streamShare = y > 0.12 ? 0.8 : 1;
    const crowding = clusterWeight(x, y);
    // the crowded clumps carry the bright glyphs, and the dim and mid ones keep out of the
    // troughs between the clumps altogether, where the film shows bare fill (shot d: a quarter
    // of its tiles have next to no strokes, a seventh twice the median)
    const brightness = crowding > 0.72 && random() < 0.4 ? 2 : pickBrightness(random);
    const crowded = brightness === 2 ? crowding : crowding * crowding * crowding;
    if (random() > massWeight(x, y) * streamShare * crowded) continue;
    const direction = pickFragmentAngle(random, x, y);
    pickGlyphAndLength(random, x, y, radius, shape);
    const pool = random() < 1 / 3 ? 1 : 0;
    // Drawn in the order the row used to draw them in, so the same seed still builds
    // the same ball: the rate first, then the id, then the inner-shell coin.
    const rate = pickFragmentRate(random, pool);
    const id = random();
    const onInnerShell = radius > 0.3 && radius < 0.62 && random() < 0.55 ? 6 : 0;
    // How far behind or in front of the middle it sits, so the body can turn about the
    // vertical axis. Anywhere through the ball at this distance from the axis, which keeps
    // the cloud as thick front to back as it is across.
    const depth = (random() * 2 - 1) * Math.sqrt(Math.max(0, 0.94 * 0.94 - x * x - y * y));
    body.push(
      x,
      y,
      Math.cos(direction),
      Math.sin(direction),
      shape[1],
      rate,
      id,
      brightness + 3 * pool + onInnerShell + FRAGMENT_CODE_GLYPH_STEP * shape[0],
      revealOrder(x, y, id),
      depth,
    );
  }
  return body;
}

/**
 * The lower hemisphere's stream: fragments on an equatorial shell below the core
 * that turns about the vertical axis, so its front drifts right at 0.1-0.2 R/s and
 * its dimmer back drifts left — the film's horizontal counter-streams.
 * Stride 10: x, y, z (rest pose), half-length along the latitude x, z, rate, phase,
 * id, brightness + 3 × pool, glyph (0 dash or 1 L).
 */
function buildStream(random: Random) {
  const stream: number[] = [];
  for (let i = 0; i < 168; i++) {
    const shell = 0.42 + random() * 0.5;
    const latitude = Math.asin(0.1 + random() * 0.72);
    const longitude = random() * Math.PI * 2;
    const half = pickFragmentLength(random) * 0.5;
    const pool = random() < 1 / 3 ? 1 : 0;
    const restX = shell * Math.cos(latitude) * Math.sin(longitude);
    const restY = shell * Math.sin(latitude);
    // Same as the body: the row's randoms are drawn in their old order.
    const rate = pickFragmentRate(random, pool);
    const phase = random();
    const id = random();
    const brightnessCode = pickBrightness(random) + 3 * pool;
    const glyph = random() < 0.2 ? 1 : 0;
    stream.push(
      restX,
      restY,
      shell * Math.cos(latitude) * Math.cos(longitude),
      Math.cos(longitude) * half,
      -Math.sin(longitude) * half,
      rate,
      phase,
      id,
      brightnessCode,
      glyph,
      revealOrder(restX, restY, id),
    );
  }
  return stream;
}

/**
 * The crescent's strands as rings of pieces in the rolling frame, so their breaks
 * roll clockwise through the crescent while its brightness stays on the left.
 * Stride 3 per piece, CRESCENT_PIECES_PER_STRAND pieces per strand, four strands:
 * start (degrees), sweep (degrees), a 0..1 hash.
 */
function buildCrescentPieces(random: Random) {
  const pieces: number[] = [];
  for (let strand = 0; strand < 4; strand++) {
    const weights: number[] = [];
    for (let i = 0; i < CRESCENT_PIECES_PER_STRAND; i++) weights.push(0.6 + random());
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let start = random() * 360;
    for (let i = 0; i < CRESCENT_PIECES_PER_STRAND; i++) {
      const span = (weights[i] / total) * 360;
      const gap = strand < 2 ? 2.2 + random() * 2.6 : 2.5 + random() * 6;
      pieces.push(start, span - gap, random());
      start += span;
    }
  }
  return pieces;
}

/**
 * The segmented ladder ring ("crown truss"): pieces of about 9° along three partial
 * arcs in the rolling frame, 190° of arc in all. Stride 6: start (degrees), sweep,
 * circuit trace (0 none, 1 L, 2 Z, 3 T), hanging strut length (0 = none), hash, arc.
 */
function buildTruss(random: Random) {
  const truss: number[] = [];
  const arcs = [
    [280, 380],
    [195, 245],
    [62, 102],
  ];
  arcs.forEach(([from, to], arc) => {
    let degrees = from;
    while (degrees < to - 4) {
      // pieces meet end to end, so a leading truss has continuous rails with rungs across
      const sweep = Math.min(to - degrees, 8 + random() * 3);
      const traceRoll = random();
      const trace = traceRoll < 0.45 ? 0 : 1 + Math.floor(random() * 3);
      const strut = random() < 0.22 ? 0.12 + random() * 0.13 : 0;
      truss.push(degrees, sweep, trace, strut, random(), arc);
      degrees += sweep;
    }
  });
  return truss;
}

/** Strands fraying off the upper-left limb while he talks. Stride 5: clock angle, sweep (degrees), rate, phase, threshold. */
function buildFray(random: Random) {
  const fray: number[] = [];
  for (let i = 0; i < 22; i++) {
    fray.push(
      i < 16 ? 280 + random() * 74 : 200 + random() * 45,
      3 + random() * 8,
      0.7 + random() * 0.6,
      random(),
      random() * 0.7,
    );
  }
  return fray;
}

/** Outer streak arcs at 1.2-1.27R, upper left, while he talks. Stride 6: clock centre, radius, sweep, rate, phase, threshold. */
function buildStreakArcs(random: Random) {
  const arcs: number[] = [];
  for (let i = 0; i < 7; i++) {
    arcs.push(
      286 + i * 11 + random() * 6,
      1.2 + random() * 0.07,
      12 + random() * 12,
      0.5 + random() * 0.4,
      random(),
      0.08 + (i / 6) * 0.5,
    );
  }
  return arcs;
}

/**
 * Horizontal streaks slipping out of the right limb while he talks, as the film's
 * sphere loosens on "Doctor.". Stride 5: height, length, rate, phase, threshold.
 */
function buildLimbStreaks(random: Random) {
  const streaks: number[] = [];
  for (let i = 0; i < 16; i++) {
    streaks.push(-0.42 + random() * 0.72, 0.08 + random() * 0.26, 0.75 + random() * 0.7, random(), random() * 0.75);
  }
  return streaks;
}

/** Ticks along the thin rim ring, in the rolling frame. Stride 2: angle (degrees), length. */
function buildRingTicks(random: Random) {
  const ticks: number[] = [];
  let degrees = random() * 10;
  while (degrees < 356) {
    ticks.push(degrees, 0.025 + random() * 0.045);
    degrees += 5 + random() * 12;
  }
  return ticks;
}

/**
 * The slow script: a loop of epochs 3-8 s long, each handing the rim to one dominant
 * element. Stride 6: start, duration, dominant (0 crescent, 1 truss, 2 thin ring),
 * line kind (0 none, 1 radial spokes, 2 swoosh fan, 3 lightning filament), fragment
 * density, red flash time (seconds into the epoch, or -1).
 *
 * It used to schedule a protrusion per epoch as well — a boom, ribbon, tendril or fan
 * standing off the limb. They were the film's, but on a phone they read as an arm
 * swinging out of the ball on a loop, and they are gone.
 */
function buildScript(random: Random) {
  const epochs: number[] = [];
  const dominants = [0, 1, 0, 2, 1, 0, 1, 2, 0, 1, 2, 1];
  const lineKinds = [0, 0, 1, 0, 2, 0, 3, 1, 0, 2, 3, 0];
  let start = 0;
  dominants.forEach((dominant, index) => {
    const duration = index === 0 ? 7 : 3 + random() * 5;
    epochs.push(
      start,
      duration,
      dominant,
      lineKinds[index],
      0.9 + random() * 0.12,
      index === 4 || index === 9 ? 0.5 + random() * (duration - 1) : -1,
    );
    start += duration;
  });
  return { epochs, period: start };
}

/** Comet arcs curling from the core to the lower right. Stride 5: period, phase, base angle (radians), radius, sweep. */
function buildComets(random: Random) {
  const comets: number[] = [];
  for (let i = 0; i < 5; i++) {
    comets.push(
      5 + random() * 4,
      random(),
      -0.1 + i * 0.3 + random() * 0.2,
      0.35 + random() * 0.4,
      1.2 + random() * 0.8,
    );
  }
  return comets;
}

/**
 * The materialisation's sparks. Stride 5: x, y, when it appears (keyframe time 0..1),
 * kind (0 the row across the future top, 1 the trail falling down the right, 2 scattered), hash.
 */
function buildIntroSparks(random: Random) {
  const sparks: number[] = [];
  for (let i = 0; i < 34; i++)
    sparks.push(-0.95 + random() * 1.78, -1.2 + random() * 0.2, 0.06 + random() * 0.11, 0, random());
  for (let i = 0; i < 18; i++) sparks.push(0.93 + random() * 0.05, 0, 0.1 + (i / 18) * 0.12, 1, random());
  for (let i = 0; i < 26; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 0.3 + random() * 1.05;
    sparks.push(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.9, 0.08 + random() * 0.3, 2, random());
  }
  return sparks;
}

/** Keeps the worklet copy of the scene small. */
function roundToFiveDecimals(value: number) {
  return Math.round(value * 1e5) / 1e5;
}

/** Builds the hologram's random geometry once. Deterministic for a given seed; plain data only. */
export function createHologramScene(seed: number) {
  const random = createRandom(seed);
  const script = buildScript(random);
  return {
    body: buildBody(random).map(roundToFiveDecimals),
    stream: buildStream(random).map(roundToFiveDecimals),
    crescentPieces: buildCrescentPieces(random).map(roundToFiveDecimals),
    truss: buildTruss(random).map(roundToFiveDecimals),
    fray: buildFray(random).map(roundToFiveDecimals),
    streakArcs: buildStreakArcs(random).map(roundToFiveDecimals),
    limbStreaks: buildLimbStreaks(random).map(roundToFiveDecimals),
    ringTicks: buildRingTicks(random).map(roundToFiveDecimals),
    epochs: script.epochs.map(roundToFiveDecimals),
    scriptPeriod: roundToFiveDecimals(script.period),
    comets: buildComets(random).map(roundToFiveDecimals),
    introSparks: buildIntroSparks(random).map(roundToFiveDecimals),
    // only a seed: the static textures are built straight into paths, never copied to the worklet runtime
    textureSeed: Math.floor(random() * 4294967296),
  };
}

type Scene = ReturnType<typeof createHologramScene>;

// ---- resources: Skia objects built once per mounted canvas --------------------------------

/**
 * A path under construction, kept in JavaScript until it is finished.
 *
 * **This is the frame rate on a phone.** Skia's own builder sends every `moveTo` and `lineTo`
 * across into native code as it is called, and a frame of this drawing is a few thousand of them.
 * Measured with the JIT switched off — which is what Hermes is on a phone — a thousand two-verb
 * dashes cost 4.41 ms built that way against 0.91 ms handed over as one array of commands, while
 * the arithmetic behind them costs 0.08 ms. Nearly the whole cost of building a frame is the
 * crossings, and this removes them: the verbs go into a plain array and the path is made in one
 * call when it is detached.
 *
 * Verb numbers are Skia's own, as `PathVerb` gives them, written out rather than imported because
 * this runs in a worklet and an imported enum is one more object to carry across.
 */
interface PathBuilder {
  /** The commands, and beyond `count` the ones last frame used — kept to be written over. */
  commands: number[][];
  count: number;
}

const MOVE_VERB = 0;
const LINE_VERB = 1;
const CONIC_VERB = 3;
const CLOSE_VERB = 5;

/** The conic weight that makes a quarter circle. */
const QUARTER_CIRCLE_WEIGHT = Math.SQRT1_2;

function makePathBuilder(): PathBuilder {
  return { commands: [], count: 0 };
}

/**
 * The next command's array, reused from last frame wherever it fits.
 *
 * A frame of the body is a couple of thousand commands, and a fresh `[verb, x, y]` for each is a
 * couple of thousand short-lived objects sixty — now thirty — times a second. On a phone that is
 * paid twice, once to allocate and again when the collector takes them back. The drawing puts very
 * nearly the same shapes in the same order every frame, so the arrays from the last one are
 * already the right size and are simply written over.
 */
function nextCommand(builder: PathBuilder, size: number): number[] {
  'worklet';
  const existing = builder.commands[builder.count];
  if (existing !== undefined && existing.length === size) {
    builder.count++;
    return existing;
  }
  const made = new Array<number>(size);
  builder.commands[builder.count] = made;
  builder.count++;
  return made;
}

function pathMoveTo(builder: PathBuilder, x: number, y: number) {
  'worklet';
  const command = nextCommand(builder, 3);
  command[0] = MOVE_VERB;
  command[1] = x;
  command[2] = y;
}

function pathLineTo(builder: PathBuilder, x: number, y: number) {
  'worklet';
  const command = nextCommand(builder, 3);
  command[0] = LINE_VERB;
  command[1] = x;
  command[2] = y;
}

function pathConicTo(builder: PathBuilder, x1: number, y1: number, x2: number, y2: number, weight: number) {
  'worklet';
  const command = nextCommand(builder, 6);
  command[0] = CONIC_VERB;
  command[1] = x1;
  command[2] = y1;
  command[3] = x2;
  command[4] = y2;
  command[5] = weight;
}

function pathClose(builder: PathBuilder) {
  'worklet';
  const command = nextCommand(builder, 1);
  command[0] = CLOSE_VERB;
}

/**
 * A circle, as the four conics Skia's own `addCircle` would have used.
 *
 * Clockwise from the rightmost point, which is where Skia starts one, so it is the same shape
 * wound the same way — it has to be, because the drawing strokes these.
 */
function pathAddCircle(builder: PathBuilder, x: number, y: number, radius: number) {
  'worklet';
  pathMoveTo(builder, x + radius, y);
  pathConicTo(builder, x + radius, y + radius, x, y + radius, QUARTER_CIRCLE_WEIGHT);
  pathConicTo(builder, x - radius, y + radius, x - radius, y, QUARTER_CIRCLE_WEIGHT);
  pathConicTo(builder, x - radius, y - radius, x, y - radius, QUARTER_CIRCLE_WEIGHT);
  pathConicTo(builder, x + radius, y - radius, x + radius, y, QUARTER_CIRCLE_WEIGHT);
  pathClose(builder);
}

function pathReset(builder: PathBuilder) {
  'worklet';
  builder.count = 0;
}

/** The finished path, in one crossing. `keep` is for the handful built once at mount. */
function pathOf(Skia: SkiaApiType, builder: PathBuilder, keep = false) {
  'worklet';
  // One array of references, where the commands themselves are last frame's; see nextCommand.
  const path = Skia.Path.MakeFromCmds(builder.commands.slice(0, builder.count));
  if (!keep) {
    builder.count = 0;
  }
  if (!path) {
    throw new Error('The hologram could not build one of its paths');
  }
  return path;
}

/** A circle arc (centre, radius, start angle, signed sweep) appended as conics of at most 0.8 rad. */
function appendArc(
  builder: PathBuilder,
  centreX: number,
  centreY: number,
  radius: number,
  startAngle: number,
  sweep: number,
) {
  'worklet';
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / 0.8));
  const step = sweep / pieces;
  const halfStep = step * 0.5;
  const weight = Math.cos(halfStep);
  pathMoveTo(builder, centreX + Math.cos(startAngle) * radius, centreY + Math.sin(startAngle) * radius);
  for (let piece = 0; piece < pieces; piece++) {
    const pieceStart = startAngle + step * piece;
    pathConicTo(
      builder,
      centreX + (Math.cos(pieceStart + halfStep) * radius) / weight,
      centreY + (Math.sin(pieceStart + halfStep) * radius) / weight,
      centreX + Math.cos(pieceStart + step) * radius,
      centreY + Math.sin(pieceStart + step) * radius,
      weight,
    );
  }
}

/** A rotated ellipse, or the first `share` of its turn from the end of its major axis, as a polyline (prebuilt only). */
function appendEllipse(
  builder: PathBuilder,
  centreX: number,
  centreY: number,
  radiusX: number,
  radiusY: number,
  tilt: number,
  steps: number,
  share = 1,
) {
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  for (let step = 0; step <= steps; step++) {
    const angle = (step / steps) * Math.PI * 2 * share - (share < 1 ? Math.PI / 2 : 0);
    const x = Math.cos(angle) * radiusX;
    const y = Math.sin(angle) * radiusY;
    const pointX = centreX + x * cosTilt - y * sinTilt;
    const pointY = centreY + x * sinTilt + y * cosTilt;
    if (step === 0) pathMoveTo(builder, pointX, pointY);
    else pathLineTo(builder, pointX, pointY);
  }
}

/**
 * Brightness along the body's strokes: a tiled field of soft random dips and hot spots
 * (0.5-1), so a stroke is hot in places and dimmer in others rather than one flat tone.
 * Premultiplied grey RGBA. Each texel comes from an integer hash of its index, which is far
 * cheaper than the scene's generator on an interpreter.
 */
function buildSparkleTexture(seed: number) {
  const texels = SPARKLE_TEXTURE_TEXELS;
  const pixels = new Uint8Array(texels * texels * 4);
  for (let texel = 0; texel < texels * texels; texel++) {
    let mixed = Math.imul(texel ^ seed, 0x9e3779b1);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x85ebca77);
    mixed ^= mixed >>> 13;
    const roll = ((mixed >>> 16) & 0xffff) / 65536;
    const second = (mixed & 0xffff) / 65536;
    // mostly mid, some dips, a few hot spots
    const value = roll < 0.25 ? 0.5 + roll : roll > 0.9 ? 1 : 0.72 + 0.2 * second;
    const level = Math.round(255 * value);
    pixels[texel * 4] = level;
    pixels[texel * 4 + 1] = level;
    pixels[texel * 4 + 2] = level;
    pixels[texel * 4 + 3] = 255;
  }
  return pixels;
}

/** One unbroken stretch of a whorl arm, `stretch` radians of its spiral from `along`. */
function appendWhorlStretch(
  inner: PathBuilder,
  outer: PathBuilder,
  ticks: PathBuilder,
  random: Random,
  first: number,
  firstAngle: number,
  along: number,
  stretch: number,
) {
  // Each turn is 2.7 times as wide as the one inside it, so an arm crosses the whole interior in
  // under two turns: the film's whorl is one loose sweep with open fill between its passes, not
  // a set of near-concentric rings.
  const growth = Math.log(2.7) / (Math.PI * 2);
  const steps = Math.ceil(stretch / 0.14);
  let previousArm = ticks;
  for (let step = 0; step <= steps; step++) {
    const turned = along + (stretch * step) / steps;
    const radius = first * Math.exp(growth * turned);
    if (radius > 0.76) return;
    const angle = firstAngle + turned;
    const x = CORE_X + Math.cos(angle) * radius;
    const y = CORE_Y + Math.sin(angle) * radius;
    // an arm is bold round the core and thinner as it opens out past 0.46R; the two halves are
    // drawn apart, so each is picked up where the other left it
    const arm = radius < 0.46 ? inner : outer;
    if (arm === previousArm) pathLineTo(arm, x, y);
    else pathMoveTo(arm, x, y);
    previousArm = arm;
    // the arms are furry with short fragments across them, as the film's are
    if (random() < 0.3) {
      const across = (0.014 + 0.035 * random()) * (random() < 0.5 ? -1 : 1);
      pathMoveTo(ticks, x, y);
      pathLineTo(ticks, x + Math.cos(angle) * across, y + Math.sin(angle) * across);
    }
  }
}

/** One arm of the whorl: a spiral of broken stretches from `first` out to 0.76R. */
function appendWhorlArm(
  inner: PathBuilder,
  outer: PathBuilder,
  ticks: PathBuilder,
  random: Random,
  first: number,
  firstAngle: number,
  turns: number,
) {
  let along = 0;
  while (along < turns) {
    const stretch = Math.min(turns - along, 1.1 + random() * 1.5);
    appendWhorlStretch(inner, outer, ticks, random, first, firstAngle, along, stretch);
    // the gaps widen as an arm opens out
    along += stretch + 0.12 + random() * 0.18 + 0.02 * along;
  }
}

/**
 * The whorl round the core (shot d f40-150, the ball's boldest inner feature): two nested spiral
 * arms winding out from just outside the core's ring, each turn about 2.7× as wide as the one
 * inside it, broken into long stretches with short gaps, reaching 0.76R in under two turns. Two wisps just inside
 * the rim layer (shot b) keep them company out there. They are drawn wider than any stroke in
 * the body and turn the other way from the rim (drawInnerShells), so the ball reads as one loose
 * swirl over a field of fragments — the film's interior is a few fat luminous ribbons, not a
 * star chart of hairlines of equal weight.
 */
function buildWhorl(Skia: SkiaApiType, random: Random) {
  const whorl = makePathBuilder();
  const outer = makePathBuilder();
  const ticks = makePathBuilder();
  appendWhorlArm(whorl, outer, ticks, random, 0.16, 3.5, 10.5);
  appendWhorlArm(whorl, outer, ticks, random, 0.33, 1.1, 6.5);
  appendArc(outer, CORE_X, CORE_Y, 0.7, 0.3, 0.8);
  appendArc(outer, CORE_X, CORE_Y, 0.66, 1.35, 0.55);
  return {
    whorlPath: pathOf(Skia, whorl, true),
    whorlOuterPath: pathOf(Skia, outer, true),
    whorlTickPath: pathOf(Skia, ticks, true),
  };
}

/**
 * The inner structure: the long bright loop rising 37° to the right past the core, the faint
 * near half of the tall edge-on ellipse beside it, and two data streaks through the core.
 */
function buildInnerStructure(Skia: SkiaApiType) {
  const loop = makePathBuilder();
  appendEllipse(loop, 0.04, 0.03, 0.74, 0.2, -37 * DEGREES_TO_RADIANS, 56);
  // the edge-on ellipse's near half only, faint
  const edgeOn = makePathBuilder();
  appendEllipse(edgeOn, 0.27, 0.02, 0.1, 0.44, 4 * DEGREES_TO_RADIANS, 20, 0.5);
  // the ")" arc wrapping the core's right side at 0.57R: -60° to +40°, measured up from 3 o'clock
  const bracket = makePathBuilder();
  appendArc(bracket, CORE_X, CORE_Y, 0.575, 60 * DEGREES_TO_RADIANS, -100 * DEGREES_TO_RADIANS);
  const streaks = makePathBuilder();
  const streakRows = [
    [-0.72, 0.6, 0.05],
    [-0.5, 0.2, -0.065],
  ];
  for (const [from, to, y] of streakRows) {
    pathMoveTo(streaks, CORE_X + from, CORE_Y + y);
    pathLineTo(streaks, CORE_X + to, CORE_Y + y);
  }
  return {
    loopPath: pathOf(Skia, loop, true),
    edgeOnPath: pathOf(Skia, edgeOn, true),
    bracketPath: pathOf(Skia, bracket, true),
    dataStreakPath: pathOf(Skia, streaks, true),
  };
}

/** The core glyph: a hooked ring of radius 0.1R with a stem curling in, and the bar. The whorl's first turn is the film's second ring at 0.3R. */
function buildCoreGlyph(Skia: SkiaApiType) {
  const ring = makePathBuilder();
  appendArc(ring, 0, 0, 0.1, -35 * DEGREES_TO_RADIANS, 305 * DEGREES_TO_RADIANS);
  // the hook: from the ring's open end a short stem curls in toward the middle
  const endAngle = 270 * DEGREES_TO_RADIANS;
  pathMoveTo(ring, Math.cos(endAngle) * 0.1, Math.sin(endAngle) * 0.1);
  pathLineTo(ring, 0.012, -0.055);
  pathLineTo(ring, 0.03, -0.02);
  const bar = makePathBuilder();
  pathMoveTo(bar, -0.3, 0.012);
  pathLineTo(bar, 0.3, 0.012);
  return { coreRingPath: pathOf(Skia, ring, true), coreBarPath: pathOf(Skia, bar, true) };
}

/**
 * The fan of strands on the right: four concentric strands from 1 to 5 o'clock whose
 * clockwise ends peel out to 1.08R (shot d).
 */
function buildStrandFan(Skia: SkiaApiType) {
  const fan = makePathBuilder();
  const radii = [0.9, 0.95, 1.0, 1.03];
  radii.forEach((radius, strand) => {
    const from = 30 + strand * 6;
    const to = 150 - strand * 4;
    for (let degrees = from; degrees <= to; degrees += 5) {
      const peel = Math.max(0, (degrees - (to - 30)) / 30);
      const pointRadius = radius + peel * peel * (1.08 - radius);
      const angle = (degrees - 90) * DEGREES_TO_RADIANS;
      if (degrees === from) pathMoveTo(fan, Math.cos(angle) * pointRadius, Math.sin(angle) * pointRadius);
      else pathLineTo(fan, Math.cos(angle) * pointRadius, Math.sin(angle) * pointRadius);
    }
  });
  return pathOf(Skia, fan, true);
}

/** A colour from 0-255 channels, as the hex string Skia.Color takes. */
function amberHex(red: number, green: number, blue: number) {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** Paints, gradient shaders, prebuilt paths and the reusable path builders. */
/** The backdrop's alpha at `distance` from its middle, 0 at the middle to 1 at its reach. */
function backdropAlpha(distance: number) {
  for (let stop = 2; stop < BACKDROP_RAMP.length; stop += 2) {
    const to = BACKDROP_RAMP[stop] ?? 1;
    if (distance > to) continue;
    const from = BACKDROP_RAMP[stop - 2] ?? 0;
    const share = to === from ? 0 : (distance - from) / (to - from);
    return (BACKDROP_RAMP[stop - 1] ?? 0) + ((BACKDROP_RAMP[stop + 1] ?? 0) - (BACKDROP_RAMP[stop - 1] ?? 0)) * share;
  }
  return 0;
}

/** Black everywhere, and only the alpha varies: see BACKDROP_TEXELS. */
function buildBackdropTexture() {
  const texels = BACKDROP_TEXELS;
  const half = texels / 2;
  const bytes = new Uint8Array(texels * texels * 4);
  for (let row = 0; row < texels; row++) {
    for (let column = 0; column < texels; column++) {
      const x = (column + 0.5 - half) / half;
      const y = (row + 0.5 - half) / half;
      const distance = Math.sqrt(x * x + y * y);
      bytes[(row * texels + column) * 4 + 3] = Math.round(backdropAlpha(distance));
    }
  }
  return bytes;
}

export function createHologramResources(Skia: SkiaApiType, scene: Scene) {
  const makePaint = (color: string, style: PaintStyle, strokeCap: StrokeCap) => {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(style);
    paint.setColor(Skia.Color(color));
    paint.setBlendMode(BlendMode.Screen);
    paint.setStrokeCap(strokeCap);
    return paint;
  };
  const makeStroke = (color: string, strokeCap: StrokeCap) => makePaint(color, PaintStyle.Stroke, strokeCap);
  const makeFill = (color: string) => makePaint(color, PaintStyle.Fill, StrokeCap.Butt);
  const colors = (list: string[]) => list.map((color) => Skia.Color(color));
  const radialGradient = (radius: number, list: string[], positions: number[]) =>
    Skia.Shader.MakeRadialGradient({ x: 0, y: 0 }, radius, colors(list), positions, TileMode.Clamp);

  // The limb bloom: a tight ring profile around 1R, multiplied by a mask peaked at
  // 8-9 o'clock (a sweep gradient starts at 3 o'clock and runs clockwise). No halo.
  // Painted as a band rather than a disc — see LIMB_BLOOM_BAND.
  const limbBloomFill = makeStroke('#ffffff', StrokeCap.Butt);
  limbBloomFill.setStrokeWidth(LIMB_BLOOM_BAND);
  limbBloomFill.setShader(
    Skia.Shader.MakeBlend(
      BlendMode.Modulate,
      radialGradient(
        1.12,
        ['#ffffff00', '#ffffff00', '#ffffff70', '#ffffffff', '#ffffff80', '#ffffff00'],
        [0, 0.79, 0.855, 0.895, 0.935, 0.985],
      ),
      Skia.Shader.MakeSweepGradient(
        0,
        0,
        colors(['#e8801c00', '#e8801c00', '#ec8a2280', '#f0962aff', '#ec8a2280', '#e8801c00', '#e8801c00']),
        [0, 0.27, 0.37, 0.47, 0.6, 0.7, 1],
        TileMode.Clamp,
      ),
    ),
  );

  // The limb ridge under the thin ring: a ring profile peaked at 0.965R, lumpy round the circle
  // (bright stretches and see-through ones, from the seed) and drawn in the rolling frame, so it
  // rolls with the rest of the rim layer rather than sitting under it as an evenly lit coin edge.
  const ridgeRandom = createRandom(scene.textureSeed ^ 0x68e31da4);
  const ridgeColours: string[] = [];
  const ridgeStops: number[] = [];
  for (let stop = 0; stop < 30; stop++) {
    const lit = stop === 29 ? ridgeColours[0] : undefined;
    const strength = 0.18 + 0.82 * ridgeRandom() ** 0.8;
    ridgeColours.push(lit ?? amberHex(0xd0 * strength, 0x7c * strength, 0x30 * strength));
    ridgeStops.push(stop / 29);
  }
  const limbRidgeFill = makeStroke('#ffffff', StrokeCap.Butt);
  limbRidgeFill.setStrokeWidth(LIMB_RIDGE_BAND);
  limbRidgeFill.setShader(
    Skia.Shader.MakeBlend(
      BlendMode.Modulate,
      radialGradient(
        1.06,
        ['#ffffff00', '#ffffff00', '#ffffff80', '#ffffffff', '#ffffff70', '#ffffff00'],
        [0, 0.84, 0.885, 0.915, 0.94, 0.965],
      ),
      Skia.Shader.MakeSweepGradient(0, 0, colors(ridgeColours), ridgeStops, TileMode.Clamp),
    ),
  );
  // The thin rim ring, brightest from 1 to 4 o'clock.
  const thinRingStroke = makeStroke('#ffffff', StrokeCap.Butt);
  thinRingStroke.setShader(
    Skia.Shader.MakeSweepGradient(
      0,
      0,
      colors(['#e69c50', '#e69c50', '#9c5e2e', '#9c5e2e', '#e69c50', '#e69c50']),
      [0, 0.09, 0.22, 0.7, 0.82, 1],
      TileMode.Clamp,
    ),
  );

  // The core: a bloom elongated along the lower-left to upper-right diagonal, with a
  // darker orange interior inside the hot ring, never white.
  // The shadow Jarvis sits on; see BACKDROP_RAMP. Alpha only — it darkens what is behind
  // without tinting it, so a blue wallpaper stays blue underneath.
  //
  // The one paint in the drawing that is not screened. Everything else here is light being added
  // to light, which is why the sphere glows; black screened over anything is a no-op, so the first
  // version of this drew precisely nothing. This one is laid over what is behind in the ordinary
  // way, and every screened layer then goes on top of it.
  const backdropFill = makeFill('#ffffff');
  backdropFill.setBlendMode(BlendMode.SrcOver);
  const backdropImage = Skia.Image.MakeImage(
    { width: BACKDROP_TEXELS, height: BACKDROP_TEXELS, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(buildBackdropTexture()),
    BACKDROP_TEXELS * 4,
  );
  if (!backdropImage) throw new Error('The hologram could not make its backdrop');
  backdropFill.setShader(
    backdropImage.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
  );

  const coreBloomFill = makeFill('#ffffff');
  coreBloomFill.setShader(
    radialGradient(
      1,
      ['#d06a2ec0', '#e88030e8', '#f68e30e8', '#e6802eb0', '#dc742a50', '#c8602600'],
      [0, 0.22, 0.34, 0.5, 0.74, 1],
    ),
  );
  const introPointFill = makeFill('#ffffff');
  introPointFill.setShader(radialGradient(1, ['#ffd872', '#f8b04ac0', '#e8902a40', '#e8902a00'], [0, 0.25, 0.6, 1]));

  // The body's strokes vary in brightness along their length (see buildSparkleTexture).
  const sparkleImage = Skia.Image.MakeImage(
    {
      width: SPARKLE_TEXTURE_TEXELS,
      height: SPARKLE_TEXTURE_TEXELS,
      alphaType: AlphaType.Premul,
      colorType: ColorType.RGBA_8888,
    },
    Skia.Data.fromBytes(buildSparkleTexture(scene.textureSeed ^ 0x2545f491)),
    SPARKLE_TEXTURE_TEXELS * 4,
  );
  if (!sparkleImage) throw new Error('The hologram could not make its sparkle texture');
  const sparkleShader = sparkleImage.makeShaderOptions(
    TileMode.Repeat,
    TileMode.Repeat,
    FilterMode.Linear,
    MipmapMode.None,
    Skia.Matrix().scale(SPARKLE_TEXEL_SIZE, SPARKLE_TEXEL_SIZE),
  );
  const makeSparkleStroke = (color: string, strokeCap: StrokeCap) => {
    const paint = makeStroke(color, strokeCap);
    paint.setShader(Skia.Shader.MakeBlend(BlendMode.Modulate, sparkleShader, Skia.Shader.MakeColor(Skia.Color(color))));
    return paint;
  };

  // The particle halos, on their own paints because they are the one thing here drawn without
  // antialiasing — see HALO_ANTIALIASED. The outer ring is round-capped, which is what makes a
  // halo round; the inner one is butt-capped, which is what makes it affordable — see
  // {@link drawParticleHalo}.
  const particleHalo = makeStroke('#dc5c20', StrokeCap.Round);
  particleHalo.setAntiAlias(HALO_ANTIALIASED);
  const particleHaloInner = makeStroke('#dc5c20', StrokeCap.Butt);
  particleHaloInner.setAntiAlias(HALO_ANTIALIASED);

  const makeBuilder = () => makePathBuilder();
  /** Stands in until the first frame builds the real thing; drawing it is a no-op. */
  const emptyPath = pathOf(Skia, makeBuilder());
  const pathBuilders = {
    // dim, mid and bright, pinned and then the same three for the turning shell
    body: [makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder()],
    lines: makeBuilder(),
    swoosh: makeBuilder(),
    coreKnot: makeBuilder(),
    truss: makeBuilder(),
    trussInner: makeBuilder(),
    trussHaze: makeBuilder(),
    trussRungs: makeBuilder(),
    trussDetail: makeBuilder(),
    ringTicks: makeBuilder(),
    crescent: [makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder()], // thin, medium, wide, core
    fray: makeBuilder(),
    chips: makeBuilder(),
    chipCores: makeBuilder(),
    lightning: makeBuilder(),
    red: makeBuilder(),
    introSparks: makeBuilder(),
    introBand: makeBuilder(),
    introInner: makeBuilder(),
    introSpokes: makeBuilder(),
  };
  // one flat list, so the frame can reset them all first
  const allPathBuilders = [
    ...pathBuilders.body,
    pathBuilders.lines,
    pathBuilders.swoosh,
    pathBuilders.coreKnot,
    pathBuilders.truss,
    pathBuilders.trussInner,
    pathBuilders.trussHaze,
    pathBuilders.trussRungs,
    pathBuilders.trussDetail,
    pathBuilders.ringTicks,
    ...pathBuilders.crescent,
    pathBuilders.fray,
    pathBuilders.chips,
    pathBuilders.chipCores,
    pathBuilders.lightning,
    pathBuilders.red,
    pathBuilders.introSparks,
    pathBuilders.introBand,
    pathBuilders.introInner,
    pathBuilders.introSpokes,
  ];

  return {
    limbBloomFill,
    limbRidgeFill,
    thinRingStroke,
    backdropFill,
    coreBloomFill,
    introPointFill,
    whorlGlowStroke: makeStroke('#d8651e', StrokeCap.Round),
    whorlStroke: makeSparkleStroke('#f47126', StrokeCap.Round),
    whorlCoreStroke: makeSparkleStroke('#ff8c38', StrokeCap.Round),
    bracketStroke: makeStroke('#e68727', StrokeCap.Round),
    loopStroke: makeStroke('#e6862f', StrokeCap.Butt),
    bodyDimStroke: makeStroke('#cc6e2c', StrokeCap.Butt),
    bodyMidStroke: makeSparkleStroke('#f87026', StrokeCap.Butt),
    bodyBrightStroke: makeSparkleStroke('#ff7e28', StrokeCap.Butt),
    bodyHotStroke: makeSparkleStroke('#ff8e3c', StrokeCap.Round),
    bodyGlowStroke: makeStroke('#dc6820', StrokeCap.Round),
    particleHaloStroke: particleHalo,
    particleHaloInnerStroke: particleHaloInner,
    lineStroke: makeStroke('#ec9440', StrokeCap.Butt),
    coreRingStroke: makeStroke('#ffa440', StrokeCap.Round),
    coreGlowStroke: makeStroke('#ec8c2c', StrokeCap.Round),
    trussStroke: makeStroke('#f49838', StrokeCap.Butt),
    trussGlowStroke: makeStroke('#c9812c', StrokeCap.Butt),
    trussHazeStroke: makeStroke('#99561a', StrokeCap.Butt),
    trussCoreStroke: makeStroke('#ffae46', StrokeCap.Butt),
    crescentGlowStroke: makeStroke('#e07a1a', StrokeCap.Butt),
    crescentThinStroke: makeStroke('#dca131', StrokeCap.Butt),
    crescentMediumStroke: makeStroke('#f09430', StrokeCap.Butt),
    crescentWideStroke: makeStroke('#fba838', StrokeCap.Butt),
    crescentCoreStroke: makeStroke('#ffc244', StrokeCap.Butt),
    /** Carries nothing but an alpha: the layer the sphere fades in through while it arrives. */
    arrivalFade: Skia.Paint(),
    /**
     * The ladder ring's five paths, and the weight they were built for. A weight of -1 is a
     * weight no frame asks for, so the first frame always builds.
     */
    trussCache: {
      weight: -1,
      shown: 0,
      outer: emptyPath,
      inner: emptyPath,
      haze: emptyPath,
      rungs: emptyPath,
      detail: emptyPath,
    },
    frayStroke: makeStroke('#f0943a', StrokeCap.Butt),
    chipGlowStroke: makeStroke('#f08a28', StrokeCap.Round),
    chipFill: makeFill('#f59430'),
    chipCoreFill: makeFill('#ffa840'),
    rodGlowStroke: makeStroke('#dc8424', StrokeCap.Butt),
    trussFaceFill: makeFill('#b4661c'),
    rodCoreStroke: makeStroke('#ffb04a', StrokeCap.Butt),
    railStroke: makeStroke('#f09c3c', StrokeCap.Butt),
    sparkStroke: makeStroke('#ffae4e', StrokeCap.Round),
    lightningStroke: makeStroke('#c39568', StrokeCap.Butt),
    redStroke: makeStroke('#b3470f', StrokeCap.Butt),
    introSparkStroke: makeStroke('#ffb848', StrokeCap.Round),
    introGlowStroke: makeStroke('#e0801a', StrokeCap.Butt),
    introBandStroke: makeStroke('#eca23c', StrokeCap.Butt),
    introBandCoreStroke: makeStroke('#ffe961', StrokeCap.Butt),
    introSpokeStroke: makeStroke('#e8a23c', StrokeCap.Butt),
    ...buildWhorl(Skia, createRandom(scene.textureSeed ^ 0x5bd1e995)),
    strandFanPath: buildStrandFan(Skia),
    ...buildInnerStructure(Skia),
    ...buildCoreGlyph(Skia),
    // Carried so that a draw function can hand a finished path over; see pathOf.
    skia: Skia,
    pathBuilders,
    allPathBuilders,
  };
}

type Resources = ReturnType<typeof createHologramResources>;

// ---- math helpers (worklets) --------------------------------------------------------------
// Every worklet is declared after the worklets it calls: the worklets plugin captures what a
// worklet calls at the moment the worklet is defined, so a helper declared further down would
// be captured as undefined on the UI thread (bun runs this file untransformed and would not notice).

function clamp01(value: number) {
  'worklet';
  // Written so that a NaN lands on 0 rather than travelling on into the geometry:
  // neither comparison is true of one, and every caller wants silence from it.
  return value > 0 ? (value > 1 ? 1 : value) : 0;
}

/** Hermite smoothstep of a value clamped to 0..1. */
function smooth01(value: number) {
  'worklet';
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return clamped * clamped * (3 - 2 * clamped);
}

/** Fractional part, for positive and negative values alike. */
function fraction(value: number) {
  'worklet';
  return value - Math.floor(value);
}

/** A repeatable 0..1 hash of an integer. */
function hashInteger(value: number) {
  'worklet';
  let mixed = Math.imul(value | 0, 0x9e3779b1);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x85ebca77);
  mixed ^= mixed >>> 13;
  return (mixed >>> 0) / 4294967296;
}

/**
 * The order the ball fills in while it materialises, 0 (first) to 1 (last). In the film the
 * fragments arrive behind the dial's band on the left and spread across to the right, in patches
 * rather than evenly, and the glow comes with them.
 */
function revealKey(x: number, y: number) {
  'worklet';
  const across = clamp01((x + 1.15) / 2.2);
  const patches = 0.5 + 0.5 * Math.sin(4.1 * x + 1.3) * Math.sin(3.3 * y - 0.7);
  return clamp01(0.72 * across + 0.28 * patches);
}

/**
 * The order a fragment joins the ball in, 0..1: low arrives first.
 *
 * Worked out once, when the scene is built, because it never changes — it is the
 * film's reveal pattern at the fragment's place, dithered by its id. It used to be
 * worked out inside the frame, which meant two `Math.sin` per fragment per frame,
 * about 3,400 native trig calls a frame on the phone for numbers that were the same
 * every time. That is the one thing in the loop the scene can remember for it.
 */
function revealOrder(x: number, y: number, id: number) {
  return 0.55 * revealKey(x, y) + 0.45 * fraction(id * 7.31);
}

/** A clock angle (degrees clockwise from 12 o'clock) as canvas radians (from 3 o'clock, y down). */
function clockRadians(clockDegrees: number) {
  'worklet';
  return (clockDegrees - 90) * DEGREES_TO_RADIANS;
}

/** Mean of bands[firstBand..endBand), 0 when there are none. */
function bandAverage(bands: number[], firstBand: number, endBand: number) {
  'worklet';
  let sum = 0;
  let count = 0;
  for (let i = firstBand; i < endBand && i < bands.length; i++) {
    sum += bands[i];
    count++;
  }
  return count ? sum / count : 0;
}

// ---- the script: which rim element dominates -------------------------------------------

/** Offset of the epoch playing at `localTime` seconds into the script's loop. */
function findEpoch(epochs: number[], localTime: number) {
  'worklet';
  for (let offset = epochs.length - EPOCH_STRIDE; offset > 0; offset -= EPOCH_STRIDE) {
    if (localTime >= epochs[offset]) return offset;
  }
  return 0;
}

/** How strongly a rim element shows when it is (1) or is not (0) the dominant one: the others never quite vanish. */
function rimTarget(element: number, dominant: number) {
  'worklet';
  if (element === dominant) return 1;
  return element === 0 ? 0.3 : element === 1 ? 0.42 : 0.2;
}

/**
 * Reads the script at `time`: rim weights (crescent, truss, ring), fragment density, the
 * epoch's line kind and its envelope, and the red flash.
 * Everything is a function of time alone, so it never jumps.
 */
function readScript(scene: Scene, time: number) {
  'worklet';
  const epochs = scene.epochs;
  const period = scene.scriptPeriod;
  const repeat = Math.floor(time / period);
  const localTime = time - repeat * period;
  const offset = findEpoch(epochs, localTime);
  const previous = offset === 0 ? epochs.length - EPOCH_STRIDE : offset - EPOCH_STRIDE;
  const start = epochs[offset];
  const duration = epochs[offset + 1];
  const intoEpoch = localTime - start;
  // the very first epoch has nothing before it to hand over from
  const handover = offset === 0 && repeat === 0 ? 1 : smooth01(intoEpoch / HANDOVER_SECONDS);
  const dominant = epochs[offset + 2];
  const previousDominant = epochs[previous + 2];
  const weights = [0, 0, 0];
  for (let element = 0; element < 3; element++) {
    const from = rimTarget(element, previousDominant);
    weights[element] = from + (rimTarget(element, dominant) - from) * handover;
  }
  const redAt = epochs[offset + 5];
  const density = epochs[previous + 4] + (epochs[offset + 4] - epochs[previous + 4]) * handover;
  return {
    crescentWeight: weights[0],
    trussWeight: weights[1],
    ringWeight: weights[2],
    density,
    lineKind: epochs[offset + 3],
    lineEnvelope: smooth01(intoEpoch / 1.0) * smooth01((duration - intoEpoch) / 1.0),
    lineSeconds: intoEpoch,
    lineSeed: repeat * 31 + offset,
    redVisible: redAt >= 0 && intoEpoch >= redAt && intoEpoch < redAt + 2 / 24,
  };
}

/** Everything a frame derives from its fields; see the file header for the mapping. */
function analyseFrame(frame: HologramFrame, size: number, scene: Scene) {
  'worklet';
  const time = frame.time;
  // keyframe time of the materialisation: 1 = formed, beyond it the crescent grows back in
  const intro = clamp01(frame.appearance) / FORMED_APPEARANCE;
  const activityGate = smooth01((intro - 0.8) / 0.2);
  const agitation = clamp01(frame.agitation) * activityGate;
  const bands = frame.bands;
  const lowDrive = clamp01((bandAverage(bands, 0, 6) - 0.35) / 0.45);
  const highDrive = clamp01((bandAverage(bands, 14, 24) - 0.2) / 0.45);
  const burstAge = frame.burstAge >= 0 ? frame.burstAge : 10;
  const script = readScript(scene, time);
  const yaw = time * STREAM_RADIANS_PER_SECOND;
  const bodyYaw = bodyTurnRadians(time);
  // Loudness, not the agitation envelope: the glow follows his voice moment to moment, as the
  // first hologram's did, while the chips and the churn follow the envelope.
  const voice = clamp01(frame.level) ** 0.8;
  // Folded together on purpose: coming and going are the same gesture, and every layer that
  // already fades and grows with the arrival therefore fades and shrinks on the way out.
  const arrival = smooth01(intro) * clamp01(frame.presence);
  // How much bigger he is this frame than at rest. Mostly loudness, so the sphere breathes with
  // the sentence rather than stepping up and sitting there; the envelope keeps it from dropping
  // back to nothing between syllables.
  const swell = SWELL_WITH_VOICE * (0.7 * voice + 0.3 * agitation);
  // The sphere grows into place and, with `arrival` fading the whole of it, fades in.
  //
  // It used to assemble instead: the fill spreading patch by patch, the fragments arriving in the
  // film's reveal order behind the dial's band, the limb ragged until late, each layer on its own
  // ramp. The user asked for the ceremony to go, so every layer now comes up together and the
  // growth does the work the staggering used to.
  const radius = size * SPHERE_FRACTION * (ARRIVAL_SMALLEST + (1 - ARRIVAL_SMALLEST) * arrival) * (1 + swell);
  const intoScan = time - Math.floor(time / SCAN_SECONDS) * SCAN_SECONDS;
  const thinking = clamp01(frame.thinking);
  return {
    time,
    radius,
    // Half the square, in sphere radii: how far the backdrop reaches, so its circle is the one
    // the square inscribes. See BACKDROP_RAMP — it has to end at zero exactly there.
    // Measured in the sphere's own radii, and capped by the square so it can never be clipped.
    //
    // It used to be half the square outright, which was right when the square was barely bigger
    // than the sphere. The square is now half again wider than the screen — the room the chips
    // need, see SPHERE_FRACTION — so half of it is far out into space nobody can see, and the
    // shadow's cost is its area: it is the most expensive single thing drawn, 15 ms of a 49 ms
    // frame at 384 px, measured by taking it out.
    // Divided by the swell, which is what keeps the shadow still.
    //
    // Everything here is drawn in sphere radii, and the sphere grows with the voice — so a reach
    // of a fixed number of radii is a shadow that breathes in and out with him. The user asked for
    // it to hold: "the radial dark gradient below should not pulsate with the speech". Dividing it
    // by the same factor the radius was multiplied by leaves reach × radius constant, so the
    // shadow keeps the size it has at rest however loud he gets.
    //
    // Only the swell is divided out. The arrival is not, so he still brings his shadow with him
    // when he materialises and takes it with him when he goes.
    backdropReach: Math.min(size / 2 / radius, BACKDROP_REACH / (1 + swell)),
    thinking,
    // Where the plane is, sweeping upward — y runs down the screen, so it starts positive. From
    // the clock alone, like everything else here, so it needs nothing remembered between frames.
    scan: 1.15 - (2.3 * intoScan) / SCAN_SECONDS,
    // And how far the ring has bloomed, in the last stretch of each pass.
    pulse: intoScan > SCAN_SECONDS - PULSE_SECONDS ? (intoScan - (SCAN_SECONDS - PULSE_SECONDS)) / PULSE_SECONDS : 0,
    intro,
    arrival,
    bodyShare: script.density,
    introHeat: 0,
    ragged: 0,
    // Everything but the core recedes while he thinks, so that the plane sweeping through him is
    // what the eye is left with. Without this the whorl, the rim and the ladder go on doing what
    // they always do and the sweep is one more thing happening among several — which is how the
    // first version of thinking looked, and why it did not read as a different state at all.
    innerAlpha: 1 - 0.8 * thinking,
    coreAlpha: 1,
    rimAlpha: 1 - 0.65 * thinking,
    crescentGrowth: smooth01((intro - 1) / 0.3333),
    agitation,
    // Half the calm fragments hand over to fast ones at full agitation, so the turnover rises
    // by about half (the film's churn on "Doctor." rises from 8 to 13 per frame). Half and no
    // more, because pool 1 lights the ids below 2·mix: at this share, and only at this share,
    // the fragments pool 1 lights make up for the ones pool 0 puts out at every agitation.
    // Past it pool 1 runs out of ids to light and the body thins while he talks — which dims
    // the ball, and, with fewer strokes going out and coming back, makes it churn less rather
    // than more, which is the opposite of what speech is supposed to look like.
    mix: 0.5 * agitation,
    // A third of the bright fragments step down while he talks, and the hot cores that make the
    // film's luma-200 highlights go almost entirely (section 4.2: they drop by about 70%). The
    // strokes themselves stay bright: it is the hot pixels that leave, not the texture.
    hotShare: 1 - 0.35 * agitation,
    spread: agitation * (0.7 + 0.3 * lowDrive),
    frayDrive: agitation * (0.55 + 0.45 * highDrive),
    burstAge,
    burstStrength: clamp01(frame.burstStrength) * activityGate,
    // how far the burst throws, and how many chips: the strength as the tracker gave it, so a
    // burst in flight while the ball is still forming cannot gain a chip half way
    burstReach: clamp01(frame.burstStrength),
    burstCount: Math.floor(frame.burstCount),
    // wrapped to one turn: the canvas takes float32 angles, which would lose the per-frame
    // step of a sphere left mounted for hours
    /** Somewhere for placeFragment to put its four numbers: made once a frame, not once a fragment. */
    scratch: [0, 0, 0, 0],
    bodyCos: Math.cos(bodyYaw),
    bodySin: Math.sin(bodyYaw),
    /** What the halos and the volume multiply their alpha by: 1 in silence, up to 1 + GLOW_WITH_VOICE. */
    glowGain: 1 + GLOW_WITH_VOICE * (GLOW_FROM_ENVELOPE * agitation + (1 - GLOW_FROM_ENVELOPE) * voice),
    roll: fraction((time * ROLL_DEGREES_PER_SECOND) / 360) * 360,
    shellTurn: fraction((time * SHELL_DEGREES_PER_SECOND) / 360) * 360,
    streamCos: Math.cos(yaw),
    streamSin: Math.sin(yaw),
    // the core's brightness drifts a few percent over many seconds; it never beats
    coreDrift: 1 + 0.03 * Math.sin(time * 0.53 + 1.1),
    script,
  };
}

type FrameState = ReturnType<typeof analyseFrame>;

// ---- the volume ---------------------------------------------------------------------------

/**
 * The inner layer, all of it turning the other way from the rim at a few degrees a second
 * (section 3): the whorl winding out of the core, the bold loop rising past it, the ")" arc and
 * the faint near half of the edge-on ellipse. The data streaks lie on the pinned body.
 */
function drawInnerShells(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const alpha = state.innerAlpha;
  if (alpha <= 0) return;
  canvas.save();
  canvas.rotate(state.shellTurn, CORE_X, CORE_Y);
  // the arms are boldest round the core and thin out as they open past 0.46R
  resources.whorlGlowStroke.setStrokeWidth(0.115);
  resources.whorlGlowStroke.setAlphaf(0.26 * alpha);
  canvas.drawPath(resources.whorlPath, resources.whorlGlowStroke);
  resources.whorlGlowStroke.setStrokeWidth(0.082);
  resources.whorlGlowStroke.setAlphaf(0.17 * alpha);
  canvas.drawPath(resources.whorlOuterPath, resources.whorlGlowStroke);
  resources.whorlStroke.setStrokeWidth(0.04);
  resources.whorlStroke.setAlphaf(0.95 * alpha);
  canvas.drawPath(resources.whorlPath, resources.whorlStroke);
  resources.whorlStroke.setStrokeWidth(0.028);
  resources.whorlStroke.setAlphaf(0.7 * alpha);
  canvas.drawPath(resources.whorlOuterPath, resources.whorlStroke);
  resources.whorlCoreStroke.setStrokeWidth(0.013);
  resources.whorlCoreStroke.setAlphaf(0.6 * alpha * (1 - 0.5 * state.agitation));
  canvas.drawPath(resources.whorlPath, resources.whorlCoreStroke);
  resources.whorlStroke.setStrokeWidth(0.01);
  resources.whorlStroke.setAlphaf(0.6 * alpha);
  canvas.drawPath(resources.whorlTickPath, resources.whorlStroke);
  resources.bodyGlowStroke.setStrokeWidth(0.056);
  resources.bodyGlowStroke.setAlphaf(0.14 * alpha);
  canvas.drawPath(resources.loopPath, resources.bodyGlowStroke);
  resources.loopStroke.setStrokeWidth(0.023);
  resources.loopStroke.setAlphaf(0.75 * alpha);
  canvas.drawPath(resources.loopPath, resources.loopStroke);
  resources.loopStroke.setStrokeWidth(0.012);
  resources.loopStroke.setAlphaf(0.3 * alpha);
  canvas.drawPath(resources.edgeOnPath, resources.loopStroke);
  resources.bracketStroke.setStrokeWidth(0.03);
  resources.bracketStroke.setAlphaf(0.6 * alpha);
  canvas.drawPath(resources.bracketPath, resources.bracketStroke);
  canvas.restore();
  resources.loopStroke.setStrokeWidth(0.007);
  resources.loopStroke.setAlphaf(0.32 * alpha * state.coreAlpha);
  canvas.drawPath(resources.dataStreakPath, resources.loopStroke);
}

/**
 * Appends one fragment's shape around (x, y) along the unit direction (unitX, unitY):
 * 0 dash, 1 L, 2 bracket, 3 T, 4 Z, 5 tiny ring, 6 cell outline.
 */
function appendGlyph(
  builder: PathBuilder,
  glyph: number,
  x: number,
  y: number,
  unitX: number,
  unitY: number,
  half: number,
) {
  'worklet';
  const alongX = unitX * half;
  const alongY = unitY * half;
  if (glyph === 5) {
    pathAddCircle(builder, x, y, half * 0.45);
    return;
  }
  // the normal, shorter than the length: ticks and cell heights
  const normalX = -alongY * 0.55;
  const normalY = alongX * 0.55;
  if (glyph === 6) {
    pathMoveTo(builder, x - alongX - normalX, y - alongY - normalY);
    pathLineTo(builder, x + alongX - normalX, y + alongY - normalY);
    pathLineTo(builder, x + alongX + normalX, y + alongY + normalY);
    pathLineTo(builder, x - alongX + normalX, y - alongY + normalY);
    pathClose(builder);
    return;
  }
  if (glyph === 2 || glyph === 4) {
    pathMoveTo(builder, x - alongX + normalX, y - alongY + normalY);
    pathLineTo(builder, x - alongX, y - alongY);
    pathLineTo(builder, x + alongX, y + alongY);
    pathLineTo(
      builder,
      x + alongX + (glyph === 2 ? normalX : -normalX),
      y + alongY + (glyph === 2 ? normalY : -normalY),
    );
    return;
  }
  pathMoveTo(builder, x - alongX, y - alongY);
  pathLineTo(builder, x + alongX, y + alongY);
  if (glyph === 1) pathLineTo(builder, x + alongX + normalX, y + alongY + normalY);
  else if (glyph === 3) {
    pathMoveTo(builder, x, y);
    pathLineTo(builder, x + normalX * 1.4, y + normalY * 1.4);
  }
}

/**
 * Whether a fragment is part of the ball at all, 0..1. While it materialises they arrive in the
 * film's order — in patches, behind the dial's band on the left first (revealKey) — and once it
 * has formed the script's slow fragment density thins them out a little.
 */
function fragmentShown(revealOrder: number, state: FrameState) {
  'worklet';
  return clamp01((state.bodyShare * 1.12 - revealOrder) * 9);
}

/**
 * How lit a fragment is this frame, 0..1 (0 = dark): its clock's fade envelope times its pool's
 * share. Pool 0 (calm) gives up the lowest ids as `mix` rises; pool 1 (fast) lights ids below
 * 2·mix. Whether a fragment is there at all is fragmentShown.
 *
 * The envelope fades over a third of the lit window at each end rather than the quarter it
 * was. A fragment's paint does not fade with it — only its length does, since a paint is set
 * once for the whole tier's path — so the fade is how quickly a lit stroke arrives in the
 * pixels it covers, and with the fragment clocks running half again as fast as before, a
 * quarter of the window had come down to three frames and each arrival showed as a step.
 */
function fragmentStrength(life: number, id: number, pool: number, state: FrameState) {
  'worklet';
  const progress = life / FRAGMENT_DUTY;
  const envelope = Math.min(1, progress * 3, (1 - progress) * 3);
  const poolShare = pool === 0 ? clamp01((id - state.mix) * 12 + 1) : clamp01((2 * state.mix - id) * 12);
  return envelope * poolShare;
}

/**
 * Which body builder a fragment goes to: 0 dim, 1 mid, 2 bright. Fading fragments and
 * thinned-out hot ones step down; while the ball forms, `heat` lifts mid ones up.
 */
function fragmentTier(brightness: number, strength: number, id: number, hotShare: number, heat: number) {
  'worklet';
  if (brightness === 2) {
    if (strength <= 0.55) return 1;
    const margin = hotShare - fraction(id * 13.7);
    if (margin > 0) return 2;
    // The share moves by a third in the 0.15 s it takes to grow agitated, so a plain cut would
    // step a fortieth of the bright strokes down in a single frame. A fragment just past the
    // share instead holds its brightness until its own clock fades it, so each one changes
    // while it is dimming and the handover is spread over their cycles rather than over the ramp.
    if (margin > -0.12 && strength > 0.86) return 2;
    return 1;
  }
  if (brightness === 1 && strength > 0.4) return fraction(id * 5.3) < heat ? 2 : 1;
  return 0;
}

/**
 * Where a fragment lands on screen this frame, and how much of it survives the limb.
 *
 * Writes `x`, `y`, `depth` and `edge` into `out` rather than returning them, because a frame
 * places a couple of thousand fragments and an object apiece would be a frame's worth of
 * rubbish to collect.
 */
function placeFragment(
  body: number[],
  offset: number,
  along: number,
  across: number,
  state: FrameState,
  out: number[],
) {
  'worklet';
  const unitX = body[offset + 2];
  const unitY = body[offset + 3];
  // Turned about the vertical axis before anything else: the fragment wanders around where it
  // sits on the turning ball, not around a fixed place on the screen.
  const rest = body[offset];
  const depthAtRest = body[offset + 9];
  const turnedX = rest * state.bodyCos + depthAtRest * state.bodySin;
  const y = body[offset + 1] + unitY * along + unitX * across;
  out[0] = turnedX + unitX * along - unitY * across;
  out[1] = y;
  out[2] = depthAtRest * state.bodyCos - rest * state.bodySin;
  // Nothing pops at the limb as it turns out of sight.
  out[3] = clamp01((0.94 * 0.94 - turnedX * turnedX - y * y) * 8);
}

/** The fragment body, turning about the vertical axis, sorted into the dim, mid and bright builders. */
function appendBody(builders: PathBuilder[], body: number[], state: FrameState) {
  'worklet';
  const time = state.time;
  const ragged = state.ragged;
  const placed = state.scratch;
  for (let offset = 0; offset < body.length; offset += BODY_STRIDE) {
    // Is it lit at all? Two in five are not, on any given frame, and this is the cheapest
    // question to ask of them: everything below — unpacking its class, where it sits in the
    // reveal, where the turn has carried it — is work those two would only throw away.
    const id = body[offset + 6];
    const phase = fraction(id * FRAGMENT_PHASE_FROM_ID);
    const cycles = time * body[offset + 5] + phase;
    const cycle = Math.floor(cycles);
    const life = cycles - cycle;
    if (life >= FRAGMENT_DUTY) continue;
    const shown = fragmentShown(body[offset + 8], state);
    if (shown <= 0) continue;
    const packed = body[offset + 7];
    const glyph = Math.floor(packed / FRAGMENT_CODE_GLYPH_STEP);
    const code = packed - glyph * FRAGMENT_CODE_GLYPH_STEP;
    // The code packs three things by addition — brightness 0-2, plus 3 if it belongs to the
    // fast pool, plus 6 if it rides the counter-turning shell — so division takes them apart.
    const turning = 3 * Math.floor(code / 6);
    const pool = Math.floor((code - turning * 2) / 3);
    const strength = shown * fragmentStrength(life, id, pool, state);
    if (strength < FRAGMENT_FAINTEST) continue;
    const unitX = body[offset + 2];
    const unitY = body[offset + 3];
    const length = body[offset + 4];
    // each time it re-lights, it does so a little along or across from where it was
    const hop = fraction(cycle * 0.618034 + id * 9.7);
    const along = (hop - 0.5) * 1.4 * length;
    // while he talks the body loosens: a fragment re-lights further still from where it was
    // The loosening while he talks fades out toward the limb: the silhouette must not move
    // with his voice, and a fragment at 0.9R that strayed a tenth of a radius outward would
    // take it with it. Compared as squares, so this costs no square root.
    const fromCentre = body[offset] * body[offset] + body[offset + 1] * body[offset + 1];
    const inward = clamp01((0.76 - fromCentre) * 3.2);
    const across = (fraction(hop * 23.17) - 0.5) * (FRAGMENT_WANDER + 1.3 * state.agitation * inward);
    placeFragment(body, offset, along, across, state, placed);
    const lit = strength * placed[3];
    if (lit < FRAGMENT_FAINTEST) continue;
    // while forming, the left limb is ragged: fragments stray outward
    const ragging = ragged > 0 && placed[0] < 0 && placed[0] * placed[0] + placed[1] * placed[1] > 0.5;
    const push = ragging ? 1 + ragged * 0.16 * fraction(id * 3.7) : 1;
    const x = placed[0] * push;
    const y = placed[1] * push;
    // While he thinks, only what the plane is passing stays lit; see SCAN_SECONDS.
    const nearness = state.thinking > 0 ? clamp01(1 - Math.abs(y - state.scan) / SCAN_HALF_WIDTH) : 0;
    const scanned = state.thinking > 0 ? 1 - state.thinking * (1 - SCAN_FLOOR) * (1 - nearness * nearness) : 1;
    const litHere = lit * scanned;
    if (litHere < FRAGMENT_FAINTEST) continue;
    // the far side of the ball is dimmer, as the turning shell below the core already is
    const plain =
      placed[2] < 0 ? 0 : fragmentTier(code - 3 * pool - 2 * turning, litHere, id, state.hotShare, state.introHeat);
    // ...and what the plane is in the middle of is lit to the brightest tier whatever it is, which
    // is what makes the pass a line of attention rather than a moving shadow.
    const tier = nearness > SCAN_BRIGHT_NEARNESS && state.thinking > 0.5 && placed[2] >= 0 ? 2 : plain;
    // Its length is its whole fade: a fragment grows out of nothing and shrinks back into it,
    // because a paint is set once for a whole tier and so cannot fade with one stroke in it.
    // Arriving at a third of its length, as it used to, meant arriving at full brightness over
    // a dozen pixels at once — with twice as many fragments that is a visible speckle at every
    // frame, and it is what the spec's script-boundary check counts.
    appendGlyph(builders[tier + turning], glyph, x, y, unitX, unitY, length * 0.5 * litHere);
  }
}

/** The lower hemisphere's turning shell: its front drifts right, its back (dim) drifts left. */
function appendStream(builders: PathBuilder[], stream: number[], state: FrameState) {
  'worklet';
  const time = state.time;
  const cosYaw = state.streamCos;
  const sinYaw = state.streamSin;
  for (let offset = 0; offset < stream.length; offset += STREAM_STRIDE) {
    const code = stream[offset + 8];
    const pool = code >= 3 ? 1 : 0;
    const id = stream[offset + 7];
    const shown = fragmentShown(stream[offset + 10], state);
    if (shown <= 0) continue;
    const cycles = time * stream[offset + 5] + stream[offset + 6];
    const life = cycles - Math.floor(cycles);
    if (life >= FRAGMENT_DUTY) continue;
    const strength = shown * fragmentStrength(life, id, pool, state);
    if (strength < FRAGMENT_FAINTEST) continue;
    const restX = stream[offset];
    const restZ = stream[offset + 2];
    const x = restX * cosYaw + restZ * sinYaw;
    const depth = restZ * cosYaw - restX * sinYaw;
    const y = stream[offset + 1];
    // fade out before the limb, so nothing pops where the shell turns out of view
    const edge = clamp01((0.86 - x * x - y * y) * 8);
    if (edge * strength < FRAGMENT_FAINTEST) continue;
    // a latitude runs horizontally on screen, foreshortened as it turns toward the limb
    const halfX = stream[offset + 3] * cosYaw + stream[offset + 4] * sinYaw;
    const tier = depth < 0 ? 0 : fragmentTier(code - 3 * pool, strength * edge, id, state.hotShare, state.introHeat);
    const half = Math.abs(halfX) * strength * edge;
    appendGlyph(builders[tier], stream[offset + 9], x, y, 1, 0, half);
  }
}

/** A path handed out by a builder, which is what every draw call takes. */
type DetachedPath = ReturnType<typeof pathOf>;

/**
 * How many nested rings the halo is built from, and what each contributes.
 *
 * Two rings made a two-step ramp, and with the halo widened the outer step became a visible
 * rim: every particle sat in a disc of flat colour that ended at a hard, and — with
 * antialiasing off — jagged, edge. The user saw exactly that, glow circles round the sparks.
 * Three rings put the steps below what the eye picks out, so the light falls away from the
 * stroke instead of stopping, and the share is chosen so they come to what the two did at the
 * centre: with Screen blending that is 1 - (1 - share)^3 against the old
 * 1 - (1 - 0.52s)(1 - 0.61s), within a couple of percent across the strengths the tiers ask for.
 *
 * Five rings were smoother still and cost too much. Every ring paints the middle of every
 * particle again, so the fill grows with the ring count and the halo's width both, and a halo
 * this wide over a thousand particles is most of what the phone's GPU does: five rings doubled
 * that against two, and the user felt it as a dropped frame rate. Three keeps the ramp and hands
 * back most of the cost.
 *
 * A sprite with the ramp already in it, drawn once per particle, would paint the middle once
 * rather than three times — and it is 4.5x *slower* than five rings, because `drawAtlas` wants a
 * transform object per particle and marshalling a thousand of those across into Skia costs more
 * than the drawing it saves. Measured, not assumed; the same reason `drawPoints` lost to plain
 * paths earlier.
 */
/**
 * ONE RING, AND WE ARE MEASURING WHICH HALF OF THE GEOMETRY COSTS THE FRAME.
 *
 * The phone drew this at 8 frames a second and the same picture at 58 in its own browser. Build
 * was 2.6 ms of a 120 ms frame, so it is not JavaScript; and it did not change with the size of
 * the canvas, which rules out fill rate — the thing five rounds of benchmarks measured, every one
 * of them on a CPU scanline rasteriser where cost *is* pixels. A GPU pays per path segment.
 *
 * A build with a quarter of the fragments, a quarter of the shell and one ring ran at 57. So it is
 * geometry. This build changes exactly one thing against that one: the fragments and the shell are
 * back at full strength, and the halo stays at one ring.
 *
 * The halo is the suspect worth eliminating first, because it strokes *every* path a second time
 * and does it at ten times the width — and a wide stroke is far more geometry than a thin one. If
 * this is still fast, the thousand particles were never the problem and only the halo has to
 * change. If it collapses back to 8, the particles are the cost, and the way to keep them is to
 * stop tessellating them: sprites through `drawAtlas`, which was dismissed earlier on a CPU
 * benchmark we now know was the wrong instrument.
 */
const HALO_RINGS = 1;
const HALO_RING_SHARE = 0.52;

function drawParticleHalo(
  canvas: HologramCanvas,
  resources: Resources,
  path: DetachedPath,
  reach: number,
  baseStrength: number,
  glowGain: number,
) {
  'worklet';
  // The halo is the light between the strokes, so lifting it is what reads as the ball glowing
  // rather than as its texture changing colour.
  const strength = baseStrength * glowGain;
  const paint = resources.particleHaloStroke;
  paint.setAlphaf(strength * HALO_RING_SHARE);
  // Widest first, each ring narrower by the same step, so what they add up to falls away from
  // the stroke rather than ending at a rim.
  for (let ring = 0; ring < HALO_RINGS; ring++) {
    paint.setStrokeWidth((reach * (HALO_RINGS - ring)) / HALO_RINGS);
    canvas.drawPath(path, paint);
  }
}

/** The body's dim and mid strokes, pinned and turning (the bright ones are drawn later, over the core). */
function drawBody(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const builders = resources.pathBuilders.body;
  if (state.bodyShare <= 0) return;
  appendBody(builders, scene.body, state);
  appendStream(builders, scene.stream, state);
  for (let group = 0; group < 2; group++) {
    if (group === 1) {
      canvas.save();
      canvas.rotate(state.shellTurn, CORE_X, CORE_Y);
    }
    // Every tier carries a halo of its own, the dim one included, where the drawing used to
    // put one faint pass on the mid and bright tiers only. With the wash behind them down to
    // half, these are what light the space between the strokes — and unlike the wash, they go
    // out and come back on each fragment's own clock. The dim tier's halo reaches nearly as far
    // as the mid tier's because it is the most numerous and the most spread out, so it is the
    // one that lights the bare fill between the clumps; it is the faintest for the same reason.
    const dimPath = pathOf(resources.skia, builders[group * 3]);
    drawParticleHalo(canvas, resources, dimPath, 0.115, 0.3, state.glowGain);
    resources.bodyDimStroke.setStrokeWidth(0.014);
    resources.bodyDimStroke.setAlphaf(0.62);
    canvas.drawPath(dimPath, resources.bodyDimStroke);
    const midPath = pathOf(resources.skia, builders[group * 3 + 1]);
    drawParticleHalo(canvas, resources, midPath, 0.12, 0.34, state.glowGain);
    resources.bodyMidStroke.setStrokeWidth(0.0155);
    resources.bodyMidStroke.setAlphaf(0.85);
    canvas.drawPath(midPath, resources.bodyMidStroke);
    if (group === 1) canvas.restore();
  }
}

/** The bright fragments, with the widest of the amber halos. */
function drawBodyHighlights(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const brightPath = pathOf(resources.skia, resources.pathBuilders.body[2]);
  const turningBrightPath = pathOf(resources.skia, resources.pathBuilders.body[5]);
  if (state.bodyShare > 0) {
    for (let group = 0; group < 2; group++) {
      const path = group === 0 ? brightPath : turningBrightPath;
      if (group === 1) {
        canvas.save();
        canvas.rotate(state.shellTurn, CORE_X, CORE_Y);
      }
      drawParticleHalo(canvas, resources, path, 0.115, 0.38, state.glowGain);
      resources.bodyBrightStroke.setStrokeWidth(0.0165);
      resources.bodyBrightStroke.setAlphaf(1 - 0.25 * state.agitation);
      canvas.drawPath(path, resources.bodyBrightStroke);
      // a narrow hot core, the film's brightest strokes (#ffd26c, pulled a little toward orange)
      resources.bodyHotStroke.setStrokeWidth(0.007);
      resources.bodyHotStroke.setAlphaf(0.8 * (1 - 0.95 * state.agitation));
      canvas.drawPath(path, resources.bodyHotStroke);
      if (group === 1) canvas.restore();
    }
  }
}

// ---- lines: comets, spokes, the swoosh --------------------------------------------------

/** Comet arcs from the core to the lower right, each on its own slow clock, sliding with the lower stream. */
function appendComets(builder: PathBuilder, comets: number[], time: number) {
  'worklet';
  let shown = 0;
  for (let offset = 0; offset < comets.length; offset += COMET_STRIDE) {
    const life = fraction(time / comets[offset] + comets[offset + 1]);
    if (life > 0.85) continue;
    const grow = smooth01(life / 0.15);
    const fade = 1 - smooth01((life - 0.7) / 0.15);
    const sweep = comets[offset + 4] * grow;
    const tail = comets[offset + 4] * (1 - fade);
    const base = comets[offset + 2] + life * 0.35;
    const radius = comets[offset + 3];
    const centreX = CORE_X + Math.cos(base) * radius;
    const centreY = CORE_Y + Math.sin(base) * radius;
    if (sweep - tail < 0.05) continue;
    appendArc(builder, centreX, centreY, radius, base + Math.PI + tail, sweep - tail);
    shown++;
  }
  return shown;
}

/**
 * Faint radial spokes from the core's rim at 0.14R, fanning over the lower half or toward
 * 9-10 o'clock, as long as `envelope` lets them.
 */
function appendSpokes(builder: PathBuilder, seed: number, envelope: number) {
  'worklet';
  const towardNine = hashInteger(seed) < 0.4;
  const count = 6;
  for (let spoke = 0; spoke < count; spoke++) {
    const clock = towardNine ? 270 + (spoke - 2.5) * 9 : 130 + spoke * 20;
    const angle = clockRadians(clock + (hashInteger(seed * 7 + spoke) - 0.5) * 8);
    // each spoke grows outward from the core's rim and shrinks back into it, so nothing pops
    const reach = (0.31 + 0.4 * hashInteger(seed * 13 + spoke)) * envelope;
    if (reach < 0.01) continue;
    pathMoveTo(builder, CORE_X + Math.cos(angle) * 0.14, CORE_Y + Math.sin(angle) * 0.14);
    pathLineTo(builder, CORE_X + Math.cos(angle) * (0.14 + reach), CORE_Y + Math.sin(angle) * (0.14 + reach));
  }
}

/** A fan of hairlines arcing over the core, rising to the right, building up line by line over 1.2 s. */
function appendSwoosh(builder: PathBuilder, seconds: number) {
  'worklet';
  const lines = Math.floor(24 * clamp01(seconds / 1.2));
  const tilt = -0.52;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  for (let line = 0; line < lines; line++) {
    const radius = 1.2 + line * 0.013;
    // a circle whose top passes just above the core, rotated so the band rises 30° to the right
    const localX = 0.05;
    const localY = radius - 0.12 - line * 0.013;
    appendArc(
      builder,
      CORE_X + localX * cosTilt - localY * sinTilt,
      CORE_Y + localX * sinTilt + localY * cosTilt,
      radius,
      -Math.PI / 2 + tilt - 0.42,
      0.84,
    );
  }
}

/** Comets always; spokes or the swoosh when the script's epoch calls for them. */
function drawLines(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const alpha = state.innerAlpha * state.coreAlpha;
  if (alpha <= 0) return;
  const builders = resources.pathBuilders;
  appendComets(builders.lines, scene.comets, state.time);
  const script = state.script;
  if (script.lineKind === 1) appendSpokes(builders.lines, script.lineSeed, script.lineEnvelope);
  const linePath = pathOf(resources.skia, builders.lines);
  resources.bodyGlowStroke.setStrokeWidth(0.034);
  resources.bodyGlowStroke.setAlphaf(0.12 * alpha);
  canvas.drawPath(linePath, resources.bodyGlowStroke);
  resources.lineStroke.setStrokeWidth(0.013);
  resources.lineStroke.setAlphaf(0.7 * alpha);
  canvas.drawPath(linePath, resources.lineStroke);
  if (script.lineKind === 2) {
    appendSwoosh(builders.swoosh, script.lineSeconds);
    resources.lineStroke.setStrokeWidth(0.006);
    resources.lineStroke.setAlphaf(0.42 * alpha * script.lineEnvelope);
    canvas.drawPath(pathOf(resources.skia, builders.swoosh), resources.lineStroke);
  }
}

// ---- the core -----------------------------------------------------------------------------

/** The core: the elongated bloom, the hooked ring with its darker middle, the faint 0.3R ring, the bar and a spiky knot. */
function drawCore(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const alpha = state.coreAlpha;
  if (alpha <= 0) return;
  const brightness = alpha * state.coreDrift;
  canvas.save();
  canvas.translate(CORE_X, CORE_Y);
  canvas.save();
  canvas.rotate(-45, 0, 0);
  canvas.scale(0.2, 0.29);
  resources.coreBloomFill.setAlphaf(clamp01(0.52 * brightness));
  canvas.drawCircle(0, 0, 1, resources.coreBloomFill);
  canvas.restore();
  // the furry knot of spikes on the ring's upper left, re-drawn a few times a second; it shares
  // the glow below, which softens the ring too
  const knot = resources.pathBuilders.coreKnot;
  const step = Math.floor(state.time * 6);
  for (let spike = 0; spike < 11; spike++) {
    const angle = (spike / 11) * Math.PI * 2 + hashInteger(step * 11 + spike) * 0.6;
    const length = 0.03 + 0.05 * hashInteger(step * 17 + spike);
    pathMoveTo(knot, -0.075, -0.07);
    pathLineTo(knot, -0.075 + Math.cos(angle) * length, -0.07 + Math.sin(angle) * length);
  }
  const knotPath = pathOf(resources.skia, knot);
  resources.coreGlowStroke.setStrokeWidth(0.075);
  resources.coreGlowStroke.setAlphaf(0.2 * brightness);
  canvas.drawPath(resources.coreRingPath, resources.coreGlowStroke);
  canvas.drawPath(knotPath, resources.coreGlowStroke);
  resources.coreGlowStroke.setStrokeWidth(0.04);
  resources.coreGlowStroke.setAlphaf(0.3 * brightness);
  canvas.drawPath(resources.coreBarPath, resources.coreGlowStroke);
  canvas.drawPath(resources.coreRingPath, resources.coreGlowStroke);
  resources.coreRingStroke.setStrokeWidth(0.017);
  resources.coreRingStroke.setAlphaf(clamp01(0.62 * brightness));
  canvas.drawPath(resources.coreRingPath, resources.coreRingStroke);
  resources.coreRingStroke.setStrokeWidth(0.013);
  resources.coreRingStroke.setAlphaf(clamp01(0.62 * brightness));
  canvas.drawPath(resources.coreBarPath, resources.coreRingStroke);
  resources.coreRingStroke.setStrokeWidth(0.009);
  resources.coreRingStroke.setAlphaf(0.55 * alpha);
  canvas.drawPath(knotPath, resources.coreRingStroke);
  canvas.restore();
}

// ---- the rim ------------------------------------------------------------------------------

/** A truss piece's circuit trace between the rails and its paired hanging strut. */
function appendTrussDetail(detail: PathBuilder, start: number, trace: number, strut: number) {
  'worklet';
  const early = start + 0.045;
  const late = start + 0.11;
  const cosEarly = Math.cos(early);
  const sinEarly = Math.sin(early);
  const cosLate = Math.cos(late);
  const sinLate = Math.sin(late);
  if (trace === 1) {
    pathMoveTo(detail, cosEarly * 0.955, sinEarly * 0.955);
    pathLineTo(detail, cosEarly * 1.005, sinEarly * 1.005);
    pathLineTo(detail, cosLate * 1.005, sinLate * 1.005);
  } else if (trace === 2) {
    pathMoveTo(detail, cosEarly * 0.95, sinEarly * 0.95);
    pathLineTo(detail, cosEarly * 0.99, sinEarly * 0.99);
    pathLineTo(detail, cosLate * 0.99, sinLate * 0.99);
    pathLineTo(detail, cosLate * 1.03, sinLate * 1.03);
  } else if (trace === 3) {
    pathMoveTo(detail, cosEarly * 1.02, sinEarly * 1.02);
    pathLineTo(detail, cosLate * 1.02, sinLate * 1.02);
    pathMoveTo(detail, (cosEarly + cosLate) * 0.4725, (sinEarly + sinLate) * 0.4725);
    pathLineTo(detail, (cosEarly + cosLate) * 0.5, (sinEarly + sinLate) * 0.5);
  }
  if (strut > 0) {
    // a pair of struts 0.02R apart hanging from the inner rail toward the centre
    const tangentX = -sinEarly * 0.02;
    const tangentY = cosEarly * 0.02;
    const inner = 0.935 - strut;
    pathMoveTo(detail, cosEarly * 0.935, sinEarly * 0.935);
    pathLineTo(detail, cosEarly * inner, sinEarly * inner);
    pathMoveTo(detail, cosEarly * 0.935 + tangentX, sinEarly * 0.935 + tangentY);
    pathLineTo(detail, cosEarly * inner + tangentX, sinEarly * inner + tangentY);
  }
}

/**
 * The segmented ladder ring, in the rolling frame (the canvas is already rotated), split
 * by how bright each part is drawn: the outer rail (the brightest continuous line), the
 * inner rail, the amber haze between them, and the fine rungs, circuit traces and hanging
 * struts. Pieces pop in, lengthen and join as its weight rises, and break back into dashes
 * as it falls.
 */
function appendTruss(builders: Resources['pathBuilders'], truss: number[], weight: number) {
  'worklet';
  let shown = 0;
  for (let offset = 0; offset < truss.length; offset += TRUSS_PIECE_STRIDE) {
    const visible = clamp01((weight * 1.15 - truss[offset + 4] * 0.55 - (truss[offset + 5] === 2 ? 0.2 : 0)) / 0.35);
    if (visible < 0.08) continue;
    shown++;
    const start = clockRadians(truss[offset]);
    const sweep = truss[offset + 1] * DEGREES_TO_RADIANS * visible;
    appendArc(builders.truss, 0, 0, 1.035, start, sweep);
    appendArc(builders.trussInner, 0, 0, 0.935, start, sweep);
    if (visible < 0.5) continue;
    appendArc(builders.trussHaze, 0, 0, 0.985, start, sweep);
    const cosStart = Math.cos(start);
    const sinStart = Math.sin(start);
    pathMoveTo(builders.trussRungs, cosStart * 0.935, sinStart * 0.935);
    pathLineTo(builders.trussRungs, cosStart * 1.035, sinStart * 1.035);
    if (visible < 0.9) continue;
    appendTrussDetail(builders.trussDetail, start, truss[offset + 2], truss[offset + 3]);
  }
  return shown;
}

/**
 * The rolling rim layer: the ladder truss, the thin ring's ticks and, when the truss
 * leads, the fan of strands on the right.
 */
function drawTruss(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const script = state.script;
  const weight = script.trussWeight * state.rimAlpha;
  const builders = resources.pathBuilders;
  canvas.save();
  canvas.rotate(state.roll, 0, 0);
  // Built once per weight, not once per frame.
  //
  // The ring is built in the rolling frame — the canvas above is already turned — so its shape
  // depends on `weight` alone, and `weight` is exactly constant except while one rim element
  // hands over to another, which takes HANDOVER_SECONDS out of an epoch lasting several times
  // that. Every other frame re-made the same five paths and threw them away: 13% of a frame,
  // measured, for an answer that had not changed.
  //
  // Keyed on the input rather than on what happened last frame, so this is memoisation and not
  // state: the same frame still draws the same picture whatever came before it, which is what
  // `draws a frame the same way after other frames` exists to hold us to.
  const cache = resources.trussCache;
  if (cache.weight !== weight) {
    cache.shown = appendTruss(builders, scene.truss, weight);
    cache.outer = pathOf(resources.skia, builders.truss);
    cache.inner = pathOf(resources.skia, builders.trussInner);
    cache.haze = pathOf(resources.skia, builders.trussHaze);
    cache.rungs = pathOf(resources.skia, builders.trussRungs);
    cache.detail = pathOf(resources.skia, builders.trussDetail);
    cache.weight = weight;
  }
  const shown = cache.shown;
  const outerPath = cache.outer;
  const innerPath = cache.inner;
  const hazePath = cache.haze;
  const rungPath = cache.rungs;
  const detailPath = cache.detail;
  if (state.rimAlpha > 0) {
    // the thin ring's ticks roll with the rest of the rim layer, but only show through the
    // ring's bright stretch from 1 to 5 o'clock: the film has no graduated dial round the limb
    const ticks = scene.ringTicks;
    for (let offset = 0; offset < ticks.length; offset += RING_TICK_STRIDE) {
      const onScreen = fraction((ticks[offset] + state.roll) / 360) * 360;
      if (onScreen < 30 || onScreen > 150) continue;
      const angle = clockRadians(ticks[offset]);
      const half = ticks[offset + 1] * 0.5 * smooth01((onScreen - 30) / 20) * smooth01((150 - onScreen) / 20);
      if (half < 0.004) continue;
      pathMoveTo(builders.ringTicks, Math.cos(angle) * (1 - half), Math.sin(angle) * (1 - half));
      pathLineTo(builders.ringTicks, Math.cos(angle) * (1 + half), Math.sin(angle) * (1 + half));
    }
    resources.trussStroke.setStrokeWidth(0.009);
    resources.trussStroke.setAlphaf((0.15 + 0.6 * script.ringWeight) * state.rimAlpha);
    canvas.drawPath(pathOf(resources.skia, builders.ringTicks), resources.trussStroke);
  }
  if (shown > 0) {
    // leading, the ladder ring is a bold gold band (shot d, shot b's box-frame ribbon);
    // faint, its dashes are fine
    resources.trussHazeStroke.setStrokeWidth(0.18);
    resources.trussHazeStroke.setAlphaf(0.58 * weight * state.glowGain);
    canvas.drawPath(hazePath, resources.trussHazeStroke);
    resources.trussGlowStroke.setStrokeWidth(0.1 + 0.05 * weight);
    resources.trussGlowStroke.setAlphaf(0.5 * (0.3 + 0.7 * weight) * state.glowGain);
    canvas.drawPath(outerPath, resources.trussGlowStroke);
    resources.trussStroke.setStrokeWidth(0.011 + 0.006 * weight);
    resources.trussStroke.setAlphaf(0.35 + 0.4 * weight);
    canvas.drawPath(innerPath, resources.trussStroke);
    resources.trussStroke.setStrokeWidth(0.02 + 0.012 * weight);
    resources.trussStroke.setAlphaf(0.5 + 0.45 * weight);
    canvas.drawPath(outerPath, resources.trussStroke);
    resources.trussCoreStroke.setStrokeWidth(0.008);
    resources.trussCoreStroke.setAlphaf(0.85 * weight);
    canvas.drawPath(outerPath, resources.trussCoreStroke);
    // the rungs are finer than the outer rail, the circuit traces and struts finer still
    resources.trussStroke.setStrokeWidth(0.016);
    resources.trussStroke.setAlphaf(0.35 + 0.55 * weight);
    canvas.drawPath(rungPath, resources.trussStroke);
    resources.trussStroke.setStrokeWidth(0.006);
    resources.trussStroke.setAlphaf(0.2 + 0.35 * weight);
    canvas.drawPath(detailPath, resources.trussStroke);
  }
  canvas.restore();
  // the strand fan turns counter-clockwise at 3.5°/s, as shot d's upper-right rim strands do,
  // fading out and back on a 14 s cycle
  const fanCycle = fraction(state.time / 14);
  const fanAlpha = smooth01(fanCycle / 0.12) * smooth01((1 - fanCycle) / 0.12) * state.rimAlpha;
  const fanWeight = clamp01((script.trussWeight - 0.35) / 0.5) * fanAlpha;
  if (fanWeight > 0.02) {
    canvas.save();
    canvas.rotate(-5 * fanCycle * 14 * 0.7, 0, 0);
    resources.trussStroke.setStrokeWidth(0.008);
    resources.trussStroke.setAlphaf(0.6 * fanWeight);
    canvas.drawPath(resources.strandFanPath, resources.trussStroke);
    canvas.restore();
  }
}

/**
 * Appends one crescent strand's pieces that fall inside a pinned clock window. The
 * pieces roll with the rim layer, gaps open as `gapGrowth` rises, and pieces near a
 * fresh burst's launch point are knocked out as the chips leave from there.
 */
function appendCrescentStrand(
  builder: PathBuilder,
  pieces: number[],
  strand: number,
  radius: number,
  drift: number,
  windowFrom: number,
  windowTo: number,
  state: FrameState,
  shatterClock: number,
) {
  'worklet';
  const gapGrowth = state.spread;
  const shatter = state.burstAge < 0.18 ? (1 - state.burstAge / 0.18) * (0.5 + 0.5 * state.burstStrength) : 0;
  const first = strand * CRESCENT_PIECES_PER_STRAND * CRESCENT_PIECE_STRIDE;
  for (let piece = 0; piece < CRESCENT_PIECES_PER_STRAND; piece++) {
    const offset = first + piece * CRESCENT_PIECE_STRIDE;
    const sweep = pieces[offset + 1];
    const hash = pieces[offset + 2];
    // while he talks the split strands keep streaming outward and back at about 0.1 R/s, as the
    // film's limb unravels on "Doctor." rather than holding a new shape
    const along = radius + drift * Math.sin((state.time * 0.45 + hash) * 6.283185307179586);
    const shrink = gapGrowth * sweep * (strand < 2 ? 0.1 + 0.45 * hash : 0.25 + 0.6 * hash) * 0.5;
    let from = pieces[offset] + state.roll + shrink;
    from -= 360 * Math.floor(from / 360);
    const span = sweep - 2 * shrink;
    // the window's ends are ragged and belong to the pieces rolling through them, so the
    // crescent frays out at its tips rather than stopping at a fixed angle
    const ragged = 14 * fraction(hash * 7.3 + strand * 0.37);
    // a piece can straddle 12 o'clock: try it at its angle and one turn earlier
    for (let turn = 0; turn < 2; turn++) {
      const start = Math.max(from - 360 * turn, windowFrom + ragged);
      const end = Math.min(from - 360 * turn + span, windowTo - ragged);
      if (end - start < 0.6) continue;
      if (shatter > hash && Math.abs((start + end) * 0.5 - shatterClock) < 16) continue;
      appendArc(builder, 0, 0, along, clockRadians(start), (end - start) * DEGREES_TO_RADIANS);
    }
  }
}

/** Where the latest burst's chips leave the limb, as a clock angle: the left limb about mid-height. */
function burstClock(burstCount: number) {
  'worklet';
  return 255 + hashInteger(burstCount * 131 + 7) * 35;
}

/**
 * One crescent strand's radius, the deepest width tier it reaches and the clock angle it is
 * centred on, written into out[0..2]. Calm, the four strands lie between 0.965R and 1.03R; split,
 * they open out to 0.94-1.19R, and the outer two gather toward the upper left.
 */
function crescentStrandNumbers(strand: number, spread: number, out: number[]) {
  'worklet';
  let calm = 0.965;
  let split = 0.94;
  let deepestTier = 2;
  if (strand === 1) {
    calm = 0.99;
    split = 1.02;
    deepestTier = 3;
  } else if (strand === 2) {
    calm = 1.012;
    split = 1.1;
    deepestTier = 1;
  } else if (strand === 3) {
    calm = 1.03;
    split = 1.19;
    deepestTier = 0;
  }
  out[0] = calm + spread * (split - calm);
  out[1] = deepestTier;
  out[2] = 262 + 28 * (strand >= 2 ? spread : 0);
}

/**
 * Builds the crescent's four strands into the width-tier builders (0 thin, 1 medium,
 * 2 wide, 3 core): the inner strands reach the wide and core tiers, the outer ones only
 * the thin and medium. Tier windows are centred on 8:40 and scaled by `growth`.
 */
function appendCrescent(builders: PathBuilder[], pieces: number[], state: FrameState, growth: number) {
  'worklet';
  const spread = state.spread;
  const shatterClock = burstClock(state.burstCount);
  const strandNumbers = [0, 0, 0];
  for (let strand = 0; strand < 4; strand++) {
    crescentStrandNumbers(strand, spread, strandNumbers);
    const radius = strandNumbers[0];
    const deepestTier = strandNumbers[1];
    const strandCentre = strandNumbers[2];
    // the outer strands, as they split off, shorten as well as gathering toward the upper left
    const outer = strand >= 2 ? spread : 0;
    for (let tier = 0; tier <= deepestTier; tier++) {
      // 70, 56, 40 and 24 degrees of half-width, thin tier to core tier
      const tierWidth = tier === 0 ? 70 : 72 - tier * 16;
      const halfWidth = tierWidth * growth * (1 - 0.4 * outer);
      appendCrescentStrand(
        builders[tier],
        pieces,
        strand,
        radius,
        spread * (strand < 2 ? 0.025 : 0.06),
        strandCentre - halfWidth,
        strandCentre + halfWidth,
        state,
        shatterClock,
      );
    }
  }
}

/**
 * The bright crescent on the left limb, 11 o'clock round to 7, pinned in screen
 * space while its breaks roll through it. Four strands in width tiers make a thick
 * tapered band; while he talks they spread to 0.94-1.19R, thin, break up and lose
 * their hot core.
 */
function drawCrescent(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const weight = Math.max(state.script.crescentWeight, 0.65 * state.agitation) * state.rimAlpha;
  const growth = state.crescentGrowth;
  if (weight <= 0.01 || growth <= 0.01) return;
  const builders = resources.pathBuilders.crescent;
  const spread = state.spread;
  appendCrescent(builders, scene.crescentPieces, state, growth);
  const thin = pathOf(resources.skia, builders[0]);
  const medium = pathOf(resources.skia, builders[1]);
  const wide = pathOf(resources.skia, builders[2]);
  const core = pathOf(resources.skia, builders[3]);
  // The bloom holds while the crescent splits. It lights more than half the limb, so dimming it
  // would pull the measured silhouette in, and the film's does not shrink while he speaks — its
  // width goes up, if anything. What leaves on "Doctor." is the hot core inside the crescent,
  // and that is taken out below.
  resources.limbBloomFill.setAlphaf(clamp01(0.42 * weight * growth));
  canvas.drawCircle(0, 0, LIMB_BLOOM_RADIUS, resources.limbBloomFill);
  resources.crescentGlowStroke.setStrokeWidth(0.1 * (1 - 0.5 * spread));
  resources.crescentGlowStroke.setAlphaf(0.26 * weight);
  canvas.drawPath(wide, resources.crescentGlowStroke);
  resources.crescentThinStroke.setStrokeWidth(0.01);
  resources.crescentThinStroke.setAlphaf(clamp01(0.8 * weight));
  canvas.drawPath(thin, resources.crescentThinStroke);
  resources.crescentMediumStroke.setStrokeWidth(0.026 * (1 - 0.45 * spread));
  resources.crescentMediumStroke.setAlphaf(clamp01(0.8 * weight));
  canvas.drawPath(medium, resources.crescentMediumStroke);
  resources.crescentWideStroke.setStrokeWidth(0.056 * (1 - 0.62 * spread));
  resources.crescentWideStroke.setAlphaf(clamp01(0.85 * weight * (1 - 0.3 * spread)));
  canvas.drawPath(wide, resources.crescentWideStroke);
  resources.crescentCoreStroke.setStrokeWidth(0.018 * (1 - 0.5 * spread));
  resources.crescentCoreStroke.setAlphaf(clamp01(0.9 * weight * (1 - spread) * (1 - spread)));
  canvas.drawPath(core, resources.crescentCoreStroke);
}

/**
 * The thin rim ring: a hairline circle at 1R, brightest from 1 to 4 o'clock, on a soft
 * ridge of light just inside the limb — the film's limb ridge (shots d, e, g: the
 * 0.92-1.02R band 1.3-1.6× as bright as the band inside it) — which also shows under a
 * leading ladder ring.
 */
function drawThinRing(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const script = state.script;
  const ridge = script.ringWeight * state.rimAlpha;
  if (ridge > 0.01) {
    canvas.save();
    canvas.rotate(state.roll, 0, 0);
    resources.limbRidgeFill.setAlphaf(clamp01(ridge));
    canvas.drawCircle(0, 0, LIMB_RIDGE_RADIUS, resources.limbRidgeFill);
    canvas.restore();
  }
  const weight = script.ringWeight * state.rimAlpha;
  if (weight <= 0.01) return;
  resources.thinRingStroke.setStrokeWidth(0.012 + 0.008 * weight);
  resources.thinRingStroke.setAlphaf(clamp01(0.25 + 0.7 * weight));
  canvas.drawCircle(0, 0, 1.0, resources.thinRingStroke);
}

/**
 * While he talks: strands fraying outward off the upper-left limb at about 0.1 R/s,
 * and thin streak arcs at 1.2-1.27R. Each is a slot on its own clock; agitation only
 * decides which slots show, and a slot fades through its length, so nothing pops.
 */
function drawFray(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const drive = state.frayDrive;
  if (drive <= 0.02) return;
  const builder = resources.pathBuilders.fray;
  const time = state.time;
  const fray = scene.fray;
  for (let offset = 0; offset < fray.length; offset += FRAY_STRIDE) {
    const gate = clamp01((drive - fray[offset + 4]) * 5);
    const life = fraction(time * fray[offset + 2] + fray[offset + 3]);
    const visible = gate * (1 - smooth01((life - 0.55) / 0.35)) * smooth01(life / 0.1);
    if (visible < 0.08) continue;
    const sweep = fray[offset + 1] * visible * DEGREES_TO_RADIANS;
    const centre = clockRadians(fray[offset]);
    appendArc(builder, 0, 0, 1.0 + 0.17 * life, centre - sweep / 2, sweep);
  }
  const arcs = scene.streakArcs;
  for (let offset = 0; offset < arcs.length; offset += STREAK_ARC_STRIDE) {
    const gate = clamp01((drive - arcs[offset + 5]) * 4);
    const life = fraction(time * arcs[offset + 3] + arcs[offset + 4]);
    const visible = gate * smooth01(life / 0.2) * (1 - smooth01((life - 0.65) / 0.25));
    if (visible < 0.08) continue;
    const sweep = arcs[offset + 2] * visible * DEGREES_TO_RADIANS;
    appendArc(builder, 0, 0, arcs[offset + 1], clockRadians(arcs[offset]) - sweep / 2, sweep);
  }
  const streaks = scene.limbStreaks;
  for (let offset = 0; offset < streaks.length; offset += LIMB_STREAK_STRIDE) {
    const gate = clamp01((drive - streaks[offset + 4]) * 4);
    const life = fraction(time * streaks[offset + 2] + streaks[offset + 3]);
    const visible = gate * smooth01(life / 0.15) * (1 - smooth01((life - 0.6) / 0.3));
    if (visible < 0.08) continue;
    const y = streaks[offset];
    // leaving the limb at about 0.3 R/s, bright head first
    const head = Math.sqrt(1 - y * y) * 0.96 + 0.3 * life;
    pathMoveTo(builder, head - streaks[offset + 1] * visible, y);
    pathLineTo(builder, head, y);
  }
  resources.frayStroke.setStrokeWidth(0.011);
  resources.frayStroke.setAlphaf(0.8);
  canvas.drawPath(pathOf(resources.skia, builder), resources.frayStroke);
}

// ---- chip bursts --------------------------------------------------------------------------

/** Appends a slab from its centre, unit tangent and half sizes. */
function appendSlab(
  builder: PathBuilder,
  centreX: number,
  centreY: number,
  tangentX: number,
  tangentY: number,
  halfTangential: number,
  halfRadial: number,
) {
  'worklet';
  const alongX = tangentX * halfTangential;
  const alongY = tangentY * halfTangential;
  const outX = tangentY * halfRadial;
  const outY = -tangentX * halfRadial;
  pathMoveTo(builder, centreX - alongX - outX, centreY - alongY - outY);
  pathLineTo(builder, centreX + alongX - outX, centreY + alongY - outY);
  pathLineTo(builder, centreX + alongX + outX, centreY + alongY + outY);
  pathLineTo(builder, centreX - alongX + outX, centreY - alongY + outY);
  pathClose(builder);
}

/**
 * One chip at `clock` and `radius`: a slab and its hot middle, sized from `seed`. While it
 * breaks up (`breakUp` 0..1) it thins and shortens, and a gap opens across its middle that
 * pushes the two halves apart.
 */
function appendChip(
  bodies: PathBuilder,
  cores: PathBuilder,
  clock: number,
  radius: number,
  seed: number,
  breakUp: number,
  size: number,
) {
  'worklet';
  const angle = clockRadians(clock);
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  const halfTangential = size * (0.11 + 0.055 * hashInteger(seed + 7)) * (1 - 0.35 * breakUp);
  const halfRadial = size * (0.04 + 0.03 * hashInteger(seed + 11)) * (1 - breakUp) ** 1.5;
  if (halfRadial < 0.004) return;
  const gap = breakUp * halfTangential * 0.6;
  const pieces = breakUp > 0 ? 2 : 1;
  for (let piece = 0; piece < pieces; piece++) {
    const pieceHalf = pieces === 1 ? halfTangential : (halfTangential - gap) * 0.5;
    const shift = pieces === 1 ? 0 : (piece === 0 ? -1 : 1) * (gap + pieceHalf);
    const centreX = cosAngle * radius - sinAngle * shift;
    const centreY = sinAngle * radius + cosAngle * shift;
    appendSlab(bodies, centreX, centreY, -sinAngle, cosAngle, pieceHalf, halfRadial);
    appendSlab(cores, centreX, centreY, -sinAngle, cosAngle, pieceHalf * 0.8, halfRadial * 0.45);
  }
}

/**
 * One chip of a burst: where along the limb it leaves from, how fast, and how big. Chip 0 leads
 * — the big slab the film throws, fastest and furthest — and the rest are half its length or
 * less, spread along the limb round it. A split burst throws its chips at two clocks instead,
 * alternating between them.
 */
function appendBurstChip(
  bodies: PathBuilder,
  cores: PathBuilder,
  seed: number,
  chip: number,
  base: number,
  split: boolean,
  age: number,
  flight: number,
  breakUp: number,
  size: number,
) {
  'worklet';
  const upper = split && chip % 2 === 0;
  const leads = chip === 0;
  const along = split ? 16 : 52;
  const centre = split ? (upper ? 300 : 250) : base;
  const launch = centre + (hashInteger(seed) - 0.5) * along;
  // they fall away counter-clockwise, down the left side, staying aligned with the limb
  const clock = launch - (upper ? 14 : 8 + 14 * hashInteger(seed + 5)) * flight;
  const speed = leads ? 1.6 + 0.7 * hashInteger(seed + 3) : 0.9 + 1.2 * hashInteger(seed + 3);
  const chipSize = size * (leads ? 1.05 : 0.5 + 0.35 * hashInteger(seed + 9));
  // they leave a little clear of the limb, as the film's do from the frame they appear
  appendChip(bodies, cores, clock, 1.04 + speed * age, seed, breakUp, chipSize);
}

/**
 * The latest burst's rim chips: 3-5 solid, soft-edged slabs breaking off the left limb about
 * mid-height and flying out and down toward 8 o'clock. One leads — a big slab up to 0.33R along
 * the limb, thrown hardest, as the film's f134-137 is — and the others are half its length or
 * less, spread over 50° of limb round it rather than stacked at the same clock. They stay fully
 * lit, as the film's do, for CHIP_HOLD_SECONDS; then each one thins, shortens and snaps in two
 * until it is gone by CHIP_GONE_SECONDS, rather than dimming (a dimming amber slab turns brown
 * on black). Where they leave from, and each chip's size and speed, come from the burst's
 * number, so a burst always looks the same.
 */
function drawChips(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const age = state.burstAge;
  const strength = state.burstStrength;
  if (age >= CHIP_GONE_SECONDS || strength <= 0) return;
  const count = state.burstCount;
  const bodies = resources.pathBuilders.chips;
  const cores = resources.pathBuilders.chipCores;
  // a small onset throws three small chips, a loud one five big ones
  const chips = 3 + Math.round(state.burstReach * 2);
  const size = 0.78 + 0.22 * state.burstReach;
  // one burst in three splits between the upper left and the left below mid-height
  const split = hashInteger(count * 53 + 1) < 0.33;
  const base = burstClock(count);
  const flight = age / CHIP_GONE_SECONDS;
  const breakUp = clamp01((age - CHIP_HOLD_SECONDS) / (CHIP_GONE_SECONDS - CHIP_HOLD_SECONDS));
  for (let chip = 0; chip < chips; chip++) {
    appendBurstChip(bodies, cores, count * 211 + chip * 17, chip, base, split, age, flight, breakUp, size);
  }
  const bodyPath = pathOf(resources.skia, bodies);
  const corePath = pathOf(resources.skia, cores);
  // a soft edge: a faint wide outline, then the solid slab, then its hot middle
  resources.chipGlowStroke.setStrokeWidth(0.028);
  resources.chipGlowStroke.setAlphaf(0.5);
  canvas.drawPath(bodyPath, resources.chipGlowStroke);
  resources.chipFill.setAlphaf(1);
  canvas.drawPath(bodyPath, resources.chipFill);
  resources.chipCoreFill.setAlphaf(0.45);
  canvas.drawPath(corePath, resources.chipCoreFill);
}

// ---- rare accents -------------------------------------------------------------------------

/** The jagged lightning filament, re-jagged every film frame, and the very rare two-frame red segment. */
function drawAccents(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const script = state.script;
  const alpha = state.rimAlpha;
  if (alpha <= 0) return;
  const builders = resources.pathBuilders;
  if (script.lineKind === 3) {
    const filmFrame = Math.floor(state.time * 24);
    const anchor = clockRadians(40 + 70 * hashInteger(script.lineSeed * 3));
    // it runs out toward the limb from inside and stops short of it, so it never reads as a protrusion
    const startX = Math.cos(anchor) * 0.42;
    const startY = Math.sin(anchor) * 0.42;
    const length = 0.35 + 0.3 * hashInteger(script.lineSeed * 5);
    pathMoveTo(builders.lightning, startX, startY);
    for (let joint = 1; joint <= 8; joint++) {
      const along = (joint / 8) * length;
      const jag = (hashInteger(filmFrame * 29 + joint) - 0.5) * 0.07;
      pathLineTo(
        builders.lightning,
        startX + Math.cos(anchor) * along - Math.sin(anchor) * jag,
        startY + Math.sin(anchor) * along + Math.cos(anchor) * jag,
      );
    }
    resources.lightningStroke.setStrokeWidth(0.008);
    resources.lightningStroke.setAlphaf(0.85 * alpha * script.lineEnvelope);
    canvas.drawPath(pathOf(resources.skia, builders.lightning), resources.lightningStroke);
  }
  if (script.redVisible) {
    const angle = clockRadians(360 * hashInteger(script.lineSeed * 7));
    pathMoveTo(builders.red, Math.cos(angle) * 0.9, Math.sin(angle) * 0.9);
    pathLineTo(builders.red, Math.cos(angle + 0.12) * 0.9, Math.sin(angle + 0.12) * 0.9);
    resources.redStroke.setStrokeWidth(0.016);
    resources.redStroke.setAlphaf(0.9 * alpha);
    canvas.drawPath(pathOf(resources.skia, builders.red), resources.redStroke);
  }
}

// ---- the materialisation ------------------------------------------------------------------

/**
 * The spoked dial that snaps on at keyframe 0.26: a thick C band from 12 o'clock round the left
 * to about 5 o'clock at 0.9-1.05R, in pieces of uneven length, running on into a smaller
 * foreshortened arc on the right that curls up, with about 30 spokes (often paired) to a hub at
 * (+0.4R, 0). It holds and brightens, loses its spokes by 0.64 and its right arc by 0.69, and
 * from 0.7 breaks up: each piece thins to its outer rail, then shortens from one end, drifts off
 * the band and slides along it, until the last ragged chips have gone by 0.9. It never dims, as
 * the film's stays solid and hot until it breaks (f65-f73).
 */
function appendDialBand(band: PathBuilder, inner: PathBuilder, breakUp: number) {
  'worklet';
  let from = 360;
  for (let piece = 0; piece < 26 && from > 158; piece++) {
    const hash = hashInteger(piece * 41 + 3);
    const when = hashInteger(piece * 97 + 11);
    const span = 5 + 14 * hash;
    // each piece breaks at its own moment, and none of them is the same length
    const remaining = 1 - clamp01((breakUp - when * 0.6) / 0.4);
    const length = (span - 0.15 - 0.35 * hash) * remaining;
    from -= span;
    if (length <= 0.8) continue;
    // it shortens from one end, slides along the band and drifts off it
    const slide = breakUp * (when - 0.5) * 9;
    const start = (when < 0.5 ? from + span - 0.2 : from + length + 0.2) + slide;
    const drift = 1 + breakUp * (1 - remaining) * (when < 0.35 ? -0.07 : 0.03 + 0.12 * hash);
    appendArc(band, 0, 0, 0.975 * drift, clockRadians(start), -length * DEGREES_TO_RADIANS);
    // the band thins to its outer rail before it breaks
    if (breakUp < 0.3 + 0.55 * hash) {
      appendArc(inner, 0, 0, 0.925 * drift, clockRadians(start), -length * DEGREES_TO_RADIANS);
    }
  }
}

/**
 * The spoked dial that snaps on at keyframe 0.26: the C band above, a smaller foreshortened arc
 * on the right that curls up, and 17 pairs of spokes of uneven length toward a hub at (+0.4R, 0).
 */
function appendDial(band: PathBuilder, inner: PathBuilder, spokes: PathBuilder, intro: number, time: number) {
  'worklet';
  const filmFrame = Math.floor(time * 12);
  appendDialBand(band, inner, smooth01((intro - 0.66) / 0.18));
  // the smaller foreshortened arc on the right, curling up to (+0.9R, -0.55R)
  const arcShare = 1 - smooth01((intro - 0.49) / 0.2);
  if (arcShare > 0.05) {
    for (let step = 0; step < 14 * arcShare; step++) {
      const angleFrom = (100 - step * 10.5) * DEGREES_TO_RADIANS;
      const angleTo = (100 - (step + 1) * 10.5) * DEGREES_TO_RADIANS;
      pathMoveTo(band, 0.45 + Math.cos(angleFrom) * 0.55, 0.05 + Math.sin(angleFrom) * 0.92);
      pathLineTo(band, 0.45 + Math.cos(angleTo) * 0.55, 0.05 + Math.sin(angleTo) * 0.92);
    }
  }
  const spokeShare = 1 - smooth01((intro - 0.5) / 0.14);
  // Pairs about 11° apart along the band, not an even fan: the film's are "often paired", of
  // uneven length with many stopping well short of the hub, and they pop in and out while the
  // dial holds. Their hub is at (+0.4R, 0), off to the right of the sphere's centre.
  for (let spoke = 0; spoke < 34 && spokeShare > 0; spoke++) {
    if (hashInteger(filmFrame * 977 + spoke * 31) > 0.78 * spokeShare) continue;
    const pair = Math.floor(spoke / 2);
    const clock = 355 - pair * 11.4 - (spoke % 2) * 1.7;
    const angle = clockRadians(clock);
    const start = 0.9 + 0.055 * hashInteger(spoke * 7 + 3);
    const startX = Math.cos(angle) * start;
    const startY = Math.sin(angle) * start;
    // a third of them run the whole way in; the rest stop between half way and the hub
    const reach = hashInteger(spoke * 19 + 11) < 0.34 ? 1 : 0.42 + 0.46 * hashInteger(spoke * 23 + 5);
    pathMoveTo(spokes, startX, startY);
    pathLineTo(spokes, startX + (0.4 - startX) * reach, startY - startY * reach);
  }
}

/** Everything that only exists while the hologram materialises (keyframe time below 1). */
function drawIntro(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const intro = state.intro;
  if (intro >= 1) return;
  // The spoked dial, and nothing else.
  //
  // The film's materialisation opens on a point of light, throws sparks, assembles a band out
  // of flying pieces and sweeps a tilted equatorial ring round the ball before it is done. All
  // of that is gone at the user's request: on a phone it was a lot of ceremony to sit through
  // every time Jarvis is summoned, and the one part worth keeping is this — the disc of spokes
  // that swirls while the sphere arrives behind it.
  const dialAlpha = smooth01(intro / 0.12) * (1 - smooth01((intro - 0.72) / 0.28));
  if (dialAlpha <= 0) return;
  const builders = resources.pathBuilders;
  appendDial(builders.introBand, builders.introInner, builders.introSpokes, intro, state.time);
  const brighten = 0.65 + 0.35 * smooth01(intro / 0.3);
  const dialPath = pathOf(resources.skia, builders.introBand);
  const dialInnerPath = pathOf(resources.skia, builders.introInner);
  resources.introGlowStroke.setStrokeWidth(0.13);
  resources.introGlowStroke.setAlphaf(0.2 * dialAlpha * brighten);
  canvas.drawPath(dialPath, resources.introGlowStroke);
  canvas.drawPath(dialInnerPath, resources.introGlowStroke);
  resources.introBandStroke.setStrokeWidth(0.05);
  resources.introBandStroke.setAlphaf(0.75 * dialAlpha * brighten);
  canvas.drawPath(dialPath, resources.introBandStroke);
  canvas.drawPath(dialInnerPath, resources.introBandStroke);
  resources.introBandCoreStroke.setStrokeWidth(0.02);
  resources.introBandCoreStroke.setAlphaf(0.8 * dialAlpha * brighten);
  canvas.drawPath(dialPath, resources.introBandCoreStroke);
  canvas.drawPath(dialInnerPath, resources.introBandCoreStroke);
  resources.introSpokeStroke.setStrokeWidth(0.007);
  resources.introSpokeStroke.setAlphaf(0.75 * dialAlpha);
  canvas.drawPath(pathOf(resources.skia, builders.introSpokes), resources.introSpokeStroke);
}

/** Draws one frame of the hologram into a size×size square. */
/**
 * The ring that blooms out of the core as a pass finishes: one step of the thought, done.
 *
 * Reuses the thin ring's paint, drawn at a growing radius and fading as it goes, so it leaves the
 * sphere rather than sitting on it. Nothing at all when he is not thinking, which is most of the
 * time — the whole function is two comparisons then.
 */
function drawThinkingPulse(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const strength = state.thinking * state.pulse;
  if (strength <= 0) return;
  const paint = resources.thinRingStroke;
  paint.setAlphaf(state.thinking * (1 - state.pulse) * 0.9);
  canvas.drawCircle(0, 0, 0.15 + 1.05 * state.pulse, paint);
}

/**
 * The shadow the sphere sits on: black under Jarvis, gone by the edge of his square.
 *
 * First thing inside the arrival layer, so everything else is drawn over it and it fades in with
 * the rest of him. It does not take `glowGain`: it is the dark he is seen against, and brightening
 * the dark with his voice would work against the glow rather than with it.
 *
 * `state.backdropReach` is half the square measured in sphere radii, so this circle is the
 * square's inscribed circle however big the voice has made the sphere. See the note on
 * {@link BACKDROP_RAMP} for why it must end at zero exactly there.
 */
function drawBackdrop(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  // Drawn in the texture's own space, so its middle lands on the sphere's: the same trick the
  // warm volume used before it was removed.
  const half = BACKDROP_TEXELS / 2;
  const reach = state.backdropReach;
  canvas.save();
  canvas.translate(-reach, -reach);
  canvas.scale(reach / half, reach / half);
  canvas.drawCircle(half, half, half, resources.backdropFill);
  canvas.restore();
}

export function drawHologram(
  canvas: HologramCanvas,
  size: number,
  frame: HologramFrame,
  scene: Scene,
  resources: Resources,
) {
  'worklet';
  // start clean: a previous frame that threw mid-way must not leak half-built contours
  const allPathBuilders = resources.allPathBuilders;
  for (let i = 0; i < allPathBuilders.length; i++) pathReset(allPathBuilders[i]);

  const state = analyseFrame(frame, size, scene);
  canvas.save();
  canvas.translate(size / 2, size / 2);
  canvas.scale(state.radius, state.radius);
  // While it arrives, the whole sphere is drawn into a layer and that layer is faded in — one
  // alpha over everything, rather than every layer carrying its own ramp. The dial below is
  // outside it and stays at full strength, since it is what the sphere fades in behind. The
  // layer costs an offscreen buffer for the few seconds this lasts and nothing afterwards.
  const arriving = state.arrival < 1;
  if (arriving) {
    resources.arrivalFade.setAlphaf(state.arrival);
    canvas.saveLayer(resources.arrivalFade);
  }
  drawBackdrop(canvas, resources, state);
  drawInnerShells(canvas, resources, state);
  drawBody(canvas, resources, scene, state);
  drawLines(canvas, resources, scene, state);
  drawCore(canvas, resources, state);
  drawBodyHighlights(canvas, resources, state);
  drawThinRing(canvas, resources, state);
  drawTruss(canvas, resources, scene, state);
  drawCrescent(canvas, resources, scene, state);
  drawFray(canvas, resources, scene, state);
  drawChips(canvas, resources, state);
  drawAccents(canvas, resources, state);
  drawThinkingPulse(canvas, resources, state);
  if (arriving) canvas.restore();
  drawIntro(canvas, resources, state);
  canvas.restore();
}
