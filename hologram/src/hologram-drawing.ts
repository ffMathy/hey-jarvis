// The J.A.R.V.I.S. hologram: the copper-orange sphere of light that stands in for Tony Stark's AI. This is
// what he is made of — the seeded scene, the paths that never change — and what each frame of him
// is (analyseFrame); the GPU draws him from it, his body in `gpu/gpu-body.ts` and every layer under
// it in `gpu/gpu-picture.ts`, whose draw functions carry the layers' names.
//
// WHAT IT DEPICTS
// A hybrid of two films' J.A.R.V.I.S., at the user's asking. Vision Quest, close up in the scene where
// he dies, leads what he is made of: the ring, the shell, the cage and the bloom below. Avengers: Age
// of Ultron, the lab scene the drawing was first made from, leads his colour and gives four parts:
// - its red-orange: its close-ups measure a weighted hue of 26°, saturation 0.59, R:G:B
//   1:0.69:0.43, median (160,98,54) and hottest pixels (253,223,193), never white;
// - its soft swirl: one broad, mid-toned sweep of strands through his middle, at about 0.3-0.63R,
//   never a white S;
// - its small ringed eye at the core: two nested rings at 0.05-0.06R and 0.09-0.11R round a darker
//   hole, never white;
// - its gyroscope: bundles of 2-5 thin parallel strands on arcs round the core, ring light at
//   0.50-0.60R over about half the clock and an arc at 0.67-0.7R;
// and its ladder's boxes are open. Measured on 26 frames of Vision Quest, with S the outer edge of
// his shell of specks (about 0.88R here), that film shows:
// - a white-hot thin ring round his core at about 0.4 S, the brightest thing in him, round a glowing
//   disc a little less bright than the ring, with faint marks across it;
// - a shell of fine glittering specks from about 0.5 S to S, points and short dashes, pale gold to
//   white. Seen face on it is a bright beaded donut, brightest near its outer edge, with a darker,
//   see-through band between it and the core's ring;
// - a loose angular wireframe of straight hairlines between nodes, making jagged triangles and
//   polylines. It wraps the shell out to 1.5-1.8 S, is densest at the upper right and trails a tail
//   downward, and it flickers from frame to frame while the whole holds its shape;
// - embers: tiny golden flecks drifting in the space round him, some of them streaked;
// - bloom round all of it, falling from luma 150 at S to about half that by 2.4 S;
// - colour from white-hot through pale gold and gold to deep amber: its hottest pixels are
//   (255,229,174), its 95th percentile (245,198,132), its 90th (234,180,111), its median (178,105,32).
//   The drawing takes Age of Ultron's redder colour instead: over idle and speaking at 400 px it
//   measures a weighted hue of about 30°, saturation 0.64, R:G:B 1:0.71:0.38, its hottest pixels
//   orange-white rather than white, and his middle the palest of him and his edge the reddest;
// - and calm: about 6 luma of change per film frame over 256 px.
// The drawing keeps all of him inside his square, whose edge is about 1.85R from his middle at rest,
// so its wireframe and its bloom stop shorter than the film's. Elsewhere it departs from the film
// only where the user asked it to: see WHAT THE USER ASKED FOR below. The biggest departure is his
// body: the film's hollow shell is filled with specks as the old body was, at the user's asking.
//
// LAYERS, back to front (unit space, R = 1, y down; clock angles in degrees clockwise from 12 o'clock)
//   drawAura          the film's bloom: a soft warm band round him, see-through inside AURA_INNER,
//                     brightest on the shell's edge and gone by AURA_OUTER. It is painted as a band,
//                     so the middle of him is never filled.
//   drawCore          the core: a glow, mostly see-through, round the white-hot ring at
//                     CORE_RING_RADIUS; Age of Ultron's small ringed eye inside it, a hooked ring at
//                     0.1R round a ring at 0.06R, and a faint bar across it (staticPathsOf); and the
//                     ring itself, nested strokes up to an orange-white line, its brighter stretches
//                     rolling round it.
//   drawCage          the wireframe (buildCage): hairlines between seeded nodes round the shell of
//                     specks, longer lines further out and a few trailing away below him. It is in
//                     three dimensions and turns with the body, and each edge twinkles on its own slow
//                     clock.
//   drawTruss         the old rim's ladder truss (buildTruss), at the user's asking: a hot outer rail
//                     at TRUSS_OUTER_RAIL and a finer inner one at TRUSS_INNER_RAIL, rungs about
//                     every 9° making its boxes, open as Age of Ultron's ladder is with only a trace
//                     of glow in them, circuit traces and pairs of short struts hanging inward, along
//                     about 190° of his edge in three stretches. Recoloured into the cage's pale
//                     orange, always there, and rolling clockwise in the plane of the view on its own
//                     clock (RIM_ROLL_DEGREES_PER_SECOND).
//   drawEmbers        the embers (buildEmbers): flecks drifting out from the shell's edge and a little
//                     upward, each on its own clock, some of them streaked.
//   drawFray          while he talks: strands fraying off the upper left of the shell's edge, streak
//                     arcs a little further out, and streaks slipping out of its right.
//   drawChips         the latest burst's chips: shards of light thrown off the left of the shell's
//                     edge on a syllable, each a streak and two splinters with white-hot cores,
//                     which snap and thin away as they break up rather than fade.
//   drawThinkingPulse while he thinks: a ring blooming out of the core's ring as each pass of the scan
//                     plane ends.
//   drawSatellites    the agents at work for him, circling him (`satellite-drawing.ts`). The headset
//                     draws its own in the room instead.
//   (the body)        over all of it, on the GPU in three dimensions (`hologram/gpu`): up to
//                     PARTICLE_COUNT specks: the old body's whorl, two soft spiral arms of specks
//                     held in the view plane and winding out of the core from 0.1R, Age of Ultron's
//                     swirl (pushWhorlSpeck); its gyroscope, strands of specks on arcs at 0.53R and
//                     0.67R round the core, held in the view plane with the whorl (pushGyroSpeck); a
//                     fill through the ball as the old body's was; and the film's shell from about
//                     half his radius out (buildBody). Each tier has a soft halo of its own, and the
//                     stream, specks below the core turning on a clock of their own (buildStream).
//                     The scene's body and stream
//                     tables, and the per-fragment helpers below (readFragment, placeFragment,
//                     swirlFragment, latticeFragment and the rest), are what it is drawn from and
//                     held to.
//
// IDLE MOTION (nothing breathes, pulses or flickers as a whole)
// - The body turns about the vertical axis like a globe (BODY_RADIANS_PER_SECOND), and the cage turns
//   with it. The whorl's specks ride an inner layer instead, held in the plane of the view and
//   counter-turning about the core (SHELL_DEGREES_PER_SECOND), so the spiral stays a spiral. The
//   stream turns about the vertical on its own clock (STREAM_RADIANS_PER_SECOND), so its front drifts
//   right and its dimmer back drifts left: counter-streams through the bottom of the shell.
// - Every speck lives on its own clock. It grows out of nothing and shrinks back into it over a third
//   of the time it is lit, and re-lights a little along or across from where it was. The clocks run
//   slower than the film's on purpose (pickFragmentRate): at the film's rate the phone read as a
//   sizzle.
// - The core ring's brighter stretches roll clockwise round it (ROLL_DEGREES_PER_SECOND), and the
//   core's brightness drifts a few percent over many seconds. It never beats.
// - Each edge of the cage twinkles on its own slow clock, and each ember drifts out on its own.
// - The truss rolls clockwise round his edge in the plane of the view (RIM_ROLL_DEGREES_PER_SECOND).
// - Nothing is scheduled: no loop decides what shows or when.
//
// HOW THE FRAME DRIVES IT (see analyseFrame). The film's sphere holds its brightness and its size
// while he talks and shows speech as activity, and so does this one, except for the swell and the
// tenth of a glow the user asked for.
//   time        drives every clock above. Every rate is fixed, so nothing depends on level × time
//               and nothing jumps.
//   level       his loudness, eased: most of the swell (SWELL_WITH_VOICE) and part of the glow
//               (GLOW_WITH_VOICE), so he breathes with the sentence.
//   bands       the low ones bring more of the embers out and the high ones more of the fray, so the
//               picture answers low and high notes differently.
//   speaking    unused: agitation already says whether he is talking, and a flag that flips within
//               one frame would make the sphere jump.
//   agitation   held back until the vortex has all but formed him (appearance 0.6-1), then:
//               - mix: calm specks hand over to fast ones, half of them and no more, so the count
//                 lit and the brightness hold while the churn rises;
//               - each speck re-lights further along the way it lies, less so the nearer the limb
//                 it is, so the silhouette holds;
//               - hotShare: some of the bright specks step down, and the hot cores all but go;
//               - the fray, and more of the embers;
//               - the rest of the swell and of the glow.
//   burstAge, burstStrength, burstCount
//               the chips, drawn while burstAge is under CHIP_GONE_SECONDS and fully lit for
//               CHIP_HOLD_SECONDS. The strength says how far they go and how many there are, and the
//               count where they leave from. Bursts come in flurries with rests between them: the
//               tracker's rule (`voice-levels.ts`).
//   appearance  0-1 over MATERIALISE_SECONDS: the vortex. The specks leave the core on their own
//               clocks, nearest first, spiralling out a turn and a half as streaks before they settle
//               (swirlFragment). The core shows first, and the aura, the cage, the truss and the embers are
//               carried out with the shell (shellReach) rather than drawn round a ball that is not
//               there yet. It moves only the specks already being drawn, so the scene's count and the
//               density share hold throughout.
//   presence    0-1, and 1 unless he is leaving: he fades and shrinks to LEAVING_SMALLEST, without
//               the vortex running backwards.
//   thinking    a plane sweeps up through him (SCAN_SECONDS), lighting what it passes, and a ring
//               blooms out of the core at the end of each pass. Everything but the core's ring
//               recedes.
//   hearing, hearingLevel
//               someone is talking to him: the specks snap onto a slowly turning hexagonal lattice
//               that breathes with their voice (latticeFragment), and the core's glow dims so the
//               lattice is what is seen.
//
// WHAT THE USER ASKED FOR
// The films lead the look, but where the user has asked for something, that wins. Each request is
// written up where it is made, and a change must keep them all:
// - Dense, as the old body was. The film's hollow shell left a dark donut round the core, and the
//   user preferred how packed the old body looked, so most of his specks fill the ball again
//   (BODY_FILL_SHARE), in the old body's wider strokes, copper and orange tiers and broad halos, and
//   his middle is dimmed only a little (SHELL_FACE_DIMMING). The film's shell still lies round them,
//   so his edge is the brightest of him, and its orange and orange-white highlights stay.
// - Reddish, not yellow: "The light is also too yellow - I liked the old reddish tint." Every paint
//   is Age of Ultron's copper and red-orange (`gpu/body-strokes.ts`, `gpu/halo-union.ts`,
//   `gpu/gpu-picture.ts`, `gpu/picture-gradients.ts`), and white-hot is an orange-white. Over idle and
//   speaking at 400 px his weighted hue is 30.3° (it was 37.6°), G/R 0.71 (0.82), and near-white
//   is 1.1% of his light (6.8%): his hottest pixels are orange-white, never pure white.
// - The spiral is soft: "The spiral is too sharp." The whorl is Age of Ultron's broad, mid-toned
//   swirl of strands (pushWhorlSpeck), from just outside the core's eye: along its arms it measures
//   a mean luma of 201 (it was 234), 1.33 times the gaps between them (1.45), and at most 9%
//   of its centre line is white in any band, where 84-94% was inside the core's ring. It is still a
//   spiral, plainly, at phone size: soften it, never lose it.
// - Nothing but particles fills him. A textured haze used to lie under everything, and it went at the
//   user's asking ("I just want the particles to speak for themselves"). The aura is a band and the
//   core's glow mostly see-through for the same reason. Do not paint a volume back in: the density
//   is the specks'.
// - No protrusions. A script once stood truss booms, ribbon loops, hook tendrils, streak bundles and
//   pole fans off his limb, one per epoch. On a phone, where he is small and the loop came round every
//   minute, they read as an arm swinging out of the ball in the same pattern. Nothing grows out of him
//   and dissolves: the cage is always there, and calm.
// - The squares round his edge stay: "I'd also like to still have the weird squares near the edge
//   of the hologram". The old rim's ladder truss is drawn always (drawTruss), in the cage's palette,
//   between TRUSS_INNER_RAIL and TRUSS_OUTER_RAIL, so it never stands off him. The script that once
//   chose between it, a crescent and a thin ring is gone, and so are those two.
// - He arrives as a vortex out of his core and in no other way. The film's point of light, sparks and
//   spoked dial are gone at the user's asking, and nothing flashes as he forms: no one frame may turn
//   a tenth of his light on at once.
// - PARTICLE_COUNT stays a ceiling of ten thousand: at fifteen thousand he read as a mass.
// - Calm: "overwhelming calm and compute power", never a sizzle. The specks' clocks are slower than
//   the film's (pickFragmentRate), and every twinkle is slow.
// - His glow answers his voice by a tenth (GLOW_WITH_VOICE), a number asked for in both directions
//   six times. Speech shows as movement.
// - He swells with his voice (SWELL_WITH_VOICE), and his body turns like a globe
//   (BODY_RADIANS_PER_SECOND), both asked for over the film.
// - Listening is the lattice (LATTICE_SPACING), chosen from five candidates, and thinking is the scan
//   plane (SCAN_SECONDS), asked to be "something completely different".
// - A speck reads as a line, not a bead: the median one is at least five times as long as it is wide
//   (pickFragmentLength).
//
// PERFORMANCE AND WORKLET RULES
// - analyseFrame and every per-fragment helper are worklets ('worklet' directive) that use only
//   their arguments and module-level number constants: no module-level mutable state, no closures
//   over outer values, no Math.random in a frame. Randomness comes from the seeded scene, and
//   per-cycle variation from an integer hash (in the shaders, as it was here).
// - The body's per-frame arithmetic is written three times: in the helpers here, in its CPU reference
//   (`gpu/fragment-3d.ts`) and in GLSL (`gpu/fragment-glsl.ts`), and `gpu/fragment-3d.spec.ts`
//   composes a fourth copy from the helpers. A change to one is a change to all of them. A change to
//   the scene's data needs none.
// - The scene is flat number arrays — about ninety thousand numbers at PARTICLE_COUNT, nine to a body
//   row — laid out into the GPU's tables once, when the view mounts. The sparkle texture is built
//   from a seed rather than carried in the scene. It is small (64²) and built from an integer hash
//   of each texel, because this runs on the JS thread at every mount, on a phone, under an
//   interpreter with no JIT.
// - Every paint is Screen, so faint overlapping strokes add up like light: glow comes from nested
//   strokes, gradients, the halos and the prebuilt texture, with no blur. It is drawn over black.
// - A gradient that is transparent over most of the disc is painted as a band, not a disc (see
//   AURA_INNER), which keeps the widest paints affordable.
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
  /** 0–1 arrival progress, 1 = fully here: the view passes min(1, time / MATERIALISE_SECONDS). */
  appearance: number;
  /**
   * 0–1: how much of him is here at all. 1 unless he is leaving.
   *
   * Kept apart from {@link appearance} so the view can send him away without rewinding the clock
   * that arrival is counted on: leaving fades and shrinks the whole sphere, rather than running
   * the vortex backwards.
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
  /**
   * 0–1: how sure he is that someone is talking to him — ElevenLabs' voice-activity score, eased.
   * Left out, nobody is. See {@link latticeFragment}: his particles snap onto a slowly turning
   * hexagonal lattice while someone is speaking.
   */
  hearing?: number;
  /** 0–1: how loud they are, eased. Only read while {@link hearing} is above nothing. */
  hearingLevel?: number;
}

