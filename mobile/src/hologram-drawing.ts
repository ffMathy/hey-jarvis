// The J.A.R.V.I.S. hologram: the golden sphere of light that stands in for Tony
// Stark's AI in the Avengers: Age of Ultron lab scene, drawn every frame with React
// Native Skia's imperative canvas API from a Reanimated worklet.
//
// WHAT IT DEPICTS
// The film's J.A.R.V.I.S.: a round, glowing, translucent amber ball, brightest at its core
// and never dark inside — a see-through cloud of small lights rather than a painted surface,
// the warm volume behind them only a haze — textured with short bright "circuit" strokes,
// bounded by one dominant rim element at a time (a bright crescent on the left limb, a
// segmented ladder ring, or a thin ring), with at most two large, slow protrusions and a
// small hooked ring at the core. Everything is warm orange to amber: no blue, no white, no
// halo past 1.1R. Measurements and requirements come from the film study
// (jarvis-reference.md), cited below by section.
//
// LAYERS, drawn back to front (unit space, R = 1, y down; clock angles in degrees
// clockwise from 12 o'clock)
//   drawVolumeFill      the warm volume (P0.1): one circle with a prebuilt texture — level
//                       from 0.35R out to the limb, heavier on the upper left, broken into
//                       sideways-stretched clouds with deep red-brown pockets between them
//                       (the pockets fall to about half the median), brightest where the fragment
//                       body crowds, see-through toward the lower-right limb and ragged at its
//                       edge. Drawn at FILL_STRENGTH of what the texture holds, so on its own it
//                       carries half of the disc median light it used to and the particles in
//                       front of it now carry more than it does. While the ball forms it
//                       arrives as a thickening haze with brighter ragged patches where the
//                       fragments have already landed
//   drawInnerShells     the whorl: two wide spiral arms winding out of the core to 0.76R,
//                       furry with short fragments across them, plus the long loop rising 37°
//                       past the core, the saturated ")" arc at 0.57R and the faint near half of
//                       the edge-on ellipse — all of it turning the other way; and data streaks
//   drawBody            the fragment body's dim and mid strokes: 1680 fragments inside 0.94R
//                       (four in five plain dashes, the rest L, bracket, T, Z glyphs, rings and
//                       cell outlines mostly near the core; median 0.036R, clumped into the mass
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
//                       amber); 220 specks, warm and blinking peach, each a small light with
//                       a halo round it
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
//   drawProtrusions     the script's protrusions: two truss booms — box frames standing off the
//                       limb in depth, a near face of rails, rungs and diagonal braces, a
//                       foreshortened, dimmer far face behind and above it, the depth edges that
//                       tie them together and one filled side panel — the long one out of the
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
//   present, handing over within 1.2 s — which protrusion is out, whether spokes, a swoosh
//   or a lightning filament show, how dense the fragments are (0.9-1.02), and when the
//   red segment flashes. A protrusion grows over 0.5-1.5 s (eased out), holds 1-3 s and
//   dissolves in 0.5 s: its solid body goes first, leaving a hollow outline whose rails
//   bead, shrink to dots and fall away as sparks. The two tracks never put more than two
//   protrusions out at once.
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
//                 the nearer the limb it is — the silhouette must not move with his voice — and
//                 the specks hand over to a second, fixed, faster clock the same way, so that
//                 layer twinkles more than twice as fast without any speck's phase moving
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
//               across the future top, a trail down the right, specks), each for 0.4;
//               band pieces from 0.19; the spoked dial snaps on at 0.26 within 0.03, in pieces of
//               uneven length, brightens to 0.49, loses its spokes by 0.64 and its right arc by
//               0.69, and stays solid and hot until it breaks up over 0.7-0.9, each piece thinning
//               to its outer rail, shortening from one end and drifting off the band; the tilted
//               equatorial ring of rails and fine ticks (front and right side only) sweeps in over
//               0.62-0.77 and drops out piece by piece over 0.84-0.96. The fragments arrive in
//               patches, behind the band on the left first (revealKey), over 0.45-0.69, and the
//               fill follows them patch by patch over 0.55-0.81; both run hot over 0.55-1, with
//               a ragged left limb until 0.78-1; inner shells from 0.62, the core from 0.72,
//               the rim layer from 0.84, protrusions at 0.95-1, and agitation and chips only
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
}

/**
 * The part of Skia the hologram draws with, and no more.
 *
 * Narrow on purpose. The app passes Skia from the package root; the headless test
 * passes the same API built over CanvasKit from the package's `lib/module` build,
 * whose declarations TypeScript treats as a separate copy. The members used here
 * are identical in both, so asking only for those lets both pass without a cast.
 */
export type HologramSkia = Pick<
  typeof Skia,
  'Color' | 'Data' | 'Image' | 'Matrix' | 'Paint' | 'PathBuilder' | 'Shader'
>;

/** The canvas calls the hologram makes, for the same reason. */
export type HologramCanvas = Pick<
  SkCanvas,
  'drawCircle' | 'drawPath' | 'restore' | 'rotate' | 'save' | 'scale' | 'translate'
>;

type SkiaApiType = HologramSkia;

// ---- constants (unit space: the sphere's radius R is 1, y points down) ---------------------
// Clock angles are degrees clockwise from 12 o'clock, as the film study measures them.

/**
 * How long the view takes to count appearance from 0 to 1. The film's keyframes
 * reach a formed ball at 2.7 s (see FORMED_APPEARANCE); the last 0.9 s grows the
 * bright left crescent back in, as the film's does once the ball has formed.
 */
export const MATERIALISE_SECONDS = 3.6;
/** The appearance at which the film's materialisation keyframes reach "formed": 2.7 s of 3.6. */
const FORMED_APPEARANCE = 0.75;

/** Sphere radius as a fraction of the square: leaves room for chips thrown to 1.5R and protrusions to 1.45R. */
const SPHERE_FRACTION = 0.31;
/** The outer rim layer rolls clockwise in the screen plane: one turn in about 33 s, as the film's ladder ring. */
const ROLL_DEGREES_PER_SECOND = 11;
/**
 * The inner layer turns the other way (shot d: -1.6 to -5.4°/s): the whorl, the loop, and half
 * of the shell's fragments between 0.3R and 0.62R — the band the whorl itself turns in, and the
 * only band the rim-roll check lets drift.
 */
const SHELL_DEGREES_PER_SECOND = -5;
/** The lower hemisphere's equatorial shell turns about the vertical axis, which reads as a sideways stream. */
const STREAM_RADIANS_PER_SECOND = 0.21;
const DEGREES_TO_RADIANS = 0.017453292519943295;
/** The core sits a hair up and left of centre, well inside the film's 0.08R. */
const CORE_X = -0.02;
const CORE_Y = -0.02;
/** How long a burst's chips stay fully lit, in seconds, and when the last of them has broken up and gone. */
const CHIP_HOLD_SECONDS = 0.13;
const CHIP_GONE_SECONDS = 0.2;

// Strides of the flat scene tables (the builders describe the fields).
const BODY_STRIDE = 9;
const STREAM_STRIDE = 11;
const SPECK_STRIDE = 5;
const CRESCENT_PIECE_STRIDE = 3;
const CRESCENT_PIECES_PER_STRAND = 14;
const TRUSS_PIECE_STRIDE = 6;
const FRAY_STRIDE = 5;
const STREAK_ARC_STRIDE = 6;
const LIMB_STREAK_STRIDE = 5;
const RING_TICK_STRIDE = 2;
const EPOCH_STRIDE = 10;
const SECOND_TRACK_STRIDE = 5;
const COMET_STRIDE = 5;
const INTRO_SPARK_STRIDE = 5;
/** How many points a fill patch's outline is drawn through; see buildFillBlobs. */
const FILL_PATCH_POINTS = 16;
const FILL_BLOB_STRIDE = 3 + FILL_PATCH_POINTS * 2;
/**
 * How much of the arriving glow is the wash that lies over the whole ball rather than the
 * patches around the fragments. The film's glow comes in as a diffuse haze with brighter
 * places in it (a f58-f70), so the patches must ride on something, not sit on black.
 */
const FILL_WASH_SHARE = 0.6;

/**
 * Side of the prebuilt fill texture in texels. It spans the sphere's 2R, so a texel is about
 * 0.016R: the clouds are soft and linear filtering hides the texels, and at this size the
 * texture builds in a few tens of milliseconds even on an interpreter without a JIT (the phone's
 * Hermes), where 256 texels a side froze the JS thread for about 0.3 s at every mount.
 */
const FILL_TEXTURE_TEXELS = 128;
/**
 * How many texels the fill texture fades to nothing over at its square border, so that a shader
 * clamping past the edge repeats transparency rather than the last lit texel. Three, because two
 * left a step of about a third of a luma level at the limb where the circle runs past the square.
 */
const FILL_TEXTURE_BORDER_TEXELS = 3;
/** Side of the tiled sparkle texture in texels, and how wide a texel is on the sphere: a stroke spans about two. */
const SPARKLE_TEXTURE_TEXELS = 64;
const SPARKLE_TEXEL_SIZE = 0.018;
/** How far the fill's clouds swing its brightness: pockets fall to about half the median, clouds rise past 1.5×. */
const FILL_CONTRAST = 4.6;

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
const LIMB_BLOOM_RADIUS = 0.995;
const LIMB_BLOOM_BAND = 0.25;
const LIMB_RIDGE_RADIUS = 0.955;
const LIMB_RIDGE_BAND = 0.17;

/**
 * How much of the fill texture's own light the formed ball keeps.
 *
 * The texture is pinned and never changes, so every luma level in it is light that cannot
 * churn; screened underneath, it also flattens what the strokes over it can add. At full
 * strength it carried about four fifths of the disc's median light (78 of 99 at 256 px) and
 * the ball read as a solid painted surface rather than a see-through cloud. At this share it
 * carries half of that (38 of the 78 luma it used to hold, rendered on its own at 256 px) —
 * still plainly present, still amber, never black — and the particle field over it now carries
 * more light than it does, so most of what you see is light that goes out and comes back
 * rather than light that is simply always on.
 *
 * It is not lower than this because the wash is also the only thing lighting the places where
 * no fragment lands, and it is what keeps those from going black: at 0.45 the darkest twentieth
 * of the disc sits at luma 39, and every tenth off this value costs about four of that. Half
 * a fifth higher and the wash would be back over the half of its old light that the brief
 * allows it.
 *
 * THIS IS DELIBERATELY PAST THE FILM GUIDE'S DARK-SHARE LINE, and a later round should not read
 * that as a regression. The guide (section 6.4) wants under 5% of the disc inside 0.8R below
 * luma 40, and asks for it of a sphere whose warm volume is opaque; a see-through one cannot
 * hold that and be see-through. This drawing measures 5.3% at 256 px and 4.3-6.8% at 384 px
 * across silent moments, against 0.6-1.3% when the wash was at full strength. Nothing inside
 * the disc is anywhere near black — the first percentile sits at luma 25 and nothing at all
 * falls under 8 — and the particle halos, not the wash, are the dial that moves this now.
 */