/**
 * Sphere radius as a fraction of the square, at rest.
 *
 * Small, and it does not mean what it looks like it means. The square is not the screen: the view
 * makes it half again wider (see `useWholeScreenHologramSize`), so this fraction times that is a
 * sphere about 0.6 of the screen across — which is what you actually see.
 *
 * The room is for what lies round him and what leaves him: the cage, the aura and the embers round
 * his shell of specks, and the fray and the chips he throws off it while he talks, with the sphere
 * swollen by up to SWELL_WITH_VOICE as he does. A square cut close round the sphere clips them in
 * mid-air. It once left 1.56R round the middle, and the user saw exactly that: "some of the
 * particles that flow outwards are clipped ... its particles should be able to extend further out
 * without being clipped." At this fraction it leaves about 1.85R, and nothing he draws reaches its
 * edge.
 *
 * Paying for that in canvas rather than in sphere is deliberate, and it is nearly free: the GPU
 * only shades what is drawn, and the drawn things are all sized from the sphere. What the extra
 * square costs is the canvas it is cleared on, not the picture painted into it.
 */
export const SPHERE_FRACTION = 0.27;
/**
 * The white-hot core ring's brighter stretches roll clockwise round it: one turn in about 33 s, the
 * rate the rim's ladder ring rolled at before the Vision footage replaced it, which the headset's
 * coronas still roll their ticks at.
 */
export const ROLL_DEGREES_PER_SECOND = 11;
/**
 * The inner layer turns the other way, about the core in the plane of the view: the whorl's
 * specks ride it, held in that plane (see buildBody), so the spiral through his middle drifts
 * against the globe's turn. It winds up as the vortex brings him out (`shellTurn` in
 * analyseFrame). The Age of Ultron footage measured its inner layer at -1.6 to -5.4°/s.
 */
export const SHELL_DEGREES_PER_SECOND = -5;
/** The lower hemisphere's equatorial shell turns about the vertical axis, which reads as a sideways stream. */
export const STREAM_RADIANS_PER_SECOND = 0.21;
/**
 * The body turns about the vertical axis, like a globe.
 *
 * The film's does not — its interior is measured at under 1-3°/s, and the drawing held it
 * pinned for that reason. On a phone it read as inert: the rim rolling round a still ball is
 * a much weaker cue than the ball itself turning, so the user asked for the constant rotation
 * the first hologram had back. This is that one's rate, 0.26 rad/s, a turn every 24 s.
 */
export const BODY_RADIANS_PER_SECOND = 0.26;
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
 * Back to the film, after a long way round. The Age of Ultron footage's sphere holds its brightness
 * to within about 3% through "Doctor." and shows speech as *behaviour*: fragments turning over
 * faster, its limb fraying, shards of light breaking off on syllable onsets. This
 * drawing pinned that, then departed from it — the user could not tell on a phone whether he was
 * talking, so a glow went in at 0.3, and then 0.8, 2.4, 1.6, 1.1 and 1.35 as each version was seen
 * on a real screen. With the sphere now most of the screen wide and the sparks drawn out into
 * lines, the movement reads on its own, and the user has asked for the brightening gone: "the glow
 * of the sparks shouldn't increase. Just their positions outwards as it is today."
 *
 * It was set to 0 first, which is the film exactly, and the user then asked for a tenth back — so
 * what is here is a hint rather than a signal, under the few percent the film itself varies by.
 * The rest of what speech does is untouched by it: the swell, the fray, the embers, the chips and
 * the churn are all movement, and movement is what says he is talking.
 *
 * It is a number rather than a deleted mechanism precisely because it has been asked for in both
 * directions six times. Raising it is one edit.
 */
export const GLOW_WITH_VOICE = 0.1;
/** How much of the glow answers "is he talking at all" rather than "how loudly". */
export const GLOW_FROM_ENVELOPE = 0.65;
/**
 * How much bigger the whole sphere grows at full voice.
 *
 * The film's holds its radius to within 1%, and the drawing used to as well — a sphere that
 * swells with the voice was exactly the "level meter" the Age of Ultron film study warned against.
 * This is the user's call, after the glow alone still read as too quiet a signal on a phone: it
 * pulsates now.
 */
export const SWELL_WITH_VOICE = 0.18;
/** How small the sphere has shrunk to by the time he has gone. */
export const LEAVING_SMALLEST = 0.55;
/**
 * How he listens: while someone talks to him his particles snap onto a hexagonal lattice that turns
 * slowly inside the ball and breathes with their voice — a crystalline, working look that says
 * "listening" without resembling anything he does when he speaks.
 *
 * Chosen from five candidates rendered side by side: drifting clusters, orbital rings, ripples, a
 * galaxy's arms and this. It replaced a ring of ticks round the outside of the ball,
 * which read as a decoration rather than as him paying attention.
 *
 * This is how far apart the lattice's points are.
 */
export const LATTICE_SPACING = 0.11;
/** How fast the lattice turns, in radians a second. */
export const LATTICE_TURN = 0.12;
/** How much the lattice's spacing swells at full voice, and how quickly it breathes, in radians a second. */
export const LATTICE_BREATH = 0.18;
export const LATTICE_PULSE = 2.4;
/** How much of the way to their point the particles go at full attention: not quite all of it. */
export const LATTICE_PULL = 0.88;
/** How much shorter a stroke is drawn while it is on the lattice, so a point reads as a knot, not a smear. */
export const LATTICE_STROKE_SHRINK = 0.55;
/** How far round a fragment has still to go as it leaves the core in the vortex, in radians: a turn and a half. */
export const VORTEX_TWIST = 3 * Math.PI;
/** How long the vortex's strokes are drawn while they are still travelling, as a multiple of their length. */
export const VORTEX_STRETCH = 4;
const DEGREES_TO_RADIANS = 0.017453292519943295;
/** The core sits a hair up and left of centre, well inside the film's 0.08R. */
export const CORE_X = -0.02;
export const CORE_Y = -0.02;
/** How long a burst's chips stay fully lit, in seconds, and when the last of them has broken up and gone. */
export const CHIP_HOLD_SECONDS = 0.13;
export const CHIP_GONE_SECONDS = 0.2;
/**
 * Where the picture's layers leave his body, in R: the outer edge of the film's shell of specks
 * (0.88R, the film's S). The fray, the chips and the embers start from it, and the cage's anchors
 * reach down to it.
 */
export const PICTURE_SHELL_EDGE = 0.88;
/**
 * The white-hot ring round his core, in R from the core: the brightest thing in him, at about 0.4 of
 * the film's S. The thinking pulse blooms out of it.
 */
export const CORE_RING_RADIUS = 0.35;

// Strides of the flat scene tables (the builders describe the fields).
export const BODY_STRIDE = 9;
export const STREAM_STRIDE = 10;
/** Where a body row and a stream row keep the fragment's id, which the density share is taken over. */
export const BODY_ID_FIELD = 6;
export const STREAM_ID_FIELD = 7;

export const FRAY_STRIDE = 5;
export const STREAK_ARC_STRIDE = 6;
export const LIMB_STREAK_STRIDE = 5;
export const CAGE_EDGE_STRIDE = 10;
export const EMBER_STRIDE = 7;
export const TRUSS_PIECE_STRIDE = 4;
/**
 * The ladder truss round his edge (buildTruss, `drawTruss`): its hot outer rail and its finer inner
 * one, in R, with the rungs across between them making its boxes. Everything of it lies between the
 * two but the struts, which hang a little inward from the inner rail over his edge: nothing of it
 * stands off him, so it never reads as something growing out of him.
 */
export const TRUSS_OUTER_RAIL = 1.035;
export const TRUSS_INNER_RAIL = 0.935;
/**
 * The truss rolls clockwise in the plane of the view on a clock of its own, `rimRoll`: one turn in
 * about 33 s, the rate it rolled at before the Vision footage replaced it, and the core ring's.
 */
export const RIM_ROLL_DEGREES_PER_SECOND = 11;
/** Side of the tiled sparkle texture in texels, and how wide a texel is on the sphere: a stroke spans about two. */
export const SPARKLE_TEXTURE_TEXELS = 64;
export const SPARKLE_TEXEL_SIZE = 0.018;
/** What the scene's texture seed is mixed with to seed the sparkle, here and on the GPU (`gpu/sparkle.ts`). */
export const SPARKLE_SEED_MIX = 0x2545f491;

/**
 * The aura: the film's bloom, a soft warm band of light round him, see-through inside AURA_INNER,
 * at its brightest on the shell's edge and gone by AURA_OUTER, in R from his centre. It is not a
 * filled volume — the middle stays see-through between his light, as the user asked ("I just want
 * the particles to speak for themselves") — and it ends well inside his square, whose edge is about
 * 1.8R away: the film's own bloom runs on past twice his radius, which a phone's screen has no
 * room for.
 *
 * It is painted as a band rather than a disc. A gradient that is transparent over the middle still
 * shades every pixel of a filled disc and blends nothing over it, which on the widest layer in the
 * picture is a large share of the frame for nothing; a stroked circle covering just the radii the
 * gradient lights draws exactly the same pixels. The limb bloom this replaced measured that: not
 * one channel of one pixel differed, and the frame was 8% cheaper.
 */
export const AURA_INNER = 0.45;
export const AURA_OUTER = 1.56;
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
export const SCAN_SECONDS = 2.6;
/** How wide the lit band is, in sphere radii: a quarter of him at a time. */
export const SCAN_HALF_WIDTH = 0.38;
/** What is left of a fragment the plane is nowhere near. Not zero: he is thinking, not gone. */
export const SCAN_FLOOR = 0.12;
/** How near the middle of the band a fragment has to be to be lit to the bright tier. */
export const SCAN_BRIGHT_NEARNESS = 0.55;
/** How long the ring takes to bloom from the core to past the limb, at the end of each pass. */
export const PULSE_SECONDS = 0.55;

/** A fragment is lit for this share of its clock's cycle, fading in and out over a third of that at each end. */
export const FRAGMENT_DUTY = 0.6;
/**
 * A body fragment's code holds its class — brightness (0-2) + 3 × pool + 6 × rides the turning
 * shell, so 0 to 11 — and its glyph above that, at this step. See {@link buildBody} for why the
 * two share a number.
 */
export const FRAGMENT_CODE_GLYPH_STEP = 12;
/**
 * How many fragments the body has when the phone can afford all of them.
 *
 * A ceiling rather than a count: what is actually drawn is whatever share of these the phone can
 * hold the target frame rate with, worked out while it draws them — see `density-control.ts`. So
 * this is not "how many particles Jarvis has", it is "how many he is allowed on a phone fast
 * enough", and raising it costs nothing on a phone that was already at its limit.
 *
 * It was 1000, which was the answer to a different question: back when the count was fixed, it had
 * to be one a mid-range phone could manage. Since the loop finds each phone's own number, the only
 * thing a low ceiling does is stop a fast phone from looking as good as it could — and the user's
 * did, drawing 988 of the thousand while pinned at the cap, which was sixty at the time. The cap is
 * forty now, so there is more room again rather than less.
 *
 * Raised to five thousand on that reasoning, and to ten thousand on the same reasoning again: a
 * phone that settles just under the ceiling is a phone the ceiling is answering for, and the only
 * way to find out what it could actually hold is to stop answering. A phone that cannot is
 * unaffected — it settles at its own number, wherever that is, and pays only the scene cost below.
 *
 * **Fifteen thousand was tried first and the user said it was too much**, which is the answer this
 * number exists to take: the loop can find what a phone affords, but not what looks right, and at
 * fifteen the swarm reads as a mass rather than as particles. Ten is the ceiling the picture wants
 * rather than the one the hardware allows, and those are different questions.
 *
 * What it costs on every phone, fast or slow, is the scene: this many fragments times
 * {@link BODY_STRIDE} numbers, built and laid out as the GPU's rows when the view mounts. That is
 * the only part of raising it that nobody can opt out of, and it is worth knowing the size of it:
 * 90,000 numbers. On a desktop under V8, `createHologramScene` builds them in about 22 ms once warm
 * (about 43 on a first, cold call), and `buildHologramRows` and `buildRowVertices` lay them out as
 * the GPU's rows in about 10 more (23 cold); JavaScriptCore is a little quicker. With the JIT turned
 * off, the nearest that desktop comes to the Hermes a phone runs, the scene takes about 110 ms and
 * its rows 35, in either engine. Hermes itself has not been run on this scene. The one before the
 * redesign took about 70 ms to build under a Hermes compiled ahead of time the way React Native
 * ships it, on a desktop where V8 built it in about 20 once warm; on this one V8 took about 24 to
 * build it once warm, and with the JIT off 140 to build it and 60 to lay out its rows. Over a third
 * of the time without a JIT is the two hundred thousand draws from the seeded generator — the body
 * turns one candidate in two away, each after five or six draws — and every draw is part of what
 * the seed builds, so that is the floor for as long as the scene stays the same. A phone is some
 * multiple of all of it. It lands as a hitch when the view mounts rather than as a frame rate, so
 * the controller below cannot thin it away — this is the number to look at first if the arrival
 * ever starts feeling late.
 *
 * {@link FEWEST_PARTICLES} in `density-control.ts` is a share of this, so it moves when this does.
 */
export const PARTICLE_COUNT = 10000;

/**
 * Turns a fragment's id into where it sits in the thinning, 0-1.
 *
 * Large, because an id is *already* a fraction — `buildBody` takes one straight from the random
 * source — so a multiplier under 1 leaves the product under 1 too, and the whole of it below the
 * share for every share above that multiplier. Which means no thinning at all until the share
 * falls past it, and the drawing looks untouched the whole way down. It is its own irrational
 * rather than the phase's, so which fragments are drawn does not correlate with when they light.
 */
const DENSITY_FROM_ID = 733.1357;

/**
 * The multiplier that turns a fragment's id into its blink phase. Any multiplier with a long
 * fractional part scatters a uniform id into a uniform phase; this one is far from every other
 * multiplier the id is hashed by, so no two of its uses line up.
 */
export const FRAGMENT_PHASE_FROM_ID = 37.9;
/**
 * How lit a fragment must be to be drawn at all. Below this it is a tenth of its length in a paint
 * that does not fade with it, so it costs a stroke and shows a dot. It is also how abruptly a
 * fragment arrives — its tier's paint is the same however lit it is, so a fragment cut off at this
 * strength appears at full colour, however short — and both of those matter: much higher and
 * every arrival is a step rather than a fade; much lower and the frame spends its strokes on ones
 * too short to see.
 */
export const FRAGMENT_FAINTEST = 0.1;
/**
 * How far from its place a fragment may re-light, in R, on top of the half-length it already
 * slides along itself. Getting on for two median fragment lengths: far enough that the stroke that goes
 * out and the one that comes on light different pixels — which is what the film's turnover
 * counts — and near enough that the mass, the clumping and the crowded left half stay put.
 */
export const FRAGMENT_WANDER = 0.06;

// ---- scene: random geometry, built once on the JS thread ---------------------------------

type Random = () => number;

/** A Mulberry32-style seeded generator: the same seed always builds the same hologram. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every number the scene holds is rounded so: it keeps the worklet copy of the scene small. */
function roundToFiveDecimals(value: number) {
  return Math.round(value * 1e5) / 1e5;
}

/**
 * Where the specks that are not the fill ({@link BODY_FILL_SHARE}) lie: on a shell rather than
 * through a ball. The film's sphere is a hollow of
 * fine glittering points, from about half his radius out to the edge of the speck shell, and seen
 * face on that shell is a bright beaded donut round a darker, see-through band and the core. A line
 * of sight near the edge runs through more of a shell than one through the middle does, so a shell
 * is brighter at its edge by projection alone, though only about twice as bright as its middle;
 * {@link SHELL_FACE_DIMMING} does the rest.
 *
 * A speck's distance from his centre is `SPECK_SHELL_OUTER − SPECK_SHELL_DEPTH · u^3.5` for a
 * uniform `u`, which puts nearly two in three of them in the outer fifth of the shell, where the
 * film's donut is brightest and its edge a crisp ring of beads, and leaves enough deeper in that the
 * band reaches in towards the core as the film's does rather than being a thin hoop. The outer edge
 * stays inside 0.871R, where the limb fade (full inside it, nothing past 0.94R) begins, so the fade
 * never eats the bright edge.
 */
const SPECK_SHELL_OUTER = 0.87;
/** How deep the speck shell is, in R: from 0.49R to its outer edge. */
const SPECK_SHELL_DEPTH = 0.38;
/** The inside of the speck shell, in R. */
const SPECK_SHELL_INNER = SPECK_SHELL_OUTER - SPECK_SHELL_DEPTH;
/** How sharply the specks gather toward the outside of the shell: the power the uniform draw is raised to. */
const SPECK_SHELL_GATHER = 3.5;
/**
 * What the scene's seed is mixed with to seed the body's own generator. The body draws from a
 * generator of its own so that its count and its rejection test, which decide how many randoms it
 * takes, cannot move anything the scene builds after it.
 */
const BODY_SEED_MIX = 0x3c6ef372;

/** A distance from his centre on the speck shell, `outer` at most. */
function pickShellRadius(random: Random, outer: number) {
  return outer - SPECK_SHELL_DEPTH * random() ** SPECK_SHELL_GATHER;
}

/**
 * The share of his specks that fill the ball, as the whole of the old body did, rather than lie on
 * the shell. The film's shell alone left a dark donut round the core, and the user liked the old
 * body's density better, so the two are fused: the fill packs his middle and the shell still rings
 * his edge with the brightest beads.
 */
const BODY_FILL_SHARE = 0.62;
/** How far out the fill reaches, seen face on, in R. */
const BODY_FILL_RADIUS = 0.92;
/** The share of the fill's specks that lie along the ring: the rest cross it any way, as the old body's circuit hatching did. */
const FILL_ALONG_THE_RING_SHARE = 0.3;
/** The share of the fill that is bright: the old body's. */
const FILL_BRIGHT_SHARE = 0.12;

/** A place on the speck shell — a direction uniform over the sphere at {@link pickShellRadius} — written into `out`. */
function pickShellPlace(random: Random, out: number[]) {
  // Its height (y, down) uniform in ±1, and any longitude.
  const height = random() * 2 - 1;
  const longitude = random() * Math.PI * 2;
  const radius = pickShellRadius(random, SPECK_SHELL_OUTER);
  const across = Math.sqrt(1 - height * height) * radius;
  out[0] = Math.cos(longitude) * across;
  out[1] = height * radius;
  out[2] = Math.sin(longitude) * across;
  out[3] = shellBrightShare(radius);
  out[4] = ALONG_THE_RING_SHARE;
}

/**
 * A place in the fill, written into `out`: even over his disc seen face on, as the old body was, and
 * anywhere through the ball behind and in front of that point, so it is as thick front to back as
 * it is across and turns as a ball rather than a coin.
 */
function pickFillPlace(random: Random, out: number[]) {
  const seen = Math.sqrt(random()) * BODY_FILL_RADIUS;
  const angle = random() * Math.PI * 2;
  out[0] = Math.cos(angle) * seen;
  out[1] = Math.sin(angle) * seen;
  out[2] = (random() * 2 - 1) * Math.sqrt(BODY_FILL_RADIUS * BODY_FILL_RADIUS - seen * seen);
  out[3] = FILL_BRIGHT_SHARE;
  out[4] = FILL_ALONG_THE_RING_SHARE;
}

/**
 * Where a body speck lies, in the fill ({@link BODY_FILL_SHARE} of them) or on the shell, written
 * into `out` as x, y, depth, the share of its kind that is bright, and the share that lies along
 * the ring.
 */
function pickBodyPlace(random: Random, out: number[]) {
  if (random() < BODY_FILL_SHARE) pickFillPlace(random, out);
  else pickShellPlace(random, out);
}

/**
 * How much of the shell's mass a spot keeps, by height (y down). The film's shell is close to even
 * all round, so this is mild: the lower half gives a little of its mass to the stream, which turns
 * there. It is by height alone because the body turns like a globe, so anything that told left
 * from right at rest would swing round to the front and the back of him in turn.
 */
function massWeight(y: number) {
  return y > 0.12 ? 0.82 : 1;
}

/**
 * Where the specks crowd: the film's shell is beaded, with brighter clumps and thinner stretches
 * between them rather than an even pepper. Waves in three dimensions, so a clump is a place on the
 * turning shell and not a column through him that would smear into a streak as he turns. Milder
 * than the old body's: a trough keeps over a quarter of its specks rather than none, so the beaded
 * band has thinner stretches but no holes through it.
 */
function clusterWeight(x: number, y: number, depth: number) {
  const waves =
    Math.sin(5.3 * x + 2.1 * depth + 1.7) * Math.sin(4.1 * y + 1.9 * x - 0.6) +
    0.6 * Math.sin(9.7 * y + 2.3 * x - 3.1 * depth + 0.4) +
    0.45 * Math.sin(13.1 * x - 7.3 * y + 8.9 * depth + 2.9);
  return Math.min(1, Math.max(0.28, 0.56 + 0.42 * waves));
}

/** The share of specks that lie along the ring through where they are seen, give or take 17°. */
const ALONG_THE_RING_SHARE = 0.7;

/**
 * Which way a speck lies, relative to the ring through where it is seen ({@link ringDirection}):
 * 0 is along it. The film's specks run round the shell like beads on a necklace, so most lie
 * within 17° of the ring, and the rest any way at all, so that the shell does not read as combed.
 */
function pickFragmentAngle(random: Random, alongShare: number) {
  if (random() < alongShare) return (random() + random() - 1) * 0.3;
  return random() * Math.PI;
}

/**
 * A speck's length: median 0.083R, 90th percentile 0.17R, and three in a hundred a streak up to 0.38R.
 *
 * The old body's, which the user liked for how packed it looked. The film's glitter is shorter, and
 * this body was briefly too, but its strokes are as wide as the old body's again (0.014-0.0155R),
 * and the user asked that a spark read as a line rather than as a bead: at this median a speck is
 * five times as long as it is wide, and at the film's it would be three. Its clock draws it out from
 * nothing and back, so most of what is lit at a moment is shorter still.
 */
function pickFragmentLength(random: Random) {
  if (random() < 0.03) return 0.18 + random() * 0.2;
  return 0.03 + 0.15 * random() ** 1.5;
}

/**
 * A speck's shape: 0 dash, 1 L, 2 bracket, 3 T, 4 Z, 5 tiny ring, 6 cell outline.
 *
 * Nine in ten are plain dashes: the film's shell is points and short dashes. The corners, brackets
 * and rings that read as circuitry stay as a seasoning, and the tiny rings, a few hundredths of a
 * radius across, read as the film's round beads.
 */
function pickGlyph(random: Random) {
  const roll = random();
  if (roll < 0.9) return 0;
  if (roll < 0.94) return 1;
  if (roll < 0.955) return 2;
  if (roll < 0.97) return 3;
  if (roll < 0.98) return 4;
  if (roll < 0.997) return 5;
  return 6;
}

/**
 * Brightness class: 0 dim, 1 mid, 2 bright (the bright ones are the white-hot highlights speech
 * thins out). `brightShare` of them are bright and two in five mid; every speck at the back of the
 * shell is drawn dim whatever its class ({@link BACK_OF_THE_SHELL}). Dim specks are faint, so the
 * more of them there are the more see-through the band is between the bright ones.
 */