const FILL_STRENGTH = 0.45;

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
/**
 * The specks' two clocks. Agitation moves the share of them on the fast clock, never a rate:
 * a rate that moved would multiply `time` as well, so every change in agitation would shift
 * every speck's blink phase at once — noise across the whole layer at each word boundary,
 * growing with how long the sphere has been mounted. At full agitation four specks in five
 * are on the fast clock, so the layer twinkles well over twice as fast on average, and a
 * handover still costs one dot at a time.
 */
const SPECK_FAST_RATE = 2.8;
const SPECK_FAST_SHARE = 0.8;
/** The materialisation's equatorial ring: its major axis rises 28° to the right. */
const EQUATOR_TILT_COS = 0.882947592858927;
const EQUATOR_TILT_SIN = -0.4694715627858908;
// The truss booms (protrusion kinds 1 and 5): a box frame standing off the limb in depth.
/** Where a boom leaves the ball, in R. Inside the limb, so it grows out of the body rather than off it. */
const TRUSS_BOOM_ROOT = 0.84;
/** How many bays it is built of: rungs at the boundaries, one diagonal brace across each. */
const TRUSS_BOOM_BAYS = 4;
/** How much narrower the frame is at the tip than at the root: the foreshortening of its length. */
const TRUSS_BOOM_TAPER = 0.42;
/** How far behind the near face the far one sits at the root, as a share of the boom's half-width. */
const TRUSS_BOOM_DEPTH = 1.15;
/** How far a boom must have grown before it is at its full section, in R. */
const TRUSS_BOOM_OPENING = 0.18;
/** How much smaller the far face is drawn than the near one, being that much further from the eye. */
const TRUSS_BOOM_FAR_SCALE = 0.72;

/** The rim element that dominates takes this long to hand over to the next. */
const HANDOVER_SECONDS = 1.2;
/** How long a protrusion takes to dissolve: hollow outline, beaded rails, dots, sparks, gone. */
const DISSOLVE_SECONDS = 0.5;

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