function pickBrightness(random: Random, brightShare: number) {
  const roll = random();
  if (roll < brightShare) return 2;
  return roll < brightShare + 0.38 ? 1 : 0;
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
 * The longest a speck `radius` from his centre may be drawn and still stay inside the limb however
 * it hops: that distance is the furthest from his centre that turning can ever show it.
 */
function limbCap(radius: number) {
  return (1.02 - radius) / 1.1;
}

/** A speck's shape and how long it is, written into out[0] and out[1], no longer than {@link limbCap}. */
function pickGlyphAndLength(random: Random, radius: number, out: number[]) {
  const glyph = pickGlyph(random);
  out[0] = glyph;
  out[1] = Math.max(
    0.012,
    Math.min(glyph === 6 ? 0.04 + random() * 0.07 : pickFragmentLength(random), limbCap(radius)),
  );
}

/**
 * Stretches the speck `shape` holds by `stretch`, so it reads as a line, but never past
 * {@link limbCap} — unless it was already longer, as the shortest specks may be.
 */
function stretchSpeck(shape: number[], radius: number, stretch: number) {
  shape[1] = Math.min(shape[1] * stretch, Math.max(shape[1], limbCap(radius)));
}

/**
 * The share of a shell speck that is bright: deeper in the shell they are dimmer, from a twentieth
 * at its inside to three in ten at its edge, so the light gathers at his edge, as the film's does.
 * The fill is lit as the old body was instead ({@link FILL_BRIGHT_SHARE}).
 */
function shellBrightShare(radius: number) {
  return 0.05 + 0.25 * clamp01((radius - SPECK_SHELL_INNER) / SPECK_SHELL_DEPTH);
}

/** A body speck's brightness class: the crowded clumps carry the bright specks, and the rest are lit at `brightShare`. */
function pickBodyBrightness(random: Random, crowding: number, brightShare: number) {
  return crowding > 0.72 && random() < 0.4 ? 2 : pickBrightness(random, brightShare);
}

/**
 * Writes a body row: the place in `spot` (x, y, depth), the direction it lies relative to the ring
 * through where it is seen, the glyph and length in `shape`, and its own clock. A whorl row is on
 * the inner layer (`whorl` 6, see {@link ridesTheWhorl}).
 *
 * Rounded as each row is written rather than in a pass of its own once the table is built, as the
 * smaller tables are: over ninety thousand numbers, that pass and the second array it made were up
 * to a tenth of the scene's cost. The code is a whole number and needs no rounding.
 */
function pushBodyRow(
  random: Random,
  body: number[],
  spot: number[],
  unitX: number,
  unitY: number,
  shape: number[],
  brightness: number,
  whorl = 0,
) {
  const pool = random() < 1 / 3 ? 1 : 0;
  const rate = pickFragmentRate(random, pool);
  const id = random();
  body.push(
    roundToFiveDecimals(spot[0]),
    roundToFiveDecimals(spot[1]),
    roundToFiveDecimals(unitX),
    roundToFiveDecimals(unitY),
    roundToFiveDecimals(shape[1]),
    roundToFiveDecimals(rate),
    roundToFiveDecimals(id),
    brightness + 3 * pool + whorl + FRAGMENT_CODE_GLYPH_STEP * shape[0],
    roundToFiveDecimals(spot[2]),
  );
}

/**
 * The whorl: the old body's spiral through his middle, two arms winding out of the core, which the
 * user liked and asked to have back made of specks rather than painted. A share of the body's draws
 * ({@link WHORL_SHARE}; about 36% of its rows, since a draw for the fill or the shell is kept only
 * about half the time and one for the whorl always) lie along the arms, held in the plane of the
 * view and turning about the core with the inner layer ({@link SHELL_DEGREES_PER_SECOND}), so the
 * arms stay arms whichever way the globe has turned.
 *
 * It is Age of Ultron's soft swirl, at the user's asking ("the spiral is too sharp"): one broad,
 * mid-toned sweep made of strands, never white. Its arms stood 1.45 times as bright as the gaps
 * between them and clipped to white in a tight S inside the core's ring, because their specks
 * crowded the core, three in ten were bright, and the arm was narrowest there. Now the arms start
 * outside the core's eye, their specks are spread evenly along them, few are bright and those keep
 * to the arm's centre line, and the arm is broader, with a soft skirt round it.
 */
const WHORL_SHARE = 0.22;
/** The share of the whorl's specks on an arm's centre line that are bright, falling off across it. */
const WHORL_BRIGHT_SHARE = 0.06;
/** How far out of the core the arms wind, in R, from just outside its eye, and how many turns they make. */
const WHORL_START = 0.1;
const WHORL_REACH = 0.78;
const WHORL_TURNS = 1.1;
/**
 * How the specks are spread along an arm: `out = random() ** WHORL_OUT_POWER`. The arm's length
 * per step of `out` grows about seven times from its start to its end, so an even `out` crowded the
 * start of the arm 19 times as densely as its end; this brings that down to about 4.
 */
const WHORL_OUT_POWER = 0.72;
/** The share of the whorl's specks that run along their arm, give or take 15°, as strands; the rest cross it. */
const WHORL_ALONG_SHARE = 0.9;
/** How far across its arm a speck lies, in R: a spread of INNER + OUTER × out, widening as it winds out. */
const WHORL_SPREAD_INNER = 0.04;
const WHORL_SPREAD_OUTER = 0.065;
/** The share of the whorl's specks spread further across the arm, and how many times as far: its soft skirt. */
const WHORL_SKIRT_SHARE = 0.3;
const WHORL_SKIRT_SPREAD = 2;
/** The whorl's specks are drawn this much longer than a body speck, so an arm reads as strands. */
const WHORL_STRETCH = 1.3;

/** A whorl speck: its place on an arm and the way it lies, pushed as a row of the body. */
function pushWhorlSpeck(random: Random, body: number[], shape: number[]) {
  const arm = random() < 0.5 ? 0 : Math.PI;
  const out = random() ** WHORL_OUT_POWER;
  const reach = WHORL_START + (WHORL_REACH - WHORL_START) * out;
  const angle = arm + WHORL_TURNS * 2 * Math.PI * out;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // The arm's direction there, and a spread across it that widens as it winds out.
  const runX = (WHORL_REACH - WHORL_START) * cos - reach * WHORL_TURNS * 2 * Math.PI * sin;
  const runY = (WHORL_REACH - WHORL_START) * sin + reach * WHORL_TURNS * 2 * Math.PI * cos;
  const run = Math.hypot(runX, runY);
  const narrow = WHORL_SPREAD_INNER + WHORL_SPREAD_OUTER * out;
  const spread = random() < WHORL_SKIRT_SHARE ? narrow * WHORL_SKIRT_SPREAD : narrow;
  const across = (random() + random() + random() - 1.5) * spread;
  const x = CORE_X + reach * cos - (runY / run) * across;
  const y = CORE_Y + reach * sin + (runX / run) * across;
  const crossing = random() < WHORL_ALONG_SHARE ? 0 : Math.PI / 2;
  const turn = crossing + (random() - 0.5) * 0.5;
  const lieX = (runX / run) * Math.cos(turn) - (runY / run) * Math.sin(turn);
  const lieY = (runX / run) * Math.sin(turn) + (runY / run) * Math.cos(turn);
  // Kept relative to the ring through where it is seen, as every body row is (ringDirection).
  const seen = Math.hypot(x, y) || 1;
  const outwardX = x / seen;
  const outwardY = y / seen;
  const spot = [x, y, (random() * 2 - 1) * 0.06];
  pickGlyphAndLength(random, seen, shape);
  stretchSpeck(shape, seen, WHORL_STRETCH);
  // How far off the arm's centre line, in standard deviations of the narrow spread (the sum of three
  // uniforms has a standard deviation of a half): the bright specks keep to the centre line.
  const deviations = across / (0.5 * narrow);
  const brightness = pickBrightness(random, WHORL_BRIGHT_SHARE * Math.exp(-0.5 * deviations * deviations));
  pushBodyRow(
    random,
    body,
    spot,
    -outwardY * lieX + outwardX * lieY,
    outwardX * lieX + outwardY * lieY,
    shape,
    brightness,
    6,
  );
}

/** One of the gyroscope's arcs: its radius from the core in R, its first clock degree and its sweep in degrees. */
type GyroArc = readonly [radius: number, from: number, sweep: number];

/**
 * The gyroscope: Age of Ultron's arcs round the core, each a bundle of thin strands, as its lab
 * shots show them (ring light at 0.50-0.60R over about half the clock, an arc at 0.67-0.7R). Specks
 * laid along them on the whorl's inner layer, so they turn with the swirl and stay arcs whichever way
 * the globe has turned. Clear of the core's ring at {@link CORE_RING_RADIUS}, which is Vision Quest's,
 * and inside the shell's edge.
 */
export const GYRO_ARCS: readonly GyroArc[] = [
  [0.53, 300, 110],
  [0.53, 105, 70],
  [0.67, 20, 140],
];
/** How long the arcs are together, radius by sweep: an arc is picked in proportion to its length. */
const GYRO_LENGTH = GYRO_ARCS.reduce((total, [radius, , sweep]) => total + radius * sweep, 0);
/** The share of the body's draws that go to the arcs: about 8% of his rows. */
const GYRO_SHARE = 0.06;
/** The share of the arcs' specks that are bright. */
const GYRO_BRIGHT_SHARE = 0.15;
/** Strands per arc, and how far apart they lie, in R. */
const GYRO_STRANDS = 3;
const GYRO_STRAND_GAP = 0.016;
/** How much of each end of an arc thins out, as a share of its sweep. */
const GYRO_END_FADE = 0.15;
/** The arcs' specks are drawn this much longer than a body speck, so a strand reads as a line. */
const GYRO_STRETCH = 1.5;

/** One of the gyroscope's arcs, picked in proportion to its length. */
function pickGyroArc(random: Random) {
  let left = random() * GYRO_LENGTH;
  for (const arc of GYRO_ARCS) {
    left -= arc[0] * arc[2];
    if (left <= 0) return arc;
  }
  return GYRO_ARCS[GYRO_ARCS.length - 1];
}

/** How far along its arc a speck lies, from 0 to 1, thinning out over {@link GYRO_END_FADE} at each end. */
function pickAlongTheArc(random: Random) {
  let along = random();
  while (random() > Math.min(1, along / GYRO_END_FADE) * Math.min(1, (1 - along) / GYRO_END_FADE)) along = random();
  return along;
}

/**
 * A gyroscope speck: on one strand of one arc, lying along it, pushed as a row of the inner layer.
 * {@link buildBody} gives the arcs {@link GYRO_SHARE} of its draws; exported so the arcs can be held
 * to their own shape apart from the whorl that shares their layer.
 */
export function pushGyroSpeck(random: Random, body: number[], shape: number[]) {
  const [radius, from, sweep] = pickGyroArc(random);
  const along = pickAlongTheArc(random);
  const strand = Math.floor(random() * GYRO_STRANDS) - (GYRO_STRANDS - 1) / 2;
  const reach = radius + strand * GYRO_STRAND_GAP + (random() - 0.5) * 0.008;
  // clock degrees, clockwise from 12 o'clock with y down
  const clock = (from + sweep * along) * DEGREES_TO_RADIANS;
  const x = CORE_X + reach * Math.sin(clock);
  const y = CORE_Y - reach * Math.cos(clock);
  const turn = (random() - 0.5) * 0.3;
  const lieX = Math.cos(clock + turn);
  const lieY = Math.sin(clock + turn);
  // Kept relative to the ring through where it is seen, as every body row is (ringDirection).
  const seen = Math.hypot(x, y) || 1;
  const outwardX = x / seen;
  const outwardY = y / seen;
  const spot = [x, y, (random() * 2 - 1) * 0.06];
  pickGlyphAndLength(random, seen, shape);
  // a dash, so a strand reads as a line
  shape[0] = 0;
  stretchSpeck(shape, seen, GYRO_STRETCH);
  pushBodyRow(
    random,
    body,
    spot,
    -outwardY * lieX + outwardX * lieY,
    outwardX * lieX + outwardY * lieY,
    shape,
    pickBrightness(random, GYRO_BRIGHT_SHARE),
    6,
  );
}

/**
 * The fragment body: the film's shell of fine glittering specks. Stride {@link BODY_STRIDE}: x, y,
 * unit direction along the ring and out from his middle where it is seen (see
 * {@link ringDirection}), length, rate (cycles per second), id (0..1), a code packing the glyph and
 * the fragment's class (see {@link FRAGMENT_CODE_GLYPH_STEP}), and depth. (x, y, depth) is where the
 * speck sits on the shell at rest — a direction uniform over the sphere at a distance from
 * {@link pickShellRadius} — so the rest pose seen face on is its projection, and the body turning
 * about the vertical axis turns the shell like a globe.
 *
 * A row is no wider than it has to be, since the scene is cloned into the worklet runtime at every
 * mount: the glyph rides in the class code, and the blink phase is a hash of the id rather than a
 * random of its own — a hash of a uniform number is as uniform and as uncorrelated as a second
 * draw would have been, and the id is already the fragment's handle for everything else that has
 * to vary independently.
 *
 * Two pools share the same places. Pool 0 is the calm set; pool 1, half its size,
 * cycles twice as fast and only shows while he talks, standing in for calm fragments
 * whose ids it takes over — so the count lit, and the brightness, stay the same.
 *
 * The whorl's and the gyroscope's specks ({@link WHORL_SHARE}, {@link GYRO_SHARE}) ride the
 * counter-turning inner layer instead of the globe's turn, so the spiral and the arcs through his
 * middle drift against the rest of him. Both take their rows out of the fill's and the shell's, so the
 * body still has exactly `fragmentCount` rows.
 */
function buildBody(random: Random, fragmentCount: number) {
  const body: number[] = [];
  const shape = [0, 0];
  const spot = [0, 0, 0, 0, 0];
  while (body.length < fragmentCount * BODY_STRIDE) {
    if (random() < WHORL_SHARE) {
      pushWhorlSpeck(random, body, shape);
      continue;
    }
    if (random() < GYRO_SHARE) {
      pushGyroSpeck(random, body, shape);
      continue;
    }
    pickBodyPlace(random, spot);
    const x = spot[0];
    const y = spot[1];
    const depth = spot[2];
    const crowding = clusterWeight(x, y, depth);
    const brightness = pickBodyBrightness(random, crowding, spot[3]);
    const crowded = brightness === 2 ? crowding : crowding * Math.sqrt(crowding);
    if (random() > massWeight(y) * crowded) continue;
    const direction = pickFragmentAngle(random, spot[4]);
    pickGlyphAndLength(random, Math.sqrt(x * x + y * y + depth * depth), shape);
    pushBodyRow(random, body, spot, Math.cos(direction), Math.sin(direction), shape, brightness);
  }
  return body;
}

/**
 * The lower hemisphere's stream: specks on the speck shell below the core that turn about the
 * vertical axis on a clock of their own ({@link STREAM_RADIANS_PER_SECOND}), so its front drifts
 * right at 0.1-0.2 R/s and its dimmer back drifts left — counter-streams through the bottom of the
 * shell.
 * Stride {@link STREAM_STRIDE}: x, y, z (rest pose), half-length along the latitude x, z, rate,
 * phase, id (at {@link STREAM_ID_FIELD}), brightness + 3 × pool, glyph (0 dash or 1 L).
 */
function buildStream(random: Random) {
  const stream: number[] = [];
  for (let i = 0; i < 168; i++) {
    // Just inside the body's shell: the stream's own limb fade starts at 0.857R.
    const shell = pickShellRadius(random, SPECK_SHELL_OUTER - 0.015);
    const latitude = Math.asin(0.1 + random() * 0.72);
    const longitude = random() * Math.PI * 2;
    const half = pickFragmentLength(random) * 0.5;
    const pool = random() < 1 / 3 ? 1 : 0;
    const restX = shell * Math.cos(latitude) * Math.sin(longitude);
    const restY = shell * Math.sin(latitude);
    const rate = pickFragmentRate(random, pool);
    const phase = random();
    const id = random();
    const brightnessCode = pickBrightness(random, 0.12) + 3 * pool;
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
    );
  }
  return stream;
}

/**
 * Strands fraying off the upper-left of the shell's edge while he talks, drawn round
 * {@link PICTURE_SHELL_EDGE}. Stride 5: clock angle, sweep (degrees), rate, phase, threshold.
 */
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

/**
 * Streak arcs a little off the shell's edge, at 1.0-1.07R, upper left, while he talks.
 * Stride 6: clock centre, radius, sweep, rate, phase, threshold.
 */
function buildStreakArcs(random: Random) {
  const arcs: number[] = [];
  for (let i = 0; i < 7; i++) {
    arcs.push(
      286 + i * 11 + random() * 6,
      1 + random() * 0.07,
      12 + random() * 12,
      0.5 + random() * 0.4,
      random(),
      0.08 + (i / 6) * 0.5,
    );
  }
  return arcs;
}

/**
 * Horizontal streaks slipping out of the right of the shell while he talks, as the film's
 * sphere loosens on "Doctor.". Stride 5: height, length, rate, phase, threshold.
 */
function buildLimbStreaks(random: Random) {
  const streaks: number[] = [];
  for (let i = 0; i < 16; i++) {
    streaks.push(-0.42 + random() * 0.72, 0.08 + random() * 0.26, 0.75 + random() * 0.7, random(), random() * 0.75);
  }
  return streaks;
}

/**
 * The cage's make-up: the nodes of its shell, the nodes woven over it a little farther out, the
 * spikes standing off it, the anchors that tie it to the specks, and the lines trailing below him.
 * CAGE_REACH is the farthest any of it reaches, in R.
 */
const CAGE_NODES = 160;
const CAGE_WOVEN_NODES = 34;
const CAGE_SPIKES = 13;
const CAGE_ANCHORS = 12;
const CAGE_TRAILS = 5;
const CAGE_REACH = 1.4;
/** How far out the shell's nodes reach, in R, from just outside the specks' edge. */
const CAGE_SHELL_INNER = 0.9;
export const CAGE_SHELL_OUTER = 1.16;
/**
 * How far out the woven nodes reach, in R: past it there are only single strokes — the spikes and
 * the trails — so that nothing round him can read as an arm.
 */
export const CAGE_WOVEN_REACH = 1.25;
/** The longest edge between two of the shell's nodes, in R: the film's are short and jagged. */
const CAGE_LONGEST_MESH_EDGE = 0.42;
/** The longest edge from a woven node back down to the shell's, and between two woven nodes. */
const CAGE_LONGEST_WEAVE = 0.36;
const CAGE_LONGEST_WOVEN_CHORD = 0.3;
/** The longest a spike may be, in R, and how lit its tip is as a share of its root. */
export const CAGE_LONGEST_SPIKE = 0.3;
const CAGE_SPIKE_TIP_LIGHT = 0.3;
/**
 * What the scene's seed is mixed with to seed the cage's own generator, as {@link BODY_SEED_MIX}
 * seeds the body's: what the scene draws from its main generator can change without moving the cage.
 */
const CAGE_SEED_MIX = 0x5bd1e995;

/**
 * A cage edge as a row: both ends (y down, z towards the eye at rest), its twinkle's rate and phase,
 * its weight, and how lit its far end is as a share of its near one's: 1, lit evenly along it, but
 * for a line that fades away as it leaves him.
 */
function pushCageEdge(edges: number[], random: Random, from: number[], to: number[], weight: number, farLight = 1) {
  edges.push(from[0], from[1], from[2], to[0], to[1], to[2], 0.05 + random() * 0.13, random(), weight, farLight);
}

/**
 * A direction for the cage, as a unit vector: more of them over the top, as the film's wireframe is
 * fullest above (y runs down, so a negative height is over the top).
 */
function pickCageDirection(random: Random): number[] {
  for (;;) {
    const height = random() * 2 - 1;
    const around = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - height * height);
    if (random() > 0.62 - 0.38 * height) continue;
    return [Math.cos(around) * ring, height, Math.sin(around) * ring];
  }
}

/**
 * A node of the cage's lumpy shell, hugging the shell of specks: {@link CAGE_SHELL_INNER} to
 * {@link CAGE_SHELL_OUTER} out, most of them inside 1.05R. Lumpy rather than round, the reach
 * swelling and dipping with the direction and a little at random.
 */
function pickCageNode(random: Random): number[] {
  const direction = pickCageDirection(random);
  const lump = 0.5 + 0.5 * Math.sin(2.3 * direction[0] + 1.1) * Math.sin(3.1 * direction[1] - 0.4 + 1.7 * direction[2]);
  const out = Math.min(1, Math.max(0, 0.55 * lump + 0.45 * random()));
  const radius = CAGE_SHELL_INNER + (CAGE_SHELL_OUTER - CAGE_SHELL_INNER) * out ** 1.6;
  return direction.map((component) => component * radius);
}

/**
 * A node woven over the shell's, a little farther out than any of them and no farther than
 * {@link CAGE_WOVEN_REACH}: the crumpled outside of the film's mesh. Never under him, where a node
 * out past the shell would hang off him.
 */
function pickWovenCageNode(random: Random): number[] {
  const radius = CAGE_SHELL_OUTER + 0.02 + random() * (CAGE_WOVEN_REACH - CAGE_SHELL_OUTER - 0.02);
  for (;;) {
    const direction = pickCageDirection(random);
    if (direction[1] < 0.4) return direction.map((component) => component * radius);
  }
}

/** How far a point of the cage is from his middle. */
function cageReach(point: number[]) {
  return Math.hypot(point[0], point[1], point[2]);
}

/** How far apart two points of the cage are. */
function cageDistance(from: number[], to: number[]) {
  return Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);
}

/**
 * The `count` nodes of `among` nearest to `node`, nearest first, as their indices and how far each
 * is: what sorting every node of `among` by its distance would put first, leaving out any at no
 * distance at all (`node` itself), and of two as far away the one `among` lists first.
 *
 * Picked in one pass, keeping only the nearest so far, rather than by sorting them all: the cage
 * asks this of every one of its nodes, and a hundred and sixty sorts of a hundred and sixty, with
 * an object made for every node in each, cost more than the body's ten thousand specks under a JIT
 * and over a third as much without one.
 */
function nearestCageNodes(node: number[], among: number[][], count: number) {
  const nearest: { otherIndex: number; distance: number }[] = [];
  for (let otherIndex = 0; otherIndex < among.length; otherIndex++) {
    const distance = cageDistance(node, among[otherIndex]);
    const farthestKept = nearest.length === count ? nearest[count - 1].distance : Infinity;
    if (distance === 0 || distance >= farthestKept) continue;
    if (nearest.length === count) nearest.pop();
    // after every one kept that is no farther, so that a tie keeps the order of `among`
    let at = nearest.length;
    while (at > 0 && nearest[at - 1].distance > distance) at--;
    nearest.splice(at, 0, { otherIndex, distance });
  }
  return nearest;
}

/** The one key an edge between two of `nodeCount` nodes has, whichever end it is named from. */
function cageEdgeKey(first: number, second: number, nodeCount: number) {
  return Math.min(first, second) * nodeCount + Math.max(first, second);
}

/** The nodes of the cage's shell, each joined to its two or three nearest by edges no longer than the mesh's. */
function pushCageMesh(edges: number[], random: Random, nodes: number[][]) {
  const joined = new Set<number>();
  nodes.forEach((node, index) => {
    const neighbours = random() < 0.6 ? 3 : 2;
    for (const { otherIndex, distance } of nearestCageNodes(node, nodes, neighbours)) {
      const key = cageEdgeKey(index, otherIndex, nodes.length);
      // an edge much longer than the mesh's would cut across his face
      if (joined.has(key) || distance > CAGE_LONGEST_MESH_EDGE) continue;
      joined.add(key);
      pushCageEdge(edges, random, node, nodes[otherIndex], 0.75 + 0.25 * random());
    }
  });
}

/**
 * The cage's crumpled outside: each woven node tied back down to the two nodes of the shell nearest
 * it, and some to the woven node nearest it as well, so the outside of the mesh is shallow jagged
 * triangles lying over the shell, as the film's is. Every woven node is held by both ends of what it
 * stands on, so none of it is a line with a loose end: a chain of chords out there, tied to the
 * shell at one end only, was a hook, and turning with his body it swung round him like an arm.
 */
function pushCageWeave(edges: number[], random: Random, nodes: number[][], wovenNodes: number[][]) {
  // A woven node out of reach of two of the shell's would hang by one line, a loose end, so it is
  // left out altogether, and nothing else is joined to it either.
  const woven = wovenNodes
    .map((node) => ({ node, shellNodes: nearestCageNodes(node, nodes, 2) }))
    .filter(({ shellNodes }) => (shellNodes[1]?.distance ?? Infinity) <= CAGE_LONGEST_WEAVE);
  const held = woven.map(({ node }) => node);
  const joined = new Set<number>();
  woven.forEach(({ node, shellNodes }, index) => {
    for (const { otherIndex } of shellNodes) {
      pushCageEdge(edges, random, node, nodes[otherIndex], 0.6 + 0.25 * random());
    }
    const [nearest] = nearestCageNodes(node, held, 1);
    if (nearest === undefined || nearest.distance > CAGE_LONGEST_WOVEN_CHORD || random() < 0.4) return;
    const key = cageEdgeKey(index, nearest.otherIndex, held.length);
    if (joined.has(key)) return;
    joined.add(key);
    pushCageEdge(edges, random, node, held[nearest.otherIndex], 0.55 + 0.25 * random());
  });
}

/**
 * Spikes: short single strokes standing off the outermost of the shell's nodes, out past
 * {@link CAGE_WOVEN_REACH}, their tips fading, as the film's wireframe throws the odd short line out
 * of its mesh. Leaning a little but never far from straight out, so that turning with him a spike
 * never sweeps round him as a hook does.
 */
function pushCageSpikes(edges: number[], random: Random, nodes: number[][]) {
  const roots = nodes.filter((node) => cageReach(node) >= CAGE_WOVEN_REACH - CAGE_LONGEST_SPIKE + 0.04);
  for (let spike = 0; spike < CAGE_SPIKES && roots.length > 0; spike++) {
    const root = roots[Math.floor(random() * roots.length)];
    const rootRadius = cageReach(root);
    const leaning = root.map((value) => value / rootRadius + (random() - 0.5) * 0.45);
    const leaningLength = cageReach(leaning);
    const tipRadius = CAGE_WOVEN_REACH + 0.02 + random() * 0.1;
    // as long as it takes to stand past the woven nodes, and never longer than a spike may be
    const length = Math.min(CAGE_LONGEST_SPIKE, tipRadius - rootRadius + 0.02);
    const tip = root.map((value, axis) => value + ((leaning[axis] ?? 0) / leaningLength) * length);
    if (cageReach(tip) <= CAGE_WOVEN_REACH) continue;
    pushCageEdge(edges, random, root, tip, 0.7 + 0.2 * random(), CAGE_SPIKE_TIP_LIGHT);
  }
}