/** A fragment's length: median 0.036R, 90th percentile 0.077R, and a few long streaks up to 0.32R. */
function pickFragmentLength(random: Random) {
  if (random() < 0.03) return 0.14 + random() * 0.18;
  return 0.015 + 0.075 * random() ** 1.8;
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
 * How often a fragment's clock cycles. Calm fragments (pool 0) stay lit 0.18-0.4 s — the
 * shorter half of the film's measured 0.2-0.6 s, which with {@link FRAGMENT_DUTY} renews
 * about a tenth of the body per film frame, as the film study measures; agitated ones
 * (pool 1) a third of it, so swapping calm for agitated fragments nearly doubles the churn.
 * A third and not a half, because the whole point of the fast pool is to be seen changing:
 * the film's frames are 1/24 s apart, and a fragment that goes out and comes back inside one
 * of those has changed nothing that anybody can see.
 *
 * The longer lit times it had before renewed only about a twentieth per frame, which is
 * half the film's turnover and is most of why the idle ball read as a still picture.
 */
function pickFragmentRate(random: Random, pool: number) {
  const litSeconds = pool === 0 ? 0.18 + random() * 0.22 : 0.06 + random() * 0.08;
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
  const fragmentCount = 1680;
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
  for (let i = 0; i < 336; i++) {
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
 * Specks: warm points that wink on and off slowly (1-2.8 Hz), and pale peach ones that
 * blink faster. Twice as many as before, each with a glow of its own, so the layer is a
 * field of small lights rather than a sprinkling over a lit ball.
 * Stride 5: x, y, rate, phase, kind (0 warm, 1 peach).
 */
function buildSpecks(random: Random) {
  const specks: number[] = [];
  while (specks.length < 220 * SPECK_STRIDE) {
    const radius = Math.sqrt(random()) * 1.02;
    const angle = random() * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (random() > massWeight(x, y)) continue;
    const peach = random() < 0.2;
    specks.push(x, y, peach ? 3.4 + random() * 2.4 : 1 + random() * 1.8, random(), peach ? 1 : 0);
  }
  return specks;
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
 * element and bringing out at most one protrusion. Stride 10: start, duration,
 * dominant (0 crescent, 1 truss, 2 thin ring), protrusion type, protrusion start
 * (seconds into the epoch), grow seconds, hold seconds, line kind (0 none, 1 radial
 * spokes, 2 swoosh fan, 3 lightning filament), fragment density, red flash time
 * (seconds into the epoch, or -1).
 */
function buildScript(random: Random) {
  const epochs: number[] = [];
  const dominants = [0, 1, 0, 2, 1, 0, 1, 2, 0, 1, 2, 1];
  // protrusions: 0 none, 1 the long truss boom off the equator, 2 ribbon loop, 3 hook tendril,
  // 4 streak bundle, 5 the short truss boom at the upper left, 6 pole fan;
  // the first epoch shows the formed ball plain, as the film does once it has formed
  const protrusions = [0, 1, 3, 0, 2, 4, 0, 1, 5, 3, 6, 2];
  const lineKinds = [0, 0, 1, 0, 2, 0, 3, 1, 0, 2, 3, 0];
  let start = 0;
  dominants.forEach((dominant, index) => {
    const duration = index === 0 ? 7 : 3 + random() * 5;
    const protrusion = protrusions[index];
    const grow = 0.5 + random();
    const dissolveStart = Math.max(0.3, duration - 0.3 - DISSOLVE_SECONDS);
    const hold = Math.min(1 + random() * 2, Math.max(0.6, dissolveStart - grow - 0.3));
    const protrusionStart = 0.3 + random() * Math.max(0, dissolveStart - grow - hold - 0.3);
    epochs.push(
      start,
      duration,
      dominant,
      protrusion,
      protrusionStart,
      grow,
      hold,
      lineKinds[index],
      0.9 + random() * 0.12,
      index === 4 || index === 9 ? 0.5 + random() * (duration - 1) : -1,
    );
    start += duration;
  });
  return { epochs, period: start };
}

/**
 * A second, sparser protrusion track on its own period, so a second protrusion is
 * occasionally out beside the first — never more than two. Stride 5: start, type
 * (4 bundle, 5 the short truss boom, 6 pole fan), grow, hold, a 0..1 hash.
 */
function buildSecondTrack(random: Random) {
  const events: number[] = [];
  let start = 9 + random() * 4;
  const period = 41;
  while (start < 38) {
    const type = 4 + Math.floor(random() * 3);
    const grow = 0.6 + random() * 0.8;
    // an event near the end of the period is held for less, so it has gone before the loop wraps
    const hold = Math.min(1 + random() * 1.5, period - 0.2 - start - grow - DISSOLVE_SECONDS);
    events.push(start, type, grow, hold, random());
    start += 11 + random() * 6;
  }
  return { events, period };
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

/**
 * The patches the warm fill arrives in while the ball materialises: blobs whose union covers the
 * disc, each appearing when the fragments around it do (see revealKey), so the glow follows the
 * fragments rather than fading in as a disc with an edge of its own (film f47-f70).
 *
 * Each patch's outline is stored as points rather than as a radius, because a circle is the one
 * shape the film never shows: its glow arrives as a wash with a ragged boundary, never as flat
 * round discs. Every outline is a wobbled ring — three harmonics of a couple of tenths of its
 * radius — so the union's edge is broken at the scale of the patches and again within each one.
 * Storing the points also keeps trigonometry out of the frame: the drawing only scales them.
 * Stride: x, y, the reveal key it waits for, then FILL_PATCH_POINTS pairs of point offsets.
 */
function buildFillBlobs(random: Random) {
  const blobs: number[] = [];
  const rings = [
    [1, 0, 0.44],
    [7, 0.42, 0.33],
    [13, 0.73, 0.3],
    [11, 0.96, 0.24],
  ];
  for (const [count, ring, size] of rings) {
    for (let index = 0; index < count; index++) {
      const angle = ((index + 0.45 * random()) / count) * Math.PI * 2;
      const x = Math.cos(angle) * ring * (0.92 + 0.16 * random());
      const y = Math.sin(angle) * ring * (0.92 + 0.16 * random());
      // The glow follows the fragments a little behind them, along a straighter front than
      // theirs: a patch that lit on its own, away from the swarm, would read as a lit shape
      // rather than as the glow of the fragments under it.
      blobs.push(x, y, clamp01(0.74 * revealKey(x, y) + 0.26 * (0.5 + 0.5 * x) + 0.04));
      const radius = size * (0.86 + 0.28 * random());
      const phases = [random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2];
      for (let point = 0; point < FILL_PATCH_POINTS; point++) {
        const around = (point / FILL_PATCH_POINTS) * Math.PI * 2;
        const wobble =
          1 +
          0.26 * Math.sin(2 * around + phases[0]) +
          0.17 * Math.sin(3 * around + phases[1]) +
          0.11 * Math.sin(5 * around + phases[2]) +
          0.07 * Math.sin(7 * around + phases[0] + phases[1]);
        blobs.push(Math.cos(around) * radius * wobble, Math.sin(around) * radius * wobble);
      }
    }
  }
  return blobs;
}

/** Keeps the worklet copy of the scene small. */
function roundToFiveDecimals(value: number) {
  return Math.round(value * 1e5) / 1e5;
}

/** Builds the hologram's random geometry once. Deterministic for a given seed; plain data only. */
export function createHologramScene(seed: number) {
  const random = createRandom(seed);
  const script = buildScript(random);
  const secondTrack = buildSecondTrack(random);
  return {
    body: buildBody(random).map(roundToFiveDecimals),
    stream: buildStream(random).map(roundToFiveDecimals),
    specks: buildSpecks(random).map(roundToFiveDecimals),
    crescentPieces: buildCrescentPieces(random).map(roundToFiveDecimals),
    truss: buildTruss(random).map(roundToFiveDecimals),
    fray: buildFray(random).map(roundToFiveDecimals),
    streakArcs: buildStreakArcs(random).map(roundToFiveDecimals),
    limbStreaks: buildLimbStreaks(random).map(roundToFiveDecimals),
    ringTicks: buildRingTicks(random).map(roundToFiveDecimals),
    epochs: script.epochs.map(roundToFiveDecimals),
    scriptPeriod: roundToFiveDecimals(script.period),
    secondTrack: secondTrack.events.map(roundToFiveDecimals),
    secondTrackPeriod: secondTrack.period,
    comets: buildComets(random).map(roundToFiveDecimals),
    introSparks: buildIntroSparks(random).map(roundToFiveDecimals),
    fillBlobs: buildFillBlobs(random).map(roundToFiveDecimals),
    // only a seed: the static textures are built straight into paths, never copied to the worklet runtime
    textureSeed: Math.floor(random() * 4294967296),
  };
}

type Scene = ReturnType<typeof createHologramScene>;

// ---- resources: Skia objects built once per mounted canvas --------------------------------

type PathBuilder = ReturnType<SkiaApiType['PathBuilder']['Make']>;

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
  builder.moveTo(centreX + Math.cos(startAngle) * radius, centreY + Math.sin(startAngle) * radius);
  for (let piece = 0; piece < pieces; piece++) {
    const pieceStart = startAngle + step * piece;
    builder.conicTo(
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
    if (step === 0) builder.moveTo(pointX, pointY);
    else builder.lineTo(pointX, pointY);
  }
}

/**
 * Adds one octave of value noise, `across` cells wide and `down` cells tall over the whole
 * texture, into `field` at `weight`. The lattice is interpolated along its rows first and then
 * down the texture: the same smooth noise as sampling it texel by texel, for a fraction of the work.
 */
function addNoiseOctave(field: Float32Array, random: Random, across: number, down: number, weight: number) {
  const texels = FILL_TEXTURE_TEXELS;
  const width = across + 1;
  const lattice = new Float32Array(width * (down + 1));
  for (let index = 0; index < lattice.length; index++) lattice[index] = random();
  const rows = new Float32Array((down + 1) * texels);
  for (let column = 0; column < texels; column++) {
    const x = ((column + 0.5) / texels) * across;
    const cell = Math.min(across - 1, Math.floor(x));
    const share = x - cell;
    const blend = share * share * (3 - 2 * share);
    for (let latticeRow = 0; latticeRow <= down; latticeRow++) {
      const left = lattice[latticeRow * width + cell];
      rows[latticeRow * texels + column] = left + (lattice[latticeRow * width + cell + 1] - left) * blend;
    }
  }
  for (let row = 0; row < texels; row++) {
    const y = ((row + 0.5) / texels) * down;
    const cell = Math.min(down - 1, Math.floor(y));
    const share = y - cell;
    const blend = share * share * (3 - 2 * share) * weight;
    const upper = cell * texels;
    const lower = upper + texels;
    const offset = row * texels;
    for (let column = 0; column < texels; column++) {
      const top = rows[upper + column];
      field[offset + column] += top * weight + (rows[lower + column] - top) * blend;
    }
  }
}

/**
 * The fill's brightness on black (luma, 0-255) before its clouds: hot at the core, level from
 * about 0.35R, and at the limb as bright as the body inside it where the mass is (`limbMass` 1,
 * section 2.2: the 0.8-0.92R band is as bright as 0.6-0.8R or brighter) but thinning to a
 * see-through edge where it is not (film a: 84 at 0.92-1.02R away from the crescent).
 */
function fillProfile(radius: number, limbMass: number) {
  if (radius <= 0.7) {
    const stops = [0, 112, 0.12, 99, 0.3, 84, 0.5, 78, 0.7, 77];
    let index = 2;
    while (radius > stops[index]) index += 2;
    const share = (radius - stops[index - 2]) / (stops[index] - stops[index - 2]);
    return stops[index - 1] + (stops[index + 1] - stops[index - 1]) * share;
  }
  const share = Math.min(1, (radius - 0.7) / 0.2);
  return 77 + (55 + 70 * limbMass - 77) * share * share * (3 - 2 * share);
}

/**
 * The fill's colour at each brightness 0-255: deep red-brown in the pockets, amber through the
 * middle, gold only at the hottest (the film's #562a10 pockets, #a35e26 body, #f0aa52 core), kept
 * orange enough that strokes screened over it do not push it toward yellow. Three bytes a level,
 * so a texel looks its colour up rather than interpolating it.
 */
function buildFillColourTable() {
  // luma, red, green, blue
  const stops = [
    0, 0, 0, 0, 23.5, 44, 19, 7, 49.5, 86, 40, 15, 75, 126, 60, 22, 102, 164, 80, 30, 130, 200, 100, 40, 162, 238, 124,
    50, 192, 255, 150, 64, 205, 255, 158, 68,
  ];
  const table = new Uint8Array(256 * 3);
  let stop = 4;
  for (let level = 0; level < 256; level++) {
    while (stop < stops.length - 4 && level > stops[stop]) stop += 4;
    const share = Math.min(1, Math.max(0, (level - stops[stop - 4]) / (stops[stop] - stops[stop - 4])));
    for (let channel = 0; channel < 3; channel++) {
      const low = stops[stop - 3 + channel];
      table[level * 3 + channel] = Math.round(low + (stops[stop + 1 + channel] - low) * share);
    }
  }
  return table;
}

/**
 * The warm translucent volume as a texture, built once from the seed: the radial profile,
 * weighted toward the upper left, broken into clouds — broad blotches, streaky mid-size clouds
 * and fine wisps, stretched sideways as the film's are — with deep pockets between them, and
 * brightest where the fragment body crowds. Premultiplied RGBA, row by row, over the square
 * [-1, 1]². Its edge is ragged: where the broad clouds thin, the glow stops short of the limb.
 */
function buildFillTexture(random: Random) {
  const texels = FILL_TEXTURE_TEXELS;
  const count = texels * texels;
  const broad = new Float32Array(count);
  addNoiseOctave(broad, random, 4, 5, 0.46);
  addNoiseOctave(broad, random, 9, 14, 0.54);
  const wisps = new Float32Array(count);
  addNoiseOctave(wisps, random, 18, 28, 0.65);
  addNoiseOctave(wisps, random, 36, 56, 0.35);
  // The edge is ragged on the broadest scale only — sweeps of about 60° of limb, not fine teeth:
  // pinned detail as fine as the rim layer's rungs would hide them as they roll past.
  const edgeField = new Float32Array(count);
  addNoiseOctave(edgeField, random, 3, 4, 1);
  const colours = buildFillColourTable();
  const pixels = new Uint8Array(count * 4);
  for (let row = 0; row < texels; row++) {
    const y = ((row + 0.5) / texels) * 2 - 1;
    // The texture fades to nothing over its outermost texels, so the shader can clamp rather
    // than decal: the circle the fill is drawn on reaches a little past the texture's square,
    // and clamping a transparent border out to it gives what decal gives, for a sixth less of
    // the frame — decal costs a bounds test at every sample, and this is the one layer that
    // shades the whole disc. The fade only touches a sliver of the ragged edge that the square
    // was cutting off at the axes anyway, and it is a fade rather than a cut so that sliver
    // does not end in a step.
    const rowBorder = Math.min(1, Math.min(row, texels - 1 - row) / FILL_TEXTURE_BORDER_TEXELS);
    for (let column = 0; column < texels; column++) {
      const border = Math.min(rowBorder, Math.min(column, texels - 1 - column) / FILL_TEXTURE_BORDER_TEXELS);
      if (border <= 0) continue;
      const x = ((column + 0.5) / texels) * 2 - 1;
      const radius = Math.sqrt(x * x + y * y);
      if (radius >= 1.06) continue;
      const texel = row * texels + column;
      // the ragged edge: the glow reaches 0.9R in one sweep of the limb and 1.02R in the next
      const edgeShare = Math.min(1, Math.max(0, (radius - 0.93 - 0.16 * (edgeField[texel] - 0.5)) / 0.1));
      const edge = (1 - edgeShare * edgeShare * (3 - 2 * edgeShare)) * border;
      if (edge <= 0) continue;
      // Fine wisps give way to the broad clouds toward the limb: light pinned there must not carry
      // detail as fine as the rim layer's rungs, or it hides them as they roll past.
      const wispShare = 0.38 * (1 - Math.min(1, Math.max(0, (radius - 0.72) / 0.2)));
      const noise = (1 - wispShare) * broad[texel] + wispShare * wisps[texel];
      // the fill is brightest where the body crowds, but its troughs are shallower than the
      // body's: bare fill is what shows between the clumps of strokes
      const field = 0.62 * noise + 0.38 * (0.3 + 0.4 * (0.35 + 0.65 * clusterWeight(x, y)));
      // the pockets open out from the core, which glows evenly
      const contrast = FILL_CONTRAST * Math.min(1, Math.max(0, (radius - 0.06) / 0.3));
      // how far along the diagonal from the heavy upper left (0) to the thin lower right (1)
      const diagonal = Math.min(1, Math.max(0, (x + y) / 2.6 + 0.5));
      const lean = Math.min(1, Math.max(0, (x + y) / (2 * Math.max(radius, 0.01)) + 0.45));
      const limbMass = 1 - 0.62 * lean * lean * (3 - 2 * lean);
      const intensity = fillProfile(radius, limbMass) * (1.08 - 0.3 * diagonal) * Math.exp(contrast * (field - 0.5));
      const level = Math.min(255, Math.round(intensity)) * 3;
      const offset = texel * 4;
      pixels[offset] = Math.round(colours[level] * edge);
      pixels[offset + 1] = Math.round(colours[level + 1] * edge);
      pixels[offset + 2] = Math.round(colours[level + 2] * edge);
      pixels[offset + 3] = Math.round(255 * edge);
    }
  }
  return pixels;
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
    if (arm === previousArm) arm.lineTo(x, y);
    else arm.moveTo(x, y);
    previousArm = arm;
    // the arms are furry with short fragments across them, as the film's are
    if (random() < 0.3) {
      const across = (0.014 + 0.035 * random()) * (random() < 0.5 ? -1 : 1);
      ticks.moveTo(x, y);
      ticks.lineTo(x + Math.cos(angle) * across, y + Math.sin(angle) * across);
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
  const whorl = Skia.PathBuilder.Make();
  const outer = Skia.PathBuilder.Make();
  const ticks = Skia.PathBuilder.Make();
  appendWhorlArm(whorl, outer, ticks, random, 0.16, 3.5, 10.5);
  appendWhorlArm(whorl, outer, ticks, random, 0.33, 1.1, 6.5);
  appendArc(outer, CORE_X, CORE_Y, 0.7, 0.3, 0.8);
  appendArc(outer, CORE_X, CORE_Y, 0.66, 1.35, 0.55);
  return { whorlPath: whorl.build(), whorlOuterPath: outer.build(), whorlTickPath: ticks.build() };
}

/**
 * The inner structure: the long bright loop rising 37° to the right past the core, the faint
 * near half of the tall edge-on ellipse beside it, and two data streaks through the core.
 */
function buildInnerStructure(Skia: SkiaApiType) {
  const loop = Skia.PathBuilder.Make();
  appendEllipse(loop, 0.04, 0.03, 0.74, 0.2, -37 * DEGREES_TO_RADIANS, 56);
  // the edge-on ellipse's near half only, faint
  const edgeOn = Skia.PathBuilder.Make();
  appendEllipse(edgeOn, 0.27, 0.02, 0.1, 0.44, 4 * DEGREES_TO_RADIANS, 20, 0.5);
  // the ")" arc wrapping the core's right side at 0.57R: -60° to +40°, measured up from 3 o'clock
  const bracket = Skia.PathBuilder.Make();
  appendArc(bracket, CORE_X, CORE_Y, 0.575, 60 * DEGREES_TO_RADIANS, -100 * DEGREES_TO_RADIANS);
  const streaks = Skia.PathBuilder.Make();
  const streakRows = [
    [-0.72, 0.6, 0.05],
    [-0.5, 0.2, -0.065],
  ];
  for (const [from, to, y] of streakRows) {
    streaks.moveTo(CORE_X + from, CORE_Y + y);
    streaks.lineTo(CORE_X + to, CORE_Y + y);
  }
  return {
    loopPath: loop.build(),
    edgeOnPath: edgeOn.build(),
    bracketPath: bracket.build(),
    dataStreakPath: streaks.build(),
  };
}

/** The core glyph: a hooked ring of radius 0.1R with a stem curling in, and the bar. The whorl's first turn is the film's second ring at 0.3R. */
function buildCoreGlyph(Skia: SkiaApiType) {
  const ring = Skia.PathBuilder.Make();
  appendArc(ring, 0, 0, 0.1, -35 * DEGREES_TO_RADIANS, 305 * DEGREES_TO_RADIANS);
  // the hook: from the ring's open end a short stem curls in toward the middle
  const endAngle = 270 * DEGREES_TO_RADIANS;
  ring.moveTo(Math.cos(endAngle) * 0.1, Math.sin(endAngle) * 0.1);
  ring.lineTo(0.012, -0.055);
  ring.lineTo(0.03, -0.02);
  const bar = Skia.PathBuilder.Make();
  bar.moveTo(-0.3, 0.012);
  bar.lineTo(0.3, 0.012);
  return { coreRingPath: ring.build(), coreBarPath: bar.build() };
}

/**
 * The fan of strands on the right: four concentric strands from 1 to 5 o'clock whose
 * clockwise ends peel out to 1.08R (shot d).
 */
function buildStrandFan(Skia: SkiaApiType) {
  const fan = Skia.PathBuilder.Make();
  const radii = [0.9, 0.95, 1.0, 1.03];
  radii.forEach((radius, strand) => {
    const from = 30 + strand * 6;
    const to = 150 - strand * 4;
    for (let degrees = from; degrees <= to; degrees += 5) {
      const peel = Math.max(0, (degrees - (to - 30)) / 30);
      const pointRadius = radius + peel * peel * (1.08 - radius);
      const angle = (degrees - 90) * DEGREES_TO_RADIANS;
      if (degrees === from) fan.moveTo(Math.cos(angle) * pointRadius, Math.sin(angle) * pointRadius);
      else fan.lineTo(Math.cos(angle) * pointRadius, Math.sin(angle) * pointRadius);
    }
  });
  return fan.build();
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

  // The warm translucent volume: a textured circle, drawn in texel space (see drawVolumeFill).
  const texels = FILL_TEXTURE_TEXELS;
  const fillImage = Skia.Image.MakeImage(
    { width: texels, height: texels, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 },
    Skia.Data.fromBytes(buildFillTexture(createRandom(scene.textureSeed))),
    texels * 4,
  );
  if (!fillImage) throw new Error('The hologram could not make its fill texture');
  const volumeFill = makeFill('#ffffff');
  volumeFill.setShader(fillImage.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None));

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

  const makeBuilder = () => Skia.PathBuilder.Make();
  const pathBuilders = {
    // dim, mid and bright, pinned and then the same three for the turning shell
    body: [makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder()],
    fillBlobs: makeBuilder(),
    specks: [makeBuilder(), makeBuilder()], // warm, peach
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
    protrusionFace: makeBuilder(),
    protrusionRails: makeBuilder(),
    protrusionFarRails: makeBuilder(),
    protrusionSparks: makeBuilder(),
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
    pathBuilders.fillBlobs,
    ...pathBuilders.specks,
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
    pathBuilders.protrusionFace,
    pathBuilders.protrusionRails,
    pathBuilders.protrusionFarRails,
    pathBuilders.protrusionSparks,
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
    volumeFill,
    limbBloomFill,
    limbRidgeFill,
    thinRingStroke,
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
    speckWarmStroke: makeStroke('#ff944c', StrokeCap.Round),
    speckPeachStroke: makeStroke('#ffc2a2', StrokeCap.Round),
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

// ---- the script: which rim element dominates, and which protrusions are out --------------

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
 * A protrusion's growth (0..1) and dissolve (0..1) `elapsed` seconds after it began,
 * written into out[offset], out[offset + 1]; growth is -1 before it starts or once gone.
 */
function protrusionPhase(elapsed: number, grow: number, hold: number, out: number[], offset: number) {
  'worklet';
  const dissolve = (elapsed - grow - hold) / DISSOLVE_SECONDS;
  if (elapsed < 0 || dissolve >= 1) {
    out[offset] = -1;
    out[offset + 1] = 0;
    return;
  }
  const growth = clamp01(elapsed / grow);
  out[offset] = 1 - (1 - growth) * (1 - growth);
  out[offset + 1] = clamp01(dissolve);
}

/**
 * Reads the script at `time`: rim weights (crescent, truss, ring), fragment density,
 * both protrusion tracks, the epoch's line kind and its envelope, and the red flash.
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
  // [type, growth, dissolve] for the epoch's protrusion, then the same for the second track and its hash
  const protrusions = [epochs[offset + 3], -1, 0, 0, -1, 0, 0];
  if (protrusions[0] !== 0) {
    protrusionPhase(intoEpoch - epochs[offset + 4], epochs[offset + 5], epochs[offset + 6], protrusions, 1);
  }
  const track = scene.secondTrack;
  const trackTime = time - Math.floor(time / scene.secondTrackPeriod) * scene.secondTrackPeriod;
  for (let event = 0; event < track.length; event += SECOND_TRACK_STRIDE) {
    const elapsed = trackTime - track[event];
    if (elapsed < 0 || elapsed > track[event + 2] + track[event + 3] + DISSOLVE_SECONDS) continue;
    protrusions[3] = track[event + 1];
    protrusionPhase(elapsed, track[event + 2], track[event + 3], protrusions, 4);
    protrusions[6] = track[event + 4];
  }
  const redAt = epochs[offset + 9];
  const density = epochs[previous + 8] + (epochs[offset + 8] - epochs[previous + 8]) * handover;
  return {
    crescentWeight: weights[0],
    trussWeight: weights[1],
    ringWeight: weights[2],
    density,
    protrusions,
    lineKind: epochs[offset + 7],
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
  // the glow spreads from patch to patch a little behind the fragments (film f47-f70)
  const fillSpread = smooth01((intro - 0.55) / 0.26);
  return {
    time,
    radius: size * SPHERE_FRACTION,
    intro,
    // The fill comes up with the spread as well as with its own ramp, so a patch that is still
    // on its own is a thickening of the haze rather than a lit shape: the film's glow is never
    // brighter in one place than the whole volume becomes.
    fillAlpha: FILL_STRENGTH * smooth01((intro - 0.5) / 0.16) * (0.68 + 0.32 * fillSpread),
    fillSpread,
    // The haze the patches ride on leads them, so the fill thickens out of a wash rather than
    // arriving as lit shapes on black; FILL_WASH_SHARE says how much of the light it carries.
    fillWash: smooth01((intro - 0.5) / 0.24),
    bodyShare: smooth01((intro - 0.45) / 0.24) * script.density,
    // the dense fill runs hot (film shot a f58-f80): most mid fragments burn bright, then settle
    introHeat: 0.3 * smooth01((intro - 0.55) / 0.1) * (1 - smooth01((intro - 0.86) / 0.14)),
    ragged: 1 - smooth01((intro - 0.78) / 0.22),
    innerAlpha: smooth01((intro - 0.62) / 0.3),
    coreAlpha: smooth01((intro - 0.72) / 0.14),
    rimAlpha: smooth01((intro - 0.84) / 0.16),
    crescentGrowth: smooth01((intro - 1) / 0.3333),
    protrusionAlpha: smooth01((intro - 0.95) / 0.05),
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
 * One arriving patch of glow: its stored outline points, scaled by how far it has grown, drawn
 * as a smooth closed curve — each point is the control of a quadratic that ends half way to the
 * next, which rounds the corners off a twelve-point ring without a single trigonometric call.
 */
function appendFillPatch(
  builder: PathBuilder,
  centreX: number,
  centreY: number,
  scale: number,
  outline: number[],
  first: number,
) {
  'worklet';
  let nextX = centreX + outline[first] * scale;
  let nextY = centreY + outline[first + 1] * scale;
  let x = centreX + outline[first + 2] * scale;
  let y = centreY + outline[first + 3] * scale;
  builder.moveTo((nextX + x) * 0.5, (nextY + y) * 0.5);
  for (let point = 1; point <= FILL_PATCH_POINTS; point++) {
    const after = first + ((point + 1) % FILL_PATCH_POINTS) * 2;
    nextX = centreX + outline[after] * scale;
    nextY = centreY + outline[after + 1] * scale;
    builder.quadTo(x, y, (x + nextX) * 0.5, (y + nextY) * 0.5);
    x = nextX;
    y = nextY;
  }
  builder.close();
}

/**
 * The warm translucent fill: the prebuilt texture on a circle, drawn in texel space, so the
 * image shader needs no matrix — the square [-1, 1]² maps onto its texels.
 *
 * While the ball forms it arrives the way the film's does (f47-f70): a faint wash over the whole
 * volume that thickens as it spreads, with brighter patches where the fragments have already
 * landed. The patches are one path with a ragged outline, so where they overlap the light does
 * not double, and their alpha is set to come to the frame's fill level once screened over the
 * wash — the patches are a concentration of the glow, never a lit shape on black. As the last
 * of them arrive the wash takes over the whole of the light, so by the time the patches cover
 * the ball they have nothing left to add and the drawing can go back to one circle without a
 * step: their union never quite covers it, and the uncovered slivers would jump.
 */
function drawVolumeFill(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const alpha = state.fillAlpha;
  if (alpha <= 0) return;
  const half = FILL_TEXTURE_TEXELS / 2;
  const spread = state.fillSpread;
  canvas.save();
  canvas.translate(-1, -1);
  canvas.scale(1 / half, 1 / half);
  if (spread >= 1) {
    // a little past the limb, so the texture's ragged edge is not cut round
    resources.volumeFill.setAlphaf(alpha);
    canvas.drawCircle(half, half, half * 1.06, resources.volumeFill);
  } else {
    const washShare = FILL_WASH_SHARE * state.fillWash;
    const closing = smooth01((spread - 0.78) / 0.22);
    const wash = alpha * (washShare + (1 - washShare) * closing);
    resources.volumeFill.setAlphaf(wash);
    canvas.drawCircle(half, half, half * 1.06, resources.volumeFill);
    const patchAlpha = (alpha - wash) / (1 - wash);
    if (patchAlpha < 0.004) {
      canvas.restore();
      return;
    }
    const blobs = scene.fillBlobs;
    const builder = resources.pathBuilders.fillBlobs;
    let patches = 0;
    for (let offset = 0; offset < blobs.length; offset += FILL_BLOB_STRIDE) {
      const grown = smooth01((spread * 1.35 - blobs[offset + 2]) / 0.34);
      if (grown < 0.02) continue;
      appendFillPatch(
        builder,
        half * (blobs[offset] + 1),
        half * (blobs[offset + 1] + 1),
        half * grown,
        blobs,
        offset + 3,
      );
      patches++;
    }
    const patchPath = builder.detach();
    if (patches > 0) {
      // screened over the wash, the two come to `alpha` where a patch has arrived
      resources.volumeFill.setAlphaf(patchAlpha);
      canvas.drawPath(patchPath, resources.volumeFill);
    }
  }
  canvas.restore();
}

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
    builder.addCircle(x, y, half * 0.45);
    return;
  }
  // the normal, shorter than the length: ticks and cell heights
  const normalX = -alongY * 0.55;
  const normalY = alongX * 0.55;
  if (glyph === 6) {
    builder.moveTo(x - alongX - normalX, y - alongY - normalY);
    builder.lineTo(x + alongX - normalX, y + alongY - normalY);
    builder.lineTo(x + alongX + normalX, y + alongY + normalY);
    builder.lineTo(x - alongX + normalX, y - alongY + normalY);
    builder.close();
    return;
  }
  if (glyph === 2 || glyph === 4) {
    builder.moveTo(x - alongX + normalX, y - alongY + normalY);
    builder.lineTo(x - alongX, y - alongY);
    builder.lineTo(x + alongX, y + alongY);
    builder.lineTo(x + alongX + (glyph === 2 ? normalX : -normalX), y + alongY + (glyph === 2 ? normalY : -normalY));
    return;
  }
  builder.moveTo(x - alongX, y - alongY);
  builder.lineTo(x + alongX, y + alongY);
  if (glyph === 1) builder.lineTo(x + alongX + normalX, y + alongY + normalY);
  else if (glyph === 3) {
    builder.moveTo(x, y);
    builder.lineTo(x + normalX * 1.4, y + normalY * 1.4);
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
function fragmentStrength(time: number, rate: number, phase: number, id: number, pool: number, state: FrameState) {
  'worklet';
  const cycles = time * rate + phase;
  const life = cycles - Math.floor(cycles);
  if (life >= FRAGMENT_DUTY) return 0;
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

/** The pinned fragment body, sorted into the dim, mid and bright builders. */
function appendBody(builders: PathBuilder[], body: number[], state: FrameState) {
  'worklet';
  const time = state.time;
  const ragged = state.ragged;
  for (let offset = 0; offset < body.length; offset += BODY_STRIDE) {
    const packed = body[offset + 7];
    const glyph = Math.floor(packed / FRAGMENT_CODE_GLYPH_STEP);
    const code = packed - glyph * FRAGMENT_CODE_GLYPH_STEP;
    const turning = code >= 6 ? 3 : 0;
    const pool = code - turning * 2 >= 3 ? 1 : 0;
    const id = body[offset + 6];
    const phase = fraction(id * FRAGMENT_PHASE_FROM_ID);
    const shown = fragmentShown(body[offset + 8], state);
    if (shown <= 0) continue;
    const rate = body[offset + 5];
    const strength = shown * fragmentStrength(time, rate, phase, id, pool, state);
    if (strength < FRAGMENT_FAINTEST) continue;
    const cycle = Math.floor(time * rate + phase);
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
    const across = (fraction(hop * 23.17) - 0.5) * (FRAGMENT_WANDER + 0.34 * state.agitation * inward);
    let x = body[offset] + unitX * along - unitY * across;
    let y = body[offset + 1] + unitY * along + unitX * across;
    if (ragged > 0 && x < 0 && x * x + y * y > 0.5) {
      // while forming, the left limb is ragged: fragments stray outward
      const push = 1 + ragged * 0.16 * fraction(id * 3.7);
      x *= push;
      y *= push;
    }
    const tier = fragmentTier(code - 3 * pool - 2 * turning, strength, id, state.hotShare, state.introHeat);
    // Its length is its whole fade: a fragment grows out of nothing and shrinks back into it,
    // because a paint is set once for a whole tier and so cannot fade with one stroke in it.
    // Arriving at a third of its length, as it used to, meant arriving at full brightness over
    // a dozen pixels at once — with twice as many fragments that is a visible speckle at every
    // frame, and it is what the spec's script-boundary check counts.
    appendGlyph(builders[tier + turning], glyph, x, y, unitX, unitY, length * 0.5 * strength);
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
    const strength = shown * fragmentStrength(time, stream[offset + 5], stream[offset + 6], id, pool, state);
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
type DetachedPath = ReturnType<PathBuilder['detach']>;

/** One of the drawing's prebuilt paints. */
type HologramPaint = Resources['particleHaloStroke'];

/**
 * The halo around a tier of particles: two nested strokes of the same amber on the same path, the
 * inner one narrower and a little stronger than the one outside it.
 *
 * ONE wide stroke is not a glow. A round-capped stroke of a flat colour covers its whole width
 * at a single alpha, so it lands as a hard-edged lozenge of uniform mid-brown about as wide as
 * the fragment is long, and with this many fragments those lozenges touch and fuse into lumps:
 * when each halo was one wide pass, 97% of its lit pixels sat at one luma and its outer edge
 * stepped up by fifty. Two rings stack under Screen blending into a ramp instead. The width and
 * shares below are chosen so the two steps come out equal — half of the way up at the outer
 * reach, all the way at the inner ring. Measured straight out from the centre line of one
 * mid-tier fragment of the median length, drawn alone on black at 768 px, the three recipes read
 *   one flat pass  131 115 | 35 35 35 35 35 35 35 35 35 35 35 35 | 9 | 0
 *   three rings    132 117 | 37 37 37 | 24 24 24 24 | 11 11 11 11 11 | 0
 *   two rings      132 117 | 37 37 37 37 37 | 18 18 18 18 18 18 18 | 0
 * so the step that meets the black between the clumps falls from thirty-five (fifty on the
 * bright tier) to eighteen, and the halo reaches 13 px rather than 8.
 *
 * WHY TWO RINGS AND NOT THREE. Three rings cut that step further, to eleven, and were what this
 * drawing shipped first. But every pass re-strokes the whole tier's path and is charged per
 * particle, and with the particle count doubled the halos alone are 30% of the frame (1096 ms of
 * 3651 over the 242 renders the spec's materialisation test makes). A third ring is another 240
 * to 400 ms of that test's 5 s budget, which it does not have: with three rings the test ran at
 * 4.53 s, over the sparser drawing it replaced by 15%; with two it runs at 3.86 s against that
 * drawing's 3.84, measured as fourteen interleaved pairs. Two rings also light the gaps *better*
 * than three, because the outer ring then carries half the halo's alpha rather than a third:
 * over five silent moments at 768 px the fifth-percentile luma inside 0.85R went from 37.2 to
 * 39.1 and the share under luma 40 from 6.4% to 5.5%. What the third ring buys is smoothness
 * alone, and the cheaper place to spend on that is {@link HALO_ANTIALIASED}.
 *
 * WHY THE INNER RING IS USUALLY BUTT-CAPPED. A fragment is much shorter than its halo is wide —
 * the median is 0.036R against a reach of 0.12R — so a round-capped pass over it is very nearly
 * a disc, and most of the cost of the halo is the two cap arcs. Butt caps on the inner ring (a
 * plain rectangle along the fragment, no arcs) are worth about 200 ms and cannot change the
 * halo's silhouette, because the inner ring is 0.47 of the outer one's width, so its corners fall
 * inside the outer ring's round boundary. What it does cost is the ramp past a fragment's tips,
 * where the inner ring stops and the outer one carries on alone. Square caps on the *outer* ring
 * were measured too and are cheaper still, but they turn every halo into a box and the whole
 * field goes visibly rectangular. A Gaussian mask filter would be smoother than any staircase,
 * but it measured 600 ms dearer than three rings, and its price follows the path's bounding box
 * in device pixels rather than its ink, so it gets worse on a phone, where a stroke's cost
 * hardly moves.
 *
 * `innerRingStroke` is why the cap is only usually butt: a tier whose particles are points
 * rather than strokes — the specks — has to pass the round-capped paint here, because a butt cap
 * on a point of no length is a thin bar across it instead of a disc, which is plainly visible
 * under magnification. That tier is small enough that the round caps measure free.
 *
 * `reach` is the halo's full width and `strength` the alpha it comes to against the stroke.
 */
const HALO_INNER_WIDTH = 0.47;
const HALO_OUTER_SHARE = 0.52;
const HALO_INNER_SHARE = 0.61;

function drawParticleHalo(
  canvas: HologramCanvas,
  resources: Resources,
  path: DetachedPath,
  reach: number,
  strength: number,
  innerRingStroke: HologramPaint,
) {
  'worklet';
  resources.particleHaloStroke.setStrokeWidth(reach);
  resources.particleHaloStroke.setAlphaf(strength * HALO_OUTER_SHARE);
  canvas.drawPath(path, resources.particleHaloStroke);
  innerRingStroke.setStrokeWidth(reach * HALO_INNER_WIDTH);
  innerRingStroke.setAlphaf(strength * HALO_INNER_SHARE);
  canvas.drawPath(path, innerRingStroke);
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
    const dimPath = builders[group * 3].detach();
    drawParticleHalo(canvas, resources, dimPath, 0.115, 0.24, resources.particleHaloInnerStroke);
    resources.bodyDimStroke.setStrokeWidth(0.014);
    resources.bodyDimStroke.setAlphaf(0.62);
    canvas.drawPath(dimPath, resources.bodyDimStroke);
    const midPath = builders[group * 3 + 1].detach();
    drawParticleHalo(canvas, resources, midPath, 0.12, 0.3, resources.particleHaloInnerStroke);
    resources.bodyMidStroke.setStrokeWidth(0.0155);
    resources.bodyMidStroke.setAlphaf(0.85);
    canvas.drawPath(midPath, resources.bodyMidStroke);
    if (group === 1) canvas.restore();
  }
}

/**
 * The warm points that wink on and off, and the pale peach ones that blink: while he talks a
 * growing share of them hand over from their calm clock to their fast one, so the layer twinkles
 * about half again as fast without any speck's phase moving (see SPECK_FAST_RATE).
 */
function drawSpecks(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const specks = scene.specks;
  const builders = resources.pathBuilders.specks;
  const time = state.time;
  const fastShare = SPECK_FAST_SHARE * state.agitation;
  let counts = 0;
  for (let offset = 0; offset < specks.length; offset += SPECK_STRIDE) {
    if (fraction(specks[offset + 4] * 0.37 + specks[offset] * 5.1 + 0.5) > state.bodyShare) continue;
    const phase = specks[offset + 3];
    const onFastClock = fraction(phase * 31.7 + specks[offset + 1] * 3.1) < fastShare;
    if (fraction(time * specks[offset + 2] * (onFastClock ? SPECK_FAST_RATE : 1) + phase) >= 0.5) continue;
    const x = specks[offset];
    const y = specks[offset + 1];
    builders[specks[offset + 4]].moveTo(x, y);
    builders[specks[offset + 4]].lineTo(x + 0.002, y);
    counts++;
  }
  const warmPath = builders[0].detach();
  const peachPath = builders[1].detach();
  if (counts === 0) return;
  // Each speck is a small light with a halo round it, not a bare dot on a lit ball. A speck is a
  // point rather than a stroke, so its halo takes the round-capped paint for its inner ring as
  // well: see drawParticleHalo for what a butt cap does to a particle of no length.
  drawParticleHalo(canvas, resources, warmPath, 0.095, 0.36, resources.particleHaloStroke);
  resources.speckWarmStroke.setStrokeWidth(0.016);
  resources.speckWarmStroke.setAlphaf(0.85);
  canvas.drawPath(warmPath, resources.speckWarmStroke);
  resources.speckPeachStroke.setStrokeWidth(0.021);
  resources.speckPeachStroke.setAlphaf(0.32);
  canvas.drawPath(peachPath, resources.speckPeachStroke);
  resources.speckPeachStroke.setStrokeWidth(0.013);
  resources.speckPeachStroke.setAlphaf(0.7);
  canvas.drawPath(peachPath, resources.speckPeachStroke);
}

/** The bright fragments with the widest of the amber halos, and the specks. */
function drawBodyHighlights(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const brightPath = resources.pathBuilders.body[2].detach();
  const turningBrightPath = resources.pathBuilders.body[5].detach();
  if (state.bodyShare > 0) {
    for (let group = 0; group < 2; group++) {
      const path = group === 0 ? brightPath : turningBrightPath;
      if (group === 1) {
        canvas.save();
        canvas.rotate(state.shellTurn, CORE_X, CORE_Y);
      }
      drawParticleHalo(canvas, resources, path, 0.125, 0.38, resources.particleHaloInnerStroke);
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
  drawSpecks(canvas, resources, scene, state);
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
    builder.moveTo(CORE_X + Math.cos(angle) * 0.14, CORE_Y + Math.sin(angle) * 0.14);
    builder.lineTo(CORE_X + Math.cos(angle) * (0.14 + reach), CORE_Y + Math.sin(angle) * (0.14 + reach));
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
  const linePath = builders.lines.detach();
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
    canvas.drawPath(builders.swoosh.detach(), resources.lineStroke);
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
    knot.moveTo(-0.075, -0.07);
    knot.lineTo(-0.075 + Math.cos(angle) * length, -0.07 + Math.sin(angle) * length);
  }
  const knotPath = knot.detach();
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
    detail.moveTo(cosEarly * 0.955, sinEarly * 0.955);
    detail.lineTo(cosEarly * 1.005, sinEarly * 1.005);
    detail.lineTo(cosLate * 1.005, sinLate * 1.005);
  } else if (trace === 2) {
    detail.moveTo(cosEarly * 0.95, sinEarly * 0.95);
    detail.lineTo(cosEarly * 0.99, sinEarly * 0.99);
    detail.lineTo(cosLate * 0.99, sinLate * 0.99);
    detail.lineTo(cosLate * 1.03, sinLate * 1.03);
  } else if (trace === 3) {
    detail.moveTo(cosEarly * 1.02, sinEarly * 1.02);
    detail.lineTo(cosLate * 1.02, sinLate * 1.02);
    detail.moveTo((cosEarly + cosLate) * 0.4725, (sinEarly + sinLate) * 0.4725);
    detail.lineTo((cosEarly + cosLate) * 0.5, (sinEarly + sinLate) * 0.5);
  }
  if (strut > 0) {
    // a pair of struts 0.02R apart hanging from the inner rail toward the centre
    const tangentX = -sinEarly * 0.02;
    const tangentY = cosEarly * 0.02;
    const inner = 0.935 - strut;
    detail.moveTo(cosEarly * 0.935, sinEarly * 0.935);
    detail.lineTo(cosEarly * inner, sinEarly * inner);
    detail.moveTo(cosEarly * 0.935 + tangentX, sinEarly * 0.935 + tangentY);
    detail.lineTo(cosEarly * inner + tangentX, sinEarly * inner + tangentY);
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
    builders.trussRungs.moveTo(cosStart * 0.935, sinStart * 0.935);
    builders.trussRungs.lineTo(cosStart * 1.035, sinStart * 1.035);
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
  const shown = appendTruss(builders, scene.truss, weight);
  const outerPath = builders.truss.detach();
  const innerPath = builders.trussInner.detach();
  const hazePath = builders.trussHaze.detach();
  const rungPath = builders.trussRungs.detach();
  const detailPath = builders.trussDetail.detach();
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
      builders.ringTicks.moveTo(Math.cos(angle) * (1 - half), Math.sin(angle) * (1 - half));
      builders.ringTicks.lineTo(Math.cos(angle) * (1 + half), Math.sin(angle) * (1 + half));
    }
    resources.trussStroke.setStrokeWidth(0.009);
    resources.trussStroke.setAlphaf((0.15 + 0.6 * script.ringWeight) * state.rimAlpha);
    canvas.drawPath(builders.ringTicks.detach(), resources.trussStroke);
  }
  if (shown > 0) {
    // leading, the ladder ring is a bold gold band (shot d, shot b's box-frame ribbon);
    // faint, its dashes are fine
    resources.trussHazeStroke.setStrokeWidth(0.1);
    resources.trussHazeStroke.setAlphaf(0.42 * weight);
    canvas.drawPath(hazePath, resources.trussHazeStroke);
    resources.trussGlowStroke.setStrokeWidth(0.05 + 0.03 * weight);
    resources.trussGlowStroke.setAlphaf(0.3 * (0.3 + 0.7 * weight));
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
  const thin = builders[0].detach();
  const medium = builders[1].detach();
  const wide = builders[2].detach();
  const core = builders[3].detach();
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
    builder.moveTo(head - streaks[offset + 1] * visible, y);
    builder.lineTo(head, y);
  }
  resources.frayStroke.setStrokeWidth(0.011);
  resources.frayStroke.setAlphaf(0.8);
  canvas.drawPath(builder.detach(), resources.frayStroke);
}

// ---- protrusions --------------------------------------------------------------------------

/**
 * Appends a rail from (fromX, fromY) to (toX, toY) as `beads` beads. Solid while
 * `dissolve` is 0; as it rises the beads shrink to dots, and past 0.6 they fall as sparks.
 */
function appendRail(
  rails: PathBuilder,
  sparks: PathBuilder,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  beads: number,
  dissolve: number,
) {
  'worklet';
  const stepX = (toX - fromX) / beads;
  const stepY = (toY - fromY) / beads;
  if (dissolve > 0.6) {
    const fall = (dissolve - 0.6) * 0.3;
    for (let bead = 0; bead < beads; bead += 2) {
      const x = fromX + stepX * (bead + 0.5);
      const y = fromY + stepY * (bead + 0.5) + fall * (1 + (bead % 3) * 0.5);
      sparks.moveTo(x, y);
      sparks.lineTo(x + 0.002, y);
    }
    return;
  }
  const share = 1 - 0.85 * smooth01(dissolve / 0.55);
  if (share > 0.97) {
    rails.moveTo(fromX, fromY);
    rails.lineTo(toX, toY);
    return;
  }
  for (let bead = 0; bead < beads; bead++) {
    const x = fromX + stepX * bead;
    const y = fromY + stepY * bead;
    rails.moveTo(x, y);
    rails.lineTo(x + stepX * share, y + stepY * share);
  }
}

/**
 * The four corners of one bay boundary of a truss boom, `along` of the way out, written into
 * `out` as near top, near bottom, far top, far bottom (x, y each).
 *
 * The boom is a square-section box standing off the limb, seen from a little above and to one
 * side. Two things give it its depth. Both faces narrow as they go out, as anything pointing
 * away from the eye does; and the far face is drawn smaller than the near one and offset
 * across and back, by an amount that itself shrinks toward the tip — so the two faces
 * converge, which is the whole of the perspective and costs four multiplications.
 *
 * The half-width wobbles a little from station to station: a truss built by hand is never
 * quite ruled, and a perfectly regular one reads as a diagram.
 */
function trussBoomCorners(
  outX: number,
  outY: number,
  root: number,
  length: number,
  width: number,
  along: number,
  seed: number,
  out: number[],
) {
  'worklet';
  const distance = root + length * along;
  // across the boom on screen; the far face lies this way and a little back toward the ball
  const sideX = -outY;
  const sideY = outX;
  const half = width * (1 - TRUSS_BOOM_TAPER * along) * (0.94 + 0.12 * hashInteger(seed * 31 + Math.round(along * 8)));
  const depth = width * TRUSS_BOOM_DEPTH * (1 - 0.45 * along);
  const farX = outX * distance + sideX * depth * 0.62 - outX * depth * 0.25;
  const farY = outY * distance + sideY * depth * 0.62 - outY * depth * 0.25;
  const farHalf = half * TRUSS_BOOM_FAR_SCALE;
  out[0] = outX * distance + sideX * half;
  out[1] = outY * distance + sideY * half;
  out[2] = outX * distance - sideX * half;
  out[3] = outY * distance - sideY * half;
  out[4] = farX + sideX * farHalf;
  out[5] = farY + sideY * farHalf;
  out[6] = farX - sideX * farHalf;
  out[7] = farY - sideY * farHalf;
}

/**
 * A truss boom: the protrusion as a structure standing off the sphere in depth rather than as
 * a flat outline on the glass.
 *
 * It is a box frame. The near face is two rails with a rung at every bay boundary and a
 * diagonal brace across each bay, which is what makes a truss a truss. The far face is the
 * same frame again, foreshortened, dimmer and thinner because it is further away — it goes to
 * its own builder, which {@link drawProtrusions} draws at about half the near face's weight.
 * The two are tied together by the short depth edges at the root, the middle and the tip, and
 * the top side panel between them is filled, so the box has a surface that catches the light
 * instead of being a wireframe you can see straight through.
 *
 * It grows out of the limb, holds and dissolves on the script's clock like every other
 * protrusion: every member goes through appendRail, so the dissolve beads it, shrinks it to
 * dots and drops it as sparks; the filled panel goes first, leaving the frame hollow.
 */
function appendTrussBoom(
  builders: Resources['pathBuilders'],
  growth: number,
  dissolve: number,
  clockDegrees: number,
  reach: number,
  width: number,
  seed: number,
) {
  'worklet';
  const angle = clockRadians(clockDegrees);
  const outX = Math.cos(angle);
  const outY = Math.sin(angle);
  const length = reach * growth;
  // below this there is nothing to see but a knot of overlapping rungs at the limb
  if (length < 0.006) return;
  // The box opens out as it extends, rather than arriving at full section: a frame this dense
  // would otherwise light every one of its members in the frame it first clears the guard above,
  // which is exactly the kind of step the script is meant never to take.
  const section = width * Math.min(1, length / TRUSS_BOOM_OPENING);
  const rails = builders.protrusionRails;
  const far = builders.protrusionFarRails;
  const sparks = builders.protrusionSparks;
  const here = [0, 0, 0, 0, 0, 0, 0, 0];
  const next = [0, 0, 0, 0, 0, 0, 0, 0];
  trussBoomCorners(outX, outY, TRUSS_BOOM_ROOT, length, section, 0, seed, here);
  // the near face's first rung, and the depth edges at the root
  appendRail(rails, sparks, here[0], here[1], here[2], here[3], 2, dissolve);
  appendRail(rails, sparks, here[0], here[1], here[4], here[5], 1, dissolve);
  appendRail(rails, sparks, here[2], here[3], here[6], here[7], 1, dissolve);
  for (let bay = 0; bay < TRUSS_BOOM_BAYS; bay++) {
    const along = (bay + 1) / TRUSS_BOOM_BAYS;
    trussBoomCorners(outX, outY, TRUSS_BOOM_ROOT, length, section, along, seed, next);
    // the near face: its two rails, its rung, and a brace across the bay that alternates
    appendRail(rails, sparks, here[0], here[1], next[0], next[1], 3, dissolve);
    appendRail(rails, sparks, here[2], here[3], next[2], next[3], 3, dissolve);
    appendRail(rails, sparks, next[0], next[1], next[2], next[3], 2, dissolve);
    const braceFrom = bay % 2 === 0 ? 2 : 0;
    appendRail(
      rails,
      sparks,
      here[braceFrom],
      here[braceFrom + 1],
      next[2 - braceFrom],
      next[3 - braceFrom],
      3,
      dissolve,
    );
    // the far face, at its own weight: rails all the way, rungs every other bay
    appendRail(far, sparks, here[4], here[5], next[4], next[5], 3, dissolve);
    appendRail(far, sparks, here[6], here[7], next[6], next[7], 3, dissolve);
    if (bay % 2 === 1) appendRail(far, sparks, next[4], next[5], next[6], next[7], 2, dissolve);
    // the depth edges halfway out and at the tip, which is where the box shows its thickness
    if (bay === TRUSS_BOOM_BAYS / 2 - 1 || bay === TRUSS_BOOM_BAYS - 1) {
      appendRail(rails, sparks, next[0], next[1], next[4], next[5], 1, dissolve);
      appendRail(rails, sparks, next[2], next[3], next[6], next[7], 1, dissolve);
    }
    for (let corner = 0; corner < 8; corner++) here[corner] = next[corner];
  }
  // The top side panel, between the near and far top rails: the box's one solid surface.
  // It is the protrusion's body, so it goes as soon as the dissolve begins.
  if (dissolve >= 0.3) return;
  const face = builders.protrusionFace;
  trussBoomCorners(outX, outY, TRUSS_BOOM_ROOT, length, section, 0, seed, next);
  face.moveTo(next[0], next[1]);
  face.lineTo(here[0], here[1]);
  face.lineTo(here[4], here[5]);
  face.lineTo(next[4], next[5]);
  face.close();
}

/** A polyline of `samples` points along a protrusion's curve (kind 2 ribbon loop, 3 hook), offset across by `across`. */
function curvePoint(kind: number, along: number, across: number, out: number[]) {
  'worklet';
  if (kind === 2) {
    // the ribbon loop: out of the left limb below 9 o'clock, to a tip at 1.27R, and back in above
    const angle = along * Math.PI;
    const reach = Math.sin(angle) ** 0.7;
    out[0] = -0.9 - 0.37 * reach - across * reach;
    out[1] = 0.3 * Math.cos(angle) + across * Math.cos(angle) * 0.4;
    return;
  }
  // the hook tendril: horizontal 0.58R above centre, from inside out to 1.2R, its tip curling down
  const straight = along < 0.8 ? along / 0.8 : 1;
  const curl = along < 0.8 ? 0 : (along - 0.8) / 0.2;
  const curlAngle = curl * Math.PI * 0.6;
  out[0] = -0.4 - 0.72 * straight - Math.sin(curlAngle) * (0.12 + across);
  out[1] = -0.58 + across + (1 - Math.cos(curlAngle)) * (0.12 + across);
}

/**
 * The ribbon loop (6 parallel strands) or the hook tendril (3 strands), grown along their
 * curve. The strands are not ruled lines: their spacing varies, each wanders a little and
 * grows a little ahead of or behind the others.
 */
function appendCurveProtrusion(builders: Resources['pathBuilders'], kind: number, growth: number, dissolve: number) {
  'worklet';
  const strands = kind === 2 ? 6 : 3;
  const samples = 12;
  const point = [0, 0];
  for (let strand = 0; strand < strands; strand++) {
    const across = (strand - (strands - 1) / 2) * 0.022 * (1 + 0.35 * Math.sin(strand * 1.7 + kind));
    const reach = growth * (0.88 + 0.12 * hashInteger(strand * 7 + kind));
    curvePoint(kind, 0, across, point);
    let previousX = point[0];
    let previousY = point[1];
    for (let sample = 1; sample <= samples; sample++) {
      const along = (sample / samples) * reach;
      curvePoint(kind, along, across, point);
      const wander = 0.012 * Math.sin(along * 9 + strand * 2.3);
      point[0] += wander;
      point[1] += wander * 0.6;
      appendRail(
        builders.protrusionRails,
        builders.protrusionSparks,
        previousX,
        previousY,
        point[0],
        point[1],
        1,
        dissolve,
      );
      previousX = point[0];
      previousY = point[1];
    }
  }
}

/** Horizontal streaks leaving the lower-left limb at 7-8 o'clock, bright heads out front. */
function appendStreakBundle(builders: Resources['pathBuilders'], growth: number, dissolve: number, seed: number) {
  'worklet';
  for (let streak = 0; streak < 5; streak++) {
    const y = 0.46 + streak * 0.045;
    const limbX = -Math.sqrt(1 - y * y);
    // it slides out of the limb and lengthens as it grows, so at growth 0 there is nothing to see
    const out = (0.03 + 0.11 * hashInteger(seed * 97 + streak * 5)) * growth;
    const length = (0.1 + 0.3 * hashInteger(seed * 89 + streak)) * growth;
    if (length < 0.01) continue;
    appendRail(
      builders.protrusionRails,
      builders.protrusionSparks,
      limbX - out,
      y,
      limbX - out + length,
      y,
      4,
      dissolve,
    );
    if (dissolve > 0.6) continue;
    builders.protrusionSparks.moveTo(limbX - out, y);
    builders.protrusionSparks.lineTo(limbX - out + 0.03 * growth, y);
  }
}

/**
 * The pole fan: strands bowing out of the right limb and converging just outside 3 o'clock,
 * each reaching a little further or shorter.
 */
function appendPoleFan(builders: Resources['pathBuilders'], growth: number, dissolve: number) {
  'worklet';
  for (let strand = 0; strand < 6; strand++) {
    const angle = clockRadians(52 + strand * 15);
    const fromX = Math.cos(angle) * 0.95;
    const fromY = Math.sin(angle) * 0.95;
    const reach = growth * (0.8 + 0.2 * hashInteger(strand * 13 + 5));
    // a quadratic bow: out past the limb, then round to the meeting point at (1.18R, 0)
    const bowX = Math.cos(angle) * 1.22;
    const bowY = Math.sin(angle) * 1.0;
    let previousX = fromX;
    let previousY = fromY;
    for (let step = 1; step <= 6; step++) {
      const along = (step / 6) * reach;
      const x = (1 - along) * (1 - along) * fromX + 2 * along * (1 - along) * bowX + along * along * 1.18;
      const y = (1 - along) * (1 - along) * fromY + 2 * along * (1 - along) * bowY;
      appendRail(builders.protrusionRails, builders.protrusionSparks, previousX, previousY, x, y, 1, dissolve);
      previousX = x;
      previousY = y;
    }
  }
}

/** One protrusion of `kind` at its growth and dissolve. */
function appendProtrusion(
  builders: Resources['pathBuilders'],
  kind: number,
  growth: number,
  dissolve: number,
  seed: number,
) {
  'worklet';
  // The two truss booms: the long one out of the equator at 9 o'clock, where the solid rod
  // used to be, and a shorter, finer one off the upper-left limb, where the ear ring was.
  if (kind === 1) appendTrussBoom(builders, growth, dissolve, 270, 0.55, 0.085, seed);
  else if (kind === 2 || kind === 3) appendCurveProtrusion(builders, kind, growth, dissolve);
  else if (kind === 4) appendStreakBundle(builders, growth, dissolve, seed);
  else if (kind === 5) appendTrussBoom(builders, growth, dissolve, 312, 0.4, 0.062, seed + 5);
  else if (kind === 6) appendPoleFan(builders, growth, dissolve);
}

/** The script's protrusions: at most one per track, two at once. */
function drawProtrusions(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const alpha = state.protrusionAlpha;
  const protrusions = state.script.protrusions;
  if (alpha <= 0 || (protrusions[1] < 0 && protrusions[4] < 0)) return;
  const builders = resources.pathBuilders;
  // a truss boom's side panel is solid only while its protrusion has barely begun to dissolve
  let faceSolid = 0;
  if (protrusions[1] >= 0) {
    appendProtrusion(builders, protrusions[0], protrusions[1], protrusions[2], 3);
    faceSolid = Math.max(faceSolid, 1 - smooth01(protrusions[2] / 0.3));
  }
  if (protrusions[4] >= 0) {
    appendProtrusion(builders, protrusions[3], protrusions[4], protrusions[5], Math.floor(protrusions[6] * 1000));
    faceSolid = Math.max(faceSolid, 1 - smooth01(protrusions[5] / 0.3));
  }
  const facePath = builders.protrusionFace.detach();
  const faceAlpha = alpha * faceSolid;
  if (faceAlpha > 0) {
    // the box's one solid surface, lit like the amber the frame is made of and no brighter,
    // so it reads as a face turned away from the eye rather than as a patch of light
    resources.trussFaceFill.setAlphaf(0.72 * faceAlpha);
    canvas.drawPath(facePath, resources.trussFaceFill);
  }
  // The far face, at about half the near one's weight: distance is the only thing that says
  // which of two identical frames is behind the other.
  const farPath = builders.protrusionFarRails.detach();
  resources.rodGlowStroke.setStrokeWidth(0.026);
  resources.rodGlowStroke.setAlphaf(0.14 * alpha);
  canvas.drawPath(farPath, resources.rodGlowStroke);
  resources.railStroke.setStrokeWidth(0.008);
  resources.railStroke.setAlphaf(0.42 * alpha);
  canvas.drawPath(farPath, resources.railStroke);
  // near rails glow: a soft halo, the golden line, a hot thread down the middle
  const railPath = builders.protrusionRails.detach();
  resources.rodGlowStroke.setStrokeWidth(0.045);
  resources.rodGlowStroke.setAlphaf(0.24 * alpha);
  canvas.drawPath(railPath, resources.rodGlowStroke);
  resources.railStroke.setStrokeWidth(0.013);
  resources.railStroke.setAlphaf(0.85 * alpha);
  canvas.drawPath(railPath, resources.railStroke);
  resources.rodCoreStroke.setStrokeWidth(0.005);
  resources.rodCoreStroke.setAlphaf(0.55 * alpha);
  canvas.drawPath(railPath, resources.rodCoreStroke);
  resources.sparkStroke.setStrokeWidth(0.014);
  resources.sparkStroke.setAlphaf(0.8 * alpha);
  canvas.drawPath(builders.protrusionSparks.detach(), resources.sparkStroke);
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
  builder.moveTo(centreX - alongX - outX, centreY - alongY - outY);
  builder.lineTo(centreX + alongX - outX, centreY + alongY - outY);
  builder.lineTo(centreX + alongX + outX, centreY + alongY + outY);
  builder.lineTo(centreX - alongX + outX, centreY - alongY + outY);
  builder.close();
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
  const bodyPath = bodies.detach();
  const corePath = cores.detach();
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
    builders.lightning.moveTo(startX, startY);
    for (let joint = 1; joint <= 8; joint++) {
      const along = (joint / 8) * length;
      const jag = (hashInteger(filmFrame * 29 + joint) - 0.5) * 0.07;
      builders.lightning.lineTo(
        startX + Math.cos(anchor) * along - Math.sin(anchor) * jag,
        startY + Math.sin(anchor) * along + Math.cos(anchor) * jag,
      );
    }
    resources.lightningStroke.setStrokeWidth(0.008);
    resources.lightningStroke.setAlphaf(0.85 * alpha * script.lineEnvelope);
    canvas.drawPath(builders.lightning.detach(), resources.lightningStroke);
  }
  if (script.redVisible) {
    const angle = clockRadians(360 * hashInteger(script.lineSeed * 7));
    builders.red.moveTo(Math.cos(angle) * 0.9, Math.sin(angle) * 0.9);
    builders.red.lineTo(Math.cos(angle + 0.12) * 0.9, Math.sin(angle + 0.12) * 0.9);
    resources.redStroke.setStrokeWidth(0.016);
    resources.redStroke.setAlphaf(0.9 * alpha);
    canvas.drawPath(builders.red.detach(), resources.redStroke);
  }
}

// ---- the materialisation ------------------------------------------------------------------

/** The point of light, then single-pixel sparks: a row across the future top, a trail falling down the right, specks. */
function drawIntroSparks(canvas: HologramCanvas, resources: Resources, scene: Scene, intro: number, time: number) {
  'worklet';
  const pointAlpha = smooth01(intro / 0.01) * (1 - smooth01((intro - 0.12) / 0.2));
  if (pointAlpha > 0) {
    canvas.save();
    canvas.translate(0.68, -1.2);
    canvas.scale(0.07, 0.07);
    resources.introPointFill.setAlphaf(pointAlpha);
    canvas.drawCircle(0, 0, 1, resources.introPointFill);
    canvas.restore();
  }
  const builder = resources.pathBuilders.introSparks;
  const sparks = scene.introSparks;
  const filmFrame = Math.floor(time * 24);
  let shown = 0;
  for (let offset = 0; offset < sparks.length; offset += INTRO_SPARK_STRIDE) {
    const since = intro - sparks[offset + 2];
    if (since < 0 || since > 0.4) continue;
    if (hashInteger(filmFrame * 7 + offset) < 0.3) continue;
    const x = sparks[offset];
    // the trail's sparks fall down the right side
    const y = sparks[offset + 3] === 1 ? -1 + (sparks[offset + 2] - 0.1) * 16 + since * 1.5 : sparks[offset + 1];
    builder.moveTo(x, y);
    builder.lineTo(x + 0.002, y);
    shown++;
  }
  const path = builder.detach();
  if (shown === 0) return;
  resources.introSparkStroke.setStrokeWidth(0.013);
  resources.introSparkStroke.setAlphaf(0.9);
  canvas.drawPath(path, resources.introSparkStroke);
}

/** A band piece: `strands` parallel lines along a polyline of points (x, y pairs), with cross-ticks. */
function appendBandPiece(builder: PathBuilder, points: number[], strands: number) {
  'worklet';
  for (let strand = 0; strand < strands; strand++) {
    const across = (strand - (strands - 1) / 2) * 0.025;
    for (let index = 0; index + 3 < points.length; index += 2) {
      const alongX = points[index + 2] - points[index];
      const alongY = points[index + 3] - points[index + 1];
      const length = Math.max(1e-4, Math.hypot(alongX, alongY));
      const normalX = (-alongY / length) * across;
      const normalY = (alongX / length) * across;
      builder.moveTo(points[index] + normalX, points[index + 1] + normalY);
      builder.lineTo(points[index + 2] + normalX, points[index + 3] + normalY);
      if (strand === 0) {
        for (let tick = 1; tick < 4; tick++) {
          const x = points[index] + (alongX * tick) / 4;
          const y = points[index + 1] + (alongY * tick) / 4;
          builder.moveTo(x - normalX * 2, y - normalY * 2);
          builder.lineTo(x + normalX * 2, y + normalY * 2);
        }
      }
    }
  }
}

/** Band pieces appearing in place: a bent ladder chevron at the lower left, a hooked "7" at the top, chips on the right. */
function appendBandPieces(builder: PathBuilder, intro: number) {
  'worklet';
  if (intro >= 0.19) appendBandPiece(builder, [-1.05, 0.5, -0.82, 0.86, -0.42, 0.7], 3);
  if (intro >= 0.21) appendBandPiece(builder, [-0.05, -1.04, 0.36, -1.02, 0.3, -0.82], 2);
  if (intro >= 0.23) appendBandPiece(builder, [0.84, 0.28, 1.0, 0.3], 3);
  if (intro >= 0.25) appendBandPiece(builder, [0.8, 0.9, 0.98, 0.84], 2);
}

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
      band.moveTo(0.45 + Math.cos(angleFrom) * 0.55, 0.05 + Math.sin(angleFrom) * 0.92);
      band.lineTo(0.45 + Math.cos(angleTo) * 0.55, 0.05 + Math.sin(angleTo) * 0.92);
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
    spokes.moveTo(startX, startY);
    spokes.lineTo(startX + (0.4 - startX) * reach, startY - startY * reach);
  }
}

/** A point on the tilted equatorial ellipse (1.2R × 0.7R about (+0.14R, -0.1R), major axis rising 28°), shrunk by `inset`. */
function equatorialPoint(angle: number, inset: number, out: number[]) {
  'worklet';
  const along = Math.cos(angle) * (1.2 - inset);
  const across = Math.sin(angle) * (0.7 - inset);
  out[0] = 0.14 + along * EQUATOR_TILT_COS - across * EQUATOR_TILT_SIN;
  out[1] = -0.1 + along * EQUATOR_TILT_SIN + across * EQUATOR_TILT_COS;
}

/**
 * The tilted equatorial ladder ring: two thin glowing rails 0.07R apart with cross-ticks every
 * three degrees and loose fragments alongside (`rails` takes the rails, ticks and fragments,
 * `body` the line down the middle that carries the glow), sweeping in from the lower left along
 * the front of the sphere and up its right side — the film's ring is never drawn behind — and
 * then dropping out piece by piece, the far end first (f58-f78).
 */
function appendEquatorialRing(rails: PathBuilder, body: PathBuilder, intro: number) {
  'worklet';
  const reach = smooth01((intro - 0.62) / 0.15);
  const fadeOut = smooth01((intro - 0.84) / 0.12);
  const steps = Math.floor(64 * reach);
  const point = [0, 0];
  for (let step = 0; step < steps; step++) {
    if (hashInteger(step * 29 + 5) * 0.75 + (step / 64) * 0.25 < fadeOut) continue;
    const angle = (165 - step * 3) * DEGREES_TO_RADIANS;
    const end = angle - 2.6 * DEGREES_TO_RADIANS;
    for (let rail = 0; rail < 2; rail++) {
      equatorialPoint(angle, rail * 0.07, point);
      rails.moveTo(point[0], point[1]);
      equatorialPoint(end, rail * 0.07, point);
      rails.lineTo(point[0], point[1]);
    }
    // a cross-tick between the rails, and now and then a loose fragment outside them
    equatorialPoint(angle, 0, point);
    rails.moveTo(point[0], point[1]);
    equatorialPoint(angle, 0.07, point);
    rails.lineTo(point[0], point[1]);
    const loose = hashInteger(step * 53 + 17);
    if (loose < 0.22) {
      equatorialPoint(angle, -0.035 - 0.07 * loose, point);
      rails.moveTo(point[0], point[1]);
      equatorialPoint(end - 2 * DEGREES_TO_RADIANS, -0.035 - 0.07 * loose, point);
      rails.lineTo(point[0], point[1]);
    }
    // the band itself, down the middle between the rails
    equatorialPoint(angle, 0.035, point);
    body.moveTo(point[0], point[1]);
    equatorialPoint(end, 0.035, point);
    body.lineTo(point[0], point[1]);
  }
}

/** Everything that only exists while the hologram materialises (keyframe time below 1). */
function drawIntro(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const intro = state.intro;
  if (intro >= 1) return;
  drawIntroSparks(canvas, resources, scene, intro, state.time);
  const builders = resources.pathBuilders;
  const piecesAlpha = smooth01((intro - 0.19) / 0.02) * (1 - smooth01((intro - 0.3) / 0.15));
  if (piecesAlpha > 0) appendBandPieces(builders.introBand, intro);
  const bandPath = builders.introBand.detach();
  if (piecesAlpha > 0) {
    resources.introBandStroke.setStrokeWidth(0.01);
    resources.introBandStroke.setAlphaf(0.9 * piecesAlpha);
    canvas.drawPath(bandPath, resources.introBandStroke);
  }
  // the dial snaps on within two film frames and stays lit until its chips are gone
  const dialAlpha = smooth01((intro - 0.26) / 0.03);
  if (dialAlpha > 0 && intro < 0.91) {
    appendDial(builders.introBand, builders.introInner, builders.introSpokes, intro, state.time);
    const brighten = 0.65 + 0.35 * smooth01((intro - 0.27) / 0.22);
    const dialPath = builders.introBand.detach();
    const dialInnerPath = builders.introInner.detach();
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
    canvas.drawPath(builders.introSpokes.detach(), resources.introSpokeStroke);
  }
  if (intro >= 0.62 && intro < 0.97) {
    // rails and fine ticks over a glowing band, as the film's is
    appendEquatorialRing(builders.introBand, builders.introSpokes, intro);
    const ringAlpha = smooth01((intro - 0.62) / 0.02);
    const railPath = builders.introBand.detach();
    const bandBodyPath = builders.introSpokes.detach();
    resources.introGlowStroke.setStrokeWidth(0.14);
    resources.introGlowStroke.setAlphaf(0.3 * ringAlpha);
    canvas.drawPath(bandBodyPath, resources.introGlowStroke);
    resources.introBandStroke.setStrokeWidth(0.066);
    resources.introBandStroke.setAlphaf(0.42 * ringAlpha);
    canvas.drawPath(bandBodyPath, resources.introBandStroke);
    resources.introBandStroke.setStrokeWidth(0.01);
    resources.introBandStroke.setAlphaf(0.95 * ringAlpha);
    canvas.drawPath(railPath, resources.introBandStroke);
    resources.introBandCoreStroke.setStrokeWidth(0.005);
    resources.introBandCoreStroke.setAlphaf(0.6 * ringAlpha);
    canvas.drawPath(railPath, resources.introBandCoreStroke);
  }
}

/** Draws one frame of the hologram into a size×size square. */
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
  for (let i = 0; i < allPathBuilders.length; i++) allPathBuilders[i].reset();

  const state = analyseFrame(frame, size, scene);
  canvas.save();
  canvas.translate(size / 2, size / 2);
  canvas.scale(state.radius, state.radius);
  drawVolumeFill(canvas, resources, scene, state);
  drawInnerShells(canvas, resources, state);
  drawBody(canvas, resources, scene, state);
  drawLines(canvas, resources, scene, state);
  drawCore(canvas, resources, state);
  drawBodyHighlights(canvas, resources, scene, state);
  drawThinRing(canvas, resources, state);
  drawTruss(canvas, resources, scene, state);
  drawCrescent(canvas, resources, scene, state);
  drawFray(canvas, resources, scene, state);
  drawProtrusions(canvas, resources, state);
  drawChips(canvas, resources, state);
  drawAccents(canvas, resources, state);
  drawIntro(canvas, resources, scene, state);
  canvas.restore();
}