/** Anchors: down from a node to the specks' edge, a little to one side of straight in. */
function pushCageAnchors(edges: number[], random: Random, nodes: number[][]) {
  for (let anchor = 0; anchor < CAGE_ANCHORS; anchor++) {
    const node = nodes[Math.floor(random() * nodes.length)];
    const length = cageReach(node);
    const aside = node.map((value) => value / length + (random() - 0.5) * 0.5);
    const asideLength = cageReach(aside);
    const foot = aside.map((value) => (value / asideLength) * PICTURE_SHELL_EDGE * (0.93 + 0.07 * random()));
    pushCageEdge(edges, random, node, foot, 0.5 + 0.2 * random());
  }
}

/**
 * The trails: a few long lines from all round the bottom of the shell of specks, sweeping down past
 * the bottom of him towards the far side and fading away as they go, as the lines trailing below
 * the film's sphere taper off. Each is on its own and none branches, and they start all round him
 * rather than from one side, so that however his body has turned they never close up into one line;
 * and having faded by the time they pass each other, they never meet in a point below him either.
 * The chain of edges it replaces, with a branch off it, read as a limb hanging off him.
 */
function pushCageTrails(edges: number[], random: Random) {
  for (let trail = 0; trail < CAGE_TRAILS; trail++) {
    const around = ((trail + 0.4 * random()) / CAGE_TRAILS) * Math.PI * 2;
    // from 25-55 degrees off the bottom of the shell
    const tilt = (25 + random() * 30) * DEGREES_TO_RADIANS;
    const startRadius = PICTURE_SHELL_EDGE * (0.95 + 0.05 * random());
    const from = [
      Math.cos(around) * Math.sin(tilt) * startRadius,
      Math.cos(tilt) * startRadius,
      Math.sin(around) * Math.sin(tilt) * startRadius,
    ];
    // down towards straight below him, ending short of it on its own side or past it on the far one
    const beyond = around + Math.PI + (random() - 0.5) * 1.2;
    const aside = (random() - 0.35) * 0.5;
    const depth = 1.15 + random() * 0.2;
    const to = [Math.cos(beyond) * aside, depth, Math.sin(beyond) * aside];
    const reach = cageReach(to);
    const kept = reach > CAGE_REACH - 0.02 ? to.map((value) => (value * (CAGE_REACH - 0.02)) / reach) : to;
    pushCageEdge(edges, random, from, kept, 0.75 + 0.2 * random(), 0);
  }
}

/**
 * The cage: the film's crumpled wireframe round the shell of specks — straight hairlines between
 * nodes, making jagged triangles. Seeded nodes on a lumpy shell hugging the specks,
 * {@link CAGE_SHELL_INNER} to {@link CAGE_SHELL_OUTER} out, each joined to its two or three nearest
 * by short edges; nodes woven over them a little farther out, each tied back down to two of them; a
 * few short spikes standing straight off it; a few anchors running down to the specks' edge; and a
 * few long lines tapering below him. Past {@link CAGE_WOVEN_REACH} there are only the spikes and the
 * trails, single strokes fading away, and none of it reaches past {@link CAGE_REACH}.
 *
 * It is in three dimensions and turns with the body (`gpu/picture-layers.ts`), always there and
 * calm: nothing grows out of it or swings away, which is what the user disliked in the protrusions
 * it replaces. It once had long chords out to 1.4R as well, joined into polylines held to the shell
 * at one end; turning with him, they swung round him as hooks and arms, the very thing he had lost.
 *
 * Stride {@link CAGE_EDGE_STRIDE}: from x, y, z, to x, y, z, twinkle rate (cycles a second), its
 * phase, the edge's weight, and how lit its far end is as a share of its near one's. y runs down the
 * screen and z towards the eye at rest, as the body's.
 */
function buildCage(random: Random) {
  const nodes: number[][] = [];
  while (nodes.length < CAGE_NODES) nodes.push(pickCageNode(random));
  const wovenNodes: number[][] = [];
  while (wovenNodes.length < CAGE_WOVEN_NODES) wovenNodes.push(pickWovenCageNode(random));
  const edges: number[] = [];
  pushCageMesh(edges, random, nodes);
  pushCageWeave(edges, random, nodes, wovenNodes);
  pushCageSpikes(edges, random, nodes);
  pushCageAnchors(edges, random, nodes);
  pushCageTrails(edges, random);
  return edges;
}

/** How many embers drift round him, and the share of them that show while he is quiet. */
const EMBER_COUNT = 56;
const EMBERS_IN_SILENCE = 0.45;
/** How far out an ember may get before it has gone, in R: well inside his square's edge. */
const EMBER_FARTHEST = 1.45;
/** How far up an ember rises for every R it drifts outward. */
export const EMBER_RISE = 0.3;
/** What the scene's seed is mixed with to seed the embers' own generator (see {@link CAGE_SEED_MIX}). */
const EMBER_SEED_MIX = 0x27d4eb2f;

/**
 * The embers: tiny orange flecks drifting out from the shell's edge and a little upward, each on its
 * own slow clock, fading in and out and gone before {@link EMBER_FARTHEST}. A quarter of them are
 * streaked. Which of them show depends on a threshold each holds: {@link EMBERS_IN_SILENCE} of them
 * while he is quiet, more while he talks, and all of them on the low notes of his voice
 * (`emberShare` in {@link analyseFrame}).
 *
 * Stride {@link EMBER_STRIDE}: direction (radians from 3 o'clock, y down), where it starts (R),
 * how far it drifts (R), its period (s), its phase, its streak's length (R) and its threshold.
 */
function buildEmbers(random: Random) {
  const embers: number[] = [];
  for (let ember = 0; ember < EMBER_COUNT; ember++) {
    const start = PICTURE_SHELL_EDGE - 0.08 + random() * 0.12;
    // what it rises adds to how far out it gets, at most EMBER_RISE as much again
    const drift = Math.min(0.22 + random() * 0.36, (EMBER_FARTHEST - start) / (1 + EMBER_RISE));
    const streaked = random() < 0.25;
    embers.push(
      random() * Math.PI * 2,
      start,
      drift,
      4 + random() * 5,
      random(),
      streaked ? 0.025 + random() * 0.035 : 0.004 + random() * 0.006,
      random(),
    );
  }
  return embers;
}

/** What the scene's seed is mixed with to seed the truss's own generator (see {@link CAGE_SEED_MIX}). */
const TRUSS_SEED_MIX = 0x165667b1;
/** The truss's three stretches of arc, in clock degrees: about 190° of his edge in all. */
const TRUSS_ARCS = [
  [280, 380],
  [195, 245],
  [62, 102],
];

/**
 * The ladder truss round his edge, as the old rim had it: pieces of about 9° meeting end to end along
 * three stretches of arc ({@link TRUSS_ARCS}), each a box between the rails with a rung at its start,
 * some carrying a circuit trace and some a pair of short struts hanging inward from the inner rail.
 * In the frame it rolls in (`rimRoll`), the GPU drawing every piece every frame.
 *
 * Stride {@link TRUSS_PIECE_STRIDE}: start (clock degrees), sweep (degrees), circuit trace (0 none,
 * 1 L, 2 Z, 3 T) and hanging strut length (R, 0 for none).
 */
function buildTruss(random: Random) {
  const truss: number[] = [];
  for (const [from, to] of TRUSS_ARCS) {
    let degrees = from;
    while (degrees < to - 4) {
      // pieces meet end to end, so the rails run on unbroken with rungs across them
      const sweep = Math.min(to - degrees, 8 + random() * 3);
      const trace = random() < 0.45 ? 0 : 1 + Math.floor(random() * 3);
      // short, so that a strut stays in the shell's edge and never reaches into his face
      const strut = random() < 0.22 ? 0.04 + random() * 0.04 : 0;
      truss.push(degrees, sweep, trace, strut);
      degrees += sweep;
    }
  }
  return truss;
}

/**
 * Builds the hologram's random geometry once. Deterministic for a given seed; plain data only.
 *
 * `particleCount` is the most the body can ever have, which a phone then draws a share of — see
 * `density-control.ts` for who decides that share. A parameter rather than the constant because
 * the showcase renders Jarvis at a count no phone is ever asked for: it has no frame to hit. See
 * `hologram/.scripts/render-showcase.ts`. Everything downstream is a share of whatever this is,
 * so nothing else has to know.
 */
export function createHologramScene(seed: number, particleCount: number = PARTICLE_COUNT) {
  const random = createRandom(seed);
  return {
    // rounded as it is built (see buildBody)
    body: buildBody(createRandom(seed ^ BODY_SEED_MIX), particleCount),
    stream: buildStream(random).map(roundToFiveDecimals),
    fray: buildFray(random).map(roundToFiveDecimals),
    streakArcs: buildStreakArcs(random).map(roundToFiveDecimals),
    limbStreaks: buildLimbStreaks(random).map(roundToFiveDecimals),
    // only a seed: the sparkle's texels are built from it wherever they are uploaded (gpu/sparkle.ts,
    // and vr's sparkle texture), never copied to the worklet runtime
    textureSeed: Math.floor(random() * 4294967296),
    // Each from a generator of its own, as the body is, so that nothing drawn from the one above —
    // taken out or added — reshuffles them, nor they it.
    cage: buildCage(createRandom(seed ^ CAGE_SEED_MIX)).map(roundToFiveDecimals),
    embers: buildEmbers(createRandom(seed ^ EMBER_SEED_MIX)).map(roundToFiveDecimals),
    truss: buildTruss(createRandom(seed ^ TRUSS_SEED_MIX)).map(roundToFiveDecimals),
  };
}

/** The random geometry one hologram is drawn from, as `createHologramScene` builds it. */
export type HologramScene = ReturnType<typeof createHologramScene>;

/**
 * The part of a scene the picture is drawn from: everything but the body and the stream, whose
 * fragments the GPU draws (`hologram/gpu`). A picture worklet captures this rather than the whole
 * scene, so the ninety thousand numbers of the body are never copied into the worklet runtime.
 */
export type HologramPictureScene = Omit<HologramScene, 'body' | 'stream'>;

/** {@link HologramPictureScene} of a scene, as a new object holding only those parts. */
export function pictureSceneOf(scene: HologramScene): HologramPictureScene {
  return {
    fray: scene.fray,
    streakArcs: scene.streakArcs,
    limbStreaks: scene.limbStreaks,
    textureSeed: scene.textureSeed,
    cage: scene.cage,
    embers: scene.embers,
    truss: scene.truss,
  };
}

// ---- the paths that never change ---------------------------------------------------------

/**
 * A path as the commands it is made of: move, line and conic, in Skia's verb numbers, which is
 * how the drawing was written when Skia drew it. The paths that never change are built into these
 * once ({@link staticPathsOf}) and flattened into the GPU's straight runs (`gpu/picture-layers.ts`).
 */
export interface PathBuilder {
  commands: number[][];
  count: number;
}

const MOVE_VERB = 0;
const LINE_VERB = 1;
const CONIC_VERB = 3;

function makePathBuilder(): PathBuilder {
  return { commands: [], count: 0 };
}

function pushCommand(builder: PathBuilder, command: number[]) {
  builder.commands[builder.count] = command;
  builder.count++;
}

function pathMoveTo(builder: PathBuilder, x: number, y: number) {
  pushCommand(builder, [MOVE_VERB, x, y]);
}

function pathLineTo(builder: PathBuilder, x: number, y: number) {
  pushCommand(builder, [LINE_VERB, x, y]);
}

function pathConicTo(builder: PathBuilder, x1: number, y1: number, x2: number, y2: number, weight: number) {
  pushCommand(builder, [CONIC_VERB, x1, y1, x2, y2, weight]);
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

/**
 * Brightness along the body's strokes: a tiled field of soft random dips and hot spots
 * (0.5-1), so a stroke is hot in places and dimmer in others rather than one flat tone.
 * Premultiplied grey RGBA. Each texel comes from an integer hash of its index, which is far
 * cheaper than the scene's generator on an interpreter.
 */
export function sparklePixels(seed: number) {
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

/**
 * The marks of the core: inside its white-hot ring ({@link CORE_RING_RADIUS}) Age of Ultron's small
 * ringed eye — a hooked ring of radius 0.1R with a stem curling in, round a closed ring of 0.06R, as
 * the film's lab shots show two nested rings at 0.05-0.06R and 0.09-0.11R round a darker hole — and
 * a bar across short enough to stay inside the white-hot ring, as Vision Quest's glowing disc has
 * faint marks across it.
 *
 * The ring used to put out a short tick at its upper right, where one of the film's frames shows a
 * spark leave it. Held still on him, it read as a glitch in the ring rather than as a spark, and it
 * is gone.
 */
function buildCoreGlyph() {
  const ring = makePathBuilder();
  appendArc(ring, 0, 0, 0.1, -35 * DEGREES_TO_RADIANS, 305 * DEGREES_TO_RADIANS);
  // the hook: from the ring's open end a short stem curls in toward the middle
  const endAngle = 270 * DEGREES_TO_RADIANS;
  pathMoveTo(ring, Math.cos(endAngle) * 0.1, Math.sin(endAngle) * 0.1);
  pathLineTo(ring, 0.012, -0.055);
  pathLineTo(ring, 0.03, -0.02);
  // the eye's inner ring, a run of its own (appendArc starts with a move)
  appendArc(ring, 0, 0, 0.06, 0, 2 * Math.PI);
  const bar = makePathBuilder();
  pathMoveTo(bar, -0.22, 0.012);
  pathLineTo(bar, 0.22, 0.012);
  return { coreRing: ring, coreBar: bar };
}

/** The paths that never change, as commands: the core's marks — its ringed eye and its bar. */
export function staticPathsOf() {
  return buildCoreGlyph();
}

/** The paths that never change, as {@link staticPathsOf} builds them. */
export type StaticPaths = ReturnType<typeof staticPathsOf>;

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

/** Where a fragment sits in the thinning, 0-1: a share keeps the fragments whose key is under it. */
export function densityKey(id: number) {
  'worklet';
  return fraction(id * DENSITY_FROM_ID);
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

/**
 * How much of him shows, 0–1, from a frame's {@link HologramFrame.appearance} and
 * {@link HologramFrame.presence}: the whole sphere fades in over the first fifth of the vortex, so
 * the first particles leaving the core are seen as they go and their own travel does the arriving,
 * and leaving fades it out by the same alpha.
 *
 * The GPU draws him unfaded, body and picture as one, and whoever shows him fades the lot by it:
 * the two each faded before being Screened together would come out brighter where they overlap.
 * Every renderer takes it from here so none can drift from the others.
 */
export function arrivalOf(appearance: number, presence: number) {
  'worklet';
  return smooth01(clamp01(appearance) / 0.2) * clamp01(presence);
}

/** Everything a frame derives from its fields; see the file header for the mapping. */
export function analyseFrame(frame: HologramFrame, size: number) {
  'worklet';
  const time = frame.time;
  // How far on the vortex is: 1 once it is over.
  const swirl = clamp01(frame.appearance);
  // What speech does to him — chips thrown off the shell, the fraying, the embers it brings out —
  // waits until the vortex has all but formed him. The greeting plays while he arrives, and
  // without this it threw full-size chips off a limb that was not there yet, into empty space
  // round a sphere still gathered at its core.
  const formed = smooth01((swirl - 0.6) / 0.4);
  const agitation = clamp01(frame.agitation) * formed;
  const bands = frame.bands;
  const lowDrive = clamp01((bandAverage(bands, 0, 6) - 0.35) / 0.45);
  const highDrive = clamp01((bandAverage(bands, 14, 24) - 0.2) / 0.45);
  const burstAge = frame.burstAge >= 0 ? frame.burstAge : 10;
  const yaw = time * STREAM_RADIANS_PER_SECOND;
  const bodyYaw = bodyTurnRadians(time);
  // Loudness, not the agitation envelope: the glow follows his voice moment to moment, as the
  // first hologram's did, while the chips and the churn follow the envelope.
  const voice = clamp01(frame.level) ** 0.8;
  const settle = 1 - smooth01(swirl);
  const presence = clamp01(frame.presence);
  const hearing = clamp01(frame.hearing ?? 0);
  const hearingLevel = clamp01(frame.hearingLevel ?? 0);
  const arrival = arrivalOf(frame.appearance, frame.presence);
  // How much bigger he is this frame than at rest. Mostly loudness, so the sphere breathes with
  // the sentence rather than stepping up and sitting there; the envelope keeps it from dropping
  // back to nothing between syllables.
  const swell = SWELL_WITH_VOICE * (0.7 * voice + 0.3 * agitation);
  // Full size from the start of the vortex; it only shrinks on the way out.
  const radius = size * SPHERE_FRACTION * (LEAVING_SMALLEST + (1 - LEAVING_SMALLEST) * presence) * (1 + swell);
  const intoScan = time - Math.floor(time / SCAN_SECONDS) * SCAN_SECONDS;
  const thinking = clamp01(frame.thinking);
  // How far the vortex has carried his shell of specks out of the core, 0 to 1. By swirlFragment's
  // law a fragment leaves once the swirl passes 0.6 of its order — 0.9 of its reach and a tenth of
  // its id's hash — and has settled 0.4 later, so the middle of the shell is on its way out at about
  // 0.35 and its edge has settled by 0.95. This follows the shell between the two, over that whole
  // stretch: the outer layers it carries out are much of the picture's light, and following the
  // edge alone, which travels in the last 0.4, they came on so steeply that a frame of them turned
  // most of a tenth of the light on at once.
  const shellOut = smooth01((swirl - 0.35) / 0.6);
  return {
    time,
    radius,
    thinking,
    // Where the plane is, sweeping upward — y runs down the screen, so it starts positive. From
    // the clock alone, like everything else here, so it needs nothing remembered between frames.
    scan: 1.15 - (2.3 * intoScan) / SCAN_SECONDS,
    // And how far the ring has bloomed, in the last stretch of each pass.
    pulse: intoScan > SCAN_SECONDS - PULSE_SECONDS ? (intoScan - (SCAN_SECONDS - PULSE_SECONDS)) / PULSE_SECONDS : 0,
    arrival,
    // The picture arrives as the vortex does: the core first, on its own; then everything round the
    // shell of specks, carried out of the core with it (`shellReach`, a share of where it settles),
    // so that none of it is ever drawn round a ball that is not there yet — the aura did glow round
    // nothing when it came up with the core, and the cage hung round nothing coming up after it.
    // The aura brightens as the specks are carried out, and the cage and the embers come up a
    // little behind it. The core comes up over the first 0.4 of the vortex rather than all at once:
    // over a quarter, under the view's own fade, a frame of it turned 8% of the light on at once.
    //
    // Everything but the core's ring recedes while he thinks, so that the plane sweeping through
    // him is what the eye is left with. Without this the rest goes on doing what it always does and
    // the sweep is one more thing happening among several — which is how the first version of
    // thinking looked, and why it did not read as a different state at all.
    coreAlpha: smooth01(swirl / 0.4),
    auraAlpha: (1 - 0.5 * thinking) * shellOut,
    // From the 0.04 swirlFragment starts every fragment at, to 1.
    shellReach: 0.04 + 0.96 * shellOut,
    cageAlpha: (1 - 0.5 * thinking) * smooth01((swirl - 0.4) / 0.6),
    // The core's glowing disc dims while he listens as well as while he thinks, so the lattice is
    // what is seen.
    coreGlow: (1 - 0.4 * thinking) * (1 - 0.3 * hearing),
    // Which of the embers show: some of them always, and more while he talks, all of them on the
    // low notes of his voice — as the fray answers the high ones.
    emberShare: EMBERS_IN_SILENCE + (1 - EMBERS_IN_SILENCE) * agitation * (0.55 + 0.45 * lowDrive),
    swirl,
    hearing,
    hearingLevel,
    /** Where {@link latticeFragment} leaves a fragment: x, y. */
    listened: [0, 0],
    /** Where {@link swirlFragment} leaves a fragment: x, y, its direction, and how much of it shows. */
    swirled: [0, 0, 0, 0, 0],
    agitation,
    // Half the calm fragments hand over to fast ones at full agitation, so the turnover rises
    // by about half (the Age of Ultron footage's churn on "Doctor." rises from 8 to 13 per frame).
    // Half and no more, because pool 1 lights the ids below 2·mix: at this share, and only at this share,
    // the fragments pool 1 lights make up for the ones pool 0 puts out at every agitation.
    // Past it pool 1 runs out of ids to light and the body thins while he talks — which dims
    // the ball, and, with fewer strokes going out and coming back, makes it churn less rather
    // than more, which is the opposite of what speech is supposed to look like.
    mix: 0.5 * agitation,
    // A third of the bright fragments step down while he talks, and their hot cores go almost
    // entirely, as the Age of Ultron footage's luma-200 highlights drop by about 70% on "Doctor.".
    // The strokes themselves stay bright: it is the hot pixels that leave, not the texture.
    hotShare: 1 - 0.35 * agitation,
    frayDrive: agitation * (0.55 + 0.45 * highDrive),
    burstAge,
    burstStrength: clamp01(frame.burstStrength) * formed,
    // how far the burst throws, and how many chips
    burstReach: clamp01(frame.burstStrength),
    burstCount: Math.floor(frame.burstCount),
    /**
     * Somewhere for placeFragment to put its seven numbers: made once a frame, not once a fragment.
     * Only what composes the body from the helpers uses it; the phone's loop keeps its numbers in locals.
     */
    scratch: [0, 0, 0, 0, 0, 0, 0],
    /** The same for whether a fragment is lit at all, and what it is; see {@link readFragment}. */
    reading: [0, 0, 0, 0, 0],
    /** And for whether the thinking plane is in the middle of one; see {@link scanned}. */
    scanBright: [0],
    bodyCos: Math.cos(bodyYaw),
    bodySin: Math.sin(bodyYaw),
    /** What the halos and the aura multiply their alpha by: 1 in silence, up to 1 + GLOW_WITH_VOICE. */
    glowGain: 1 + GLOW_WITH_VOICE * (GLOW_FROM_ENVELOPE * agitation + (1 - GLOW_FROM_ENVELOPE) * voice),
    // How far the core ring's brighter stretches have rolled round it. This and the inner layer's
    // turn are wrapped to one turn: the GPU takes float32 numbers, which would lose the per-frame
    // step of a sphere left mounted for hours.
    roll: fraction((time * ROLL_DEGREES_PER_SECOND) / 360) * 360,
    // And how far the truss round his edge has rolled, on its own clock.
    rimRoll: fraction((time * RIM_ROLL_DEGREES_PER_SECOND) / 360) * 360,
    // the inner layer winds up with the vortex, settling to its own slow turn as the specks do
    shellTurn: fraction((time * SHELL_DEGREES_PER_SECOND - 540 * settle * settle) / 360) * 360,
    streamCos: Math.cos(yaw),
    streamSin: Math.sin(yaw),
    // the core's brightness drifts a few percent over many seconds; it never beats
    coreDrift: 1 + 0.03 * Math.sin(time * 0.53 + 1.1),
  };
}

/**
 * Everything a frame derives from its fields, as every per-fragment helper here reads it.
 *
 * Exported with {@link analyseFrame} and those helpers for a renderer that draws the same sphere
 * some other way — the headset's draws the body in three dimensions on the GPU — so that it takes
 * the same state from the same frame instead of keeping a copy of this arithmetic that drifts.
 * Its `radius` is in the units of the `size` it was analysed at, `roll` and `shellTurn` are in
 * degrees because that is what Skia's canvas took when it drew him, and `scan` is a height measured
 * downward, as every y in this file is.
 */
export type HologramFrameState = ReturnType<typeof analyseFrame>;

// ---- the fragments ------------------------------------------------------------------------

/**
 * How lit a fragment is this frame, 0..1 (0 = dark): its clock's fade envelope times its pool's
 * share. Pool 0 (calm) gives up the lowest ids as `mix` rises; pool 1 (fast) lights ids below
 * 2·mix.
 *
 * The envelope fades over a third of the lit window at each end rather than the quarter it
 * was. A fragment's paint does not fade with it — only its length does, since its tier's paint is
 * the same however lit it is — so the fade is how quickly a lit stroke arrives in the
 * pixels it covers, and with the fragment clocks running half again as fast as before, a
 * quarter of the window had come down to three frames and each arrival showed as a step.
 */
export function fragmentStrength(life: number, id: number, pool: number, state: HologramFrameState) {
  'worklet';
  const progress = life / FRAGMENT_DUTY;
  const envelope = Math.min(1, progress * 3, (1 - progress) * 3);
  const poolShare = pool === 0 ? clamp01((id - state.mix) * 12 + 1) : clamp01((2 * state.mix - id) * 12);
  return envelope * poolShare;
}

/**
 * Which tier a fragment is drawn in: 0 dim, 1 mid, 2 bright. Fading fragments and
 * thinned-out hot ones step down.
 */
export function fragmentTier(brightness: number, strength: number, id: number, hotShare: number) {
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
  if (brightness === 1 && strength > 0.4) return 1;
  return 0;
}

/**
 * How much a speck seen face on through his shell is dimmed: one seen square through the shell
 * keeps 1 − this of its light, one at the silhouette all of it.
 *
 * As a glowing shell seen edge on is brightest, a speck is dimmed by how squarely the eye looks
 * through the ball where it is seen — the square of the cosine between the line of sight and his
 * radius there, which for a speck at its place is its depth over its distance from his centre —
 * from any side and as he turns. Where it is seen, rather than where it sits, so a speck his voice
 * carries in from the edge dims as it comes.
 *
 * Only a little. The film's donut asked for 0.85, which left his middle to the core and the dark;
 * the user preferred the old body's density, so his middle is filled ({@link BODY_FILL_SHARE}) and
 * dimmed by a quarter at most: enough that the ring of beads round his edge still leads.
 *
 * Dimmed means fainter and in a lower tier, not shorter: a speck keeps its length, so the specks
 * across the middle are lines rather than dots — the user asked that a spark read as a line and not
 * a bead.
 */
export const SHELL_FACE_DIMMING = 0.25;

/**
 * How far behind the plane through his middle, in R, the back of his shell begins. Every speck
 * further back than this is drawn in the dim tier, whatever its class, so the back of the shell is
 * depth rather than clutter. Not from the plane itself: a glowing shell is brightest at its
 * silhouette, from both sides of it, and cut there the ring of beads round his edge would be half
 * dim, the specks just behind the limb dark beside the ones just in front of it. Specks this close
 * behind the plane are only ever seen at the edge of the donut.
 */
export const BACK_OF_THE_SHELL = 0.2;

/**
 * What {@link SHELL_FACE_DIMMING} leaves of a speck's light, seen at (`seenX`, `seenY`) in the
 * plane through his centre, for the square of its distance from his centre: the squared cosine is
 * `1 − seen²/radius²`, and nothing is dimmed outside its own radius. The body's own maths, here and
 * on the GPU.
 */
export function shellFacing(seenX: number, seenY: number, radiusSquared: number) {
  'worklet';
  if (radiusSquared <= 0) return 1;
  return 1 - SHELL_FACE_DIMMING * clamp01(1 - (seenX * seenX + seenY * seenY) / radiusSquared);
}

/**
 * Which way a speck lies in the plane of the view, seen at (`seenX`, `seenY`): its row's direction
 * (`unitX`, `unitY`) is kept relative to the ring through where it is seen — `unitX` along that
 * ring, clockwise, and `unitY` out from his middle — and this turns it into the view's x and y,
 * written into `out[at]` and `out[at + 1]`.
 *
 * The film's specks run along the ring like beads on a necklace. A direction held in the plane of
 * the view would lie along the ring only where the speck rested, and the body turns like a globe,
 * so a quarter turn later the beads at the edge of the donut would be the ones that had been
 * crossing his face, lying any way at all. Kept relative to where it is seen, a speck lies along
 * the ring wherever the turn carries it. At his very middle there is no ring, and the row's
 * direction is taken as it is.
 */
export function ringDirection(seenX: number, seenY: number, unitX: number, unitY: number, out: number[], at: number) {
  'worklet';
  const seen = Math.sqrt(seenX * seenX + seenY * seenY);
  if (seen <= 0) {
    out[at] = unitX;
    out[at + 1] = unitY;
    return;
  }
  const outwardX = seenX / seen;
  const outwardY = seenY / seen;
  // Along the ring is the outward direction turned a quarter clockwise on screen (y down).
  out[at] = -outwardY * unitX + outwardX * unitY;
  out[at + 1] = outwardX * unitX + outwardY * unitY;
}

/**
 * Whether a body row's class code (see {@link FRAGMENT_CODE_GLYPH_STEP}) puts it on the whorl: the
 * inner layer, held in the plane of the view rather than turned with the globe.
 */
export function ridesTheWhorl(code: number) {
  'worklet';
  return code - FRAGMENT_CODE_GLYPH_STEP * Math.floor(code / FRAGMENT_CODE_GLYPH_STEP) >= 6;
}

/**
 * Where a fragment lands on screen this frame, how much of it survives the limb, and how much of
 * its light the shell it is seen through leaves it ({@link shellFacing}).
 *
 * Writes `x`, `y`, `depth`, `edge` (the limb's share of its length) and `light` (the shell's share
 * of its paint) into `out`, and the way the speck lies ({@link ringDirection}) after them, rather
 * than returning them, because whatever composes the body from it places a couple of thousand
 * fragments a frame, and an object apiece would be a frame's worth of rubbish to collect. It is the
 * definition the GPU's body is held to, and what its CPU reference (`gpu/fragment-3d.ts`) composes
 * the body from.
 */
export function placeFragment(
  body: number[],
  offset: number,
  along: number,
  across: number,
  state: HologramFrameState,
  out: number[],
) {
  'worklet';
  // Turned about the vertical axis before anything else: the fragment wanders around where it
  // sits on the turning ball, not around a fixed place on the screen, and lies along the ring
  // through where it is seen there.
  const rest = body[offset];
  const restY = body[offset + 1];
  const depthAtRest = body[offset + 8];
  // The whorl's specks are held in the plane of the view and turn only with the inner layer, so
  // its arms stay arms however far the globe has turned.
  const turnCos = ridesTheWhorl(body[offset + 7]) ? 1 : state.bodyCos;
  const turnSin = ridesTheWhorl(body[offset + 7]) ? 0 : state.bodySin;
  const turnedX = rest * turnCos + depthAtRest * turnSin;
  ringDirection(turnedX, restY, body[offset + 2], body[offset + 3], out, 5);
  const unitX = out[5];
  const unitY = out[6];
  const y = restY + unitY * along + unitX * across;
  const x = turnedX + unitX * along - unitY * across;
  out[0] = x;
  out[1] = y;
  out[2] = depthAtRest * turnCos - rest * turnSin;
  // Nothing pops at the limb as it turns out of sight, or as it wanders out past it.
  out[3] = clamp01((0.94 * 0.94 - x * x - y * y) * 8);
  out[4] = shellFacing(x, y, rest * rest + restY * restY + depthAtRest * depthAtRest);
}

/**
 * Whether a body fragment is lit this frame at all, and if so what it is.
 *
 * Its own function because it is its own question — everything here is asked of a fragment before
 * anything is known about where it will be drawn — and because the answers are cheapest in the
 * order they come: two fragments in five fail one of these on any given frame, and the ones that
 * fail first are the ones that cost least to ask.
 *
 * Returns the strength, or 0 for a fragment that is not drawn, and writes what the caller needs
 * into `into`: strength, glyph, whether it rides the inner layer, which blink it is on, and its
 * brightness tier. An array rather than an object because whatever composes the body from it asks it
 * of thousands of fragments a frame, and it is the array {@link HologramFrameState.reading} keeps
 * for exactly that reason. It is the definition the GPU's body is held to (`gpu/fragment-3d.ts`).
 */
export function readFragment(body: number[], offset: number, state: HologramFrameState, into: number[]): number {
  'worklet';
  // Is it lit at all? This is the cheapest question to ask of them: everything below — unpacking
  // its class, its pool's share — is work the ones that fail would only throw away.
  // Whether this device can afford it at all is not asked here: that is the density share's, which
  // keeps the fragments whose `densityKey` is under it.
  const id = body[offset + BODY_ID_FIELD];
  const cycles = state.time * body[offset + 5] + fraction(id * FRAGMENT_PHASE_FROM_ID);
  const cycle = Math.floor(cycles);
  const life = cycles - cycle;
  if (life >= FRAGMENT_DUTY) return 0;

  const packed = body[offset + 7];
  const glyph = Math.floor(packed / FRAGMENT_CODE_GLYPH_STEP);
  const code = packed - glyph * FRAGMENT_CODE_GLYPH_STEP;
  // The code packs three things by addition — brightness 0-2, plus 3 if it belongs to the
  // fast pool, plus 6 if it rides the counter-turning shell — so division takes them apart.
  const turning = 3 * Math.floor(code / 6);
  const pool = Math.floor((code - turning * 2) / 3);
  const strength = fragmentStrength(life, id, pool, state);
  if (strength < FRAGMENT_FAINTEST) return 0;

  into[0] = strength;
  into[1] = glyph;
  into[2] = turning;
  into[3] = cycle;
  into[4] = code - 3 * pool - 2 * turning;
  return strength;
}

/**
 * How much of a fragment survives the thinking plane, given where it sits up the ball.
 *
 * At rest this is 1 and costs one comparison. While he thinks, only what the plane is passing stays
 * lit — see {@link SCAN_SECONDS} — and what it is in the *middle* of is lit to the brightest tier
 * whatever it was, which is what makes the pass a line of attention rather than a moving shadow.
 *
 * Returns the share to multiply by, and leaves in `state.scanBright` whether this one is near
 * enough the middle of the plane to be promoted. Two answers from one measurement of `nearness`,
 * which is why the second comes back in a scratch rather than being worked out again by the caller.
 * Nothing is promoted when he is not thinking.
 */
export function scanned(y: number, state: HologramFrameState): number {
  'worklet';
  if (state.thinking <= 0) {
    state.scanBright[0] = 0;
    return 1;
  }
  const nearness = clamp01(1 - Math.abs(y - state.scan) / SCAN_HALF_WIDTH);
  state.scanBright[0] = nearness > SCAN_BRIGHT_NEARNESS && state.thinking > 0.5 ? 1 : 0;
  return 1 - state.thinking * (1 - SCAN_FLOOR) * (1 - nearness * nearness);
}

/**
 * Where a fragment is while the vortex brings it out of the core: writes x, y, its direction and
 * how much of it shows into `state.swirled` — just where it already is once the vortex is over.
 *
 * Each fragment leaves the core on its own clock — the ones nearest it first, the limb last — and
 * travels out along a spiral, a turn and a half short of where it sits and closing on it as it
 * slows, drawn longer while it moves so the arms read as streams rather than dots. A fragment
 * still at the core is not shown at all, so the eye does not start on a blot of light.
 */
export function swirlFragment(
  x: number,
  y: number,
  unitX: number,
  unitY: number,
  id: number,
  state: HologramFrameState,
) {
  'worklet';
  const out = state.swirled;
  if (state.swirl >= 1) {
    out[0] = x;
    out[1] = y;
    out[2] = unitX;
    out[3] = unitY;
    out[4] = 1;
    return;
  }
  const reach = Math.sqrt(x * x + y * y);
  const order = clamp01(0.9 * reach + 0.1 * fraction(id * 3.91));
  const travelled = smooth01((state.swirl - 0.6 * order) / 0.4);
  const left = 1 - travelled;
  const spin = VORTEX_TWIST * left * left;
  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  const scale = 0.04 + 0.96 * travelled;
  const swirledX = (x * cos + y * sin) * scale;
  const swirledY = (y * cos - x * sin) * scale;
  out[0] = swirledX;
  out[1] = swirledY;
  // While it travels it points the way it is going — round the core, and a little outward — and
  // turns back to its own direction as it settles.
  const distance = Math.sqrt(swirledX * swirledX + swirledY * swirledY) || 1;
  const outwardX = swirledX / distance;
  const outwardY = swirledY / distance;
  const headingX = 0.35 * outwardX - outwardY;
  const headingY = 0.35 * outwardY + outwardX;
  const heading = Math.sqrt(headingX * headingX + headingY * headingY);
  const settled = travelled * travelled;
  const directionX = (headingX / heading) * (1 - settled) + (unitX * cos + unitY * sin) * settled;
  const directionY = (headingY / heading) * (1 - settled) + (unitY * cos - unitX * sin) * settled;
  const direction = Math.sqrt(directionX * directionX + directionY * directionY) || 1;
  out[2] = directionX / direction;
  out[3] = directionY / direction;
  // Not shown until it has left the core, so the eye does not start on a blot of light.
  // Stretched along its path while it moves, but never longer than the path it has come out on.
  const stretch = 1 + VORTEX_STRETCH * left * clamp01(distance * 2.5);
  out[4] = smooth01((travelled - 0.04) * 6) * stretch;
}

/** Its place on the nearest point of the slowly turning hexagonal grid, which breathes with the voice. */
export function latticeTarget(x: number, y: number, id: number, state: HologramFrameState, out: number[]) {
  'worklet';
  const turn = state.time * LATTICE_TURN;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const spacing = LATTICE_SPACING * (1 + LATTICE_BREATH * state.hearingLevel * Math.sin(state.time * LATTICE_PULSE));
  // Into the grid's own frame, snapped to its nearest row and column — every other row shifted by
  // half a spacing, which is what makes it hexagonal — and back out.
  const localX = x * cos + y * sin;
  const localY = y * cos - x * sin;
  const rowHeight = spacing * 0.866;
  const row = Math.round(localY / rowHeight);
  const shift = row % 2 === 0 ? 0 : spacing / 2;
  const column = Math.round((localX - shift) / spacing);
  const jitter = (fraction(id * 7.7113) - 0.5) * 0.018;
  const snappedX = column * spacing + shift + jitter;
  const snappedY = row * rowHeight + jitter;
  out[0] = snappedX * cos - snappedY * sin;
  out[1] = snappedY * cos + snappedX * sin;
}

/**
 * Where a fragment is while he listens: writes x, y into `state.listened` — just where it already
 * is when nobody is talking to him.
 *
 * As someone starts speaking each fragment moves that share of the way — {@link LATTICE_PULL} at
 * full attention — to the lattice point nearest it, with a little jitter from its id so a point is a
 * small knot of strokes rather than one. Each fragment lives only a fraction of a second before it
 * re-lights, so the ball resolves onto the lattice rather than sliding onto it.
 */
export function latticeFragment(x: number, y: number, id: number, state: HologramFrameState) {
  'worklet';
  const out = state.listened;
  const pull = state.hearing * LATTICE_PULL;
  if (pull <= 0.001) {
    out[0] = x;
    out[1] = y;
    return;
  }
  latticeTarget(x, y, id, state, out);
  out[0] = x + (out[0] - x) * pull;
  out[1] = y + (out[1] - y) * pull;
}

/**
 * Whether a shell fragment is lit this frame at all, and how strongly.
 *
 * The same question {@link readFragment} asks of a body fragment and in the same order, against a
 * different layout: the shell's fragments carry their code and blink phase in their own slots and
 * have no glyph packing to take apart. Returns the strength, or 0 for one that is not drawn, and
 * leaves its pool in `state.reading[0]` — which is all the caller needs of it afterwards.
 */
export function readShellFragment(stream: number[], offset: number, state: HologramFrameState): number {
  'worklet';
  const id = stream[offset + STREAM_ID_FIELD];
  const cycles = state.time * stream[offset + 5] + stream[offset + 6];
  const life = cycles - Math.floor(cycles);
  if (life >= FRAGMENT_DUTY) return 0;
  const pool = stream[offset + 8] >= 3 ? 1 : 0;
  state.reading[0] = pool;
  const strength = fragmentStrength(life, id, pool, state);
  return strength < FRAGMENT_FAINTEST ? 0 : strength;
}
