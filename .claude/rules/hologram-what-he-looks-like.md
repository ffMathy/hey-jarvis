---
paths:
  - "hologram/**"
---

# What he looks like

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

**The reference is a hybrid of two films**, at the user's asking. The *Vision Quest* footage —
J.A.R.V.I.S. close up, in the scene where he dies — leads what he is made of: the white-hot ring,
the beaded shell, the wireframe cage and the bloom. The *Avengers: Age of Ultron* lab scene he was
first drawn from leads his colour, and gives his soft swirl, the small ringed eye at his core, the
gyroscope's arcs round it and the open boxes of his ladder truss. What was measured on both — the
ring, the shell, the wireframe, the bloom, the colours, the eye, the arcs and the churn — is at the
top of `src/hologram-drawing.ts`, with every layer and what each frame field does to it.

## His parts

- **The core:** a white-hot thin ring at 0.22R (`CORE_RING_RADIUS`), the brightest thing in him and an
  orange-white rather than white, round a glow that is mostly see-through, with Age of Ultron's
  small ringed eye inside it — a hooked ring at 0.1R round a ring at 0.06R, never white — and a
  faint bar across it (`buildCoreGlyph`, `drawCore`).
- **The body of specks:** up to `PARTICLE_COUNT` of them, the old body fused with the film's shell
  (`buildBody`, drawn by `gpu/gpu-body.ts`): most fill the ball as the old body did
  (`BODY_FILL_SHARE`), in its wide strokes, copper and orange tiers and broad red-orange halos, and
  the rest lie on the film's shell from about half his radius out, ringing his edge with the
  brightest orange beads.
- **The whorl:** the old body's spiral through his middle, two arms winding out from just outside
  the core's eye at 0.1R to about 0.78R, made of specks (`WHORL_SHARE` of the body's draws,
  `pushWhorlSpeck`) held in the plane of the view and turning slowly about the core against the
  globe (`SHELL_DEGREES_PER_SECOND`). It is Age of Ultron's soft swirl: one broad, mid-toned sweep of
  strands, its specks spread evenly along the arms, few of them bright and those on the arms' centre
  lines, with a soft skirt round each arm.
- **The gyroscope:** Age of Ultron's arcs round the core, bundles of three thin strands of specks on
  arcs at 0.53R and 0.67R (`GYRO_ARCS`, `pushGyroSpeck`), in a group of their own (`GYRO_GROUP`) held
  in the view plane and turned with the whorl, and rocked about the core while he talks, the inner
  arcs against the outer one like a gimbal's rings (`gyroSway`, `GYRO_SWAY_DEGREES`, `turnOfGroup`).
  They leave the voice's churn to the rest of him, which would slide them round into rings. Nothing
  of it lies at the core's ring.
- **The stream:** a few specks below the core turning about the vertical on a clock of their own
  (`buildStream`).
- **The cage:** the film's loose wireframe, hairlines between seeded nodes round the shell, in
  three dimensions and turning with the body (`buildCage`, `drawCage`).
- **The truss:** the old rim's ladder truss round his edge, made of specks of the body
  (`pushTrussSpeck`, `TRUSS_GROUP`, about 1200 of the ten thousand): dashes along a hot outer rail
  (`TRUSS_OUTER_RAIL`) and a finer inner one (`TRUSS_INNER_RAIL`) and across the rungs between
  them, thirteen open boxes of about 11.6° in three stretches (`TRUSS_ARCS`), always there and
  rolling clockwise about his middle on its own clock (`RIM_ROLL_DEGREES_PER_SECOND`, `rimRoll`).
  Its specks twinkle and slide along their lines like every speck, but the limb never cuts them,
  the listening lattice never snaps them, thinking never scatters them and the thinking plane does
  not put them out (they recede by `TRUSS_THINKING_DIM`), so the squares stay squares.
- **The embers:** orange flecks drifting out from the shell's edge, more of them while he talks
  (`buildEmbers`, `drawEmbers`).
- **The aura:** the film's bloom, a soft warm band round him, see-through in the middle
  (`AURA_INNER`, `AURA_OUTER`, `drawAura`).
- **The fray and the chips:** strands and streaks off the shell's edge while he talks, and shards
  of light thrown off its left on a syllable, streaking back the way they came and snapping as they
  break up (`drawFray`, `drawChips`).
- **The thinking pulse and the satellites:** a ring blooming out of the core as each pass of the
  scan plane ends, and the agents at work circling him (`drawThinkingPulse`, `drawSatellites`).

## What the user asked for, which a change must keep

- **A small core.** Vision Quest's ring at 0.35R read too big in the hybrid; the user asked for it
  smaller, and it sits at 0.22R. Do not grow it back.
- **Dense, as the old body was.** The film's hollow shell alone left a dark donut round the core,
  and the user liked how packed the old body looked better: his middle is filled with specks and
  dimmed only a little (`SHELL_FACE_DIMMING`). Do not hollow him out again.
- **The spiral is particles.** The user liked the old whorl and asked for it back made of specks,
  not painted: do not draw it as a layer of the picture. The gyroscope's arcs are specks too.
- **Reddish, not yellow** ("The light is also too yellow - I liked the old reddish tint"): every
  paint is Age of Ultron's copper and red-orange. Over idle and speaking at 400 px his weighted hue
  is about 30° (it was 37.6°), G/R 0.71 (0.82), and near-white is 1.1% of his light (6.8%); his
  hottest pixels are orange-white, never pure white, and the core's ring is still the palest thing
  in him. His middle is the palest of him and his edge and aura the reddest, as in both films. Do
  not let the paints drift back to pale gold.
- **The spiral is soft** ("The spiral is too sharp"): no white knot inside the core's ring and no
  white S; the arms are a mid-toned sweep, a mean luma of about 200 along them, about 1.3 times the
  gaps between them (it was 234 and 1.45), and at most a tenth of an arm's centre line white in any
  band (84-94% was, inside the core's ring). Soften it, but keep it plainly a spiral at phone size:
  the user likes the spiral.
- **Nothing but particles fills him.** "I just want the particles to speak for themselves": no warm
  volume or haze painted under them; the density is the specks'. The eye's two thin rings sit inside
  the core's existing glow and fill nothing.
- **No protrusions.** Nothing grows out of him and dissolves in a repeating pattern; the cage is
  always there, and calm.
- **The squares near his edge stay** ("I'd also like to still have the weird squares near the edge
  of the hologram"): the truss is always there, between `TRUSS_INNER_RAIL` and `TRUSS_OUTER_RAIL`, so
  it never stands off him. The script that chose between it, a crescent and a thin ring is gone.
- **He arrives as a vortex out of his core** and in no other way, and nothing flashes as he forms.
- **Ten thousand particles at most** (`PARTICLE_COUNT`): fifteen thousand read as a mass.
- **Calm, never a sizzle:** the specks' clocks are slower than the film's (`pickFragmentRate`),
  and every twinkle is slow.
- **His glow answers his voice by a tenth** (`GLOW_WITH_VOICE`); speech shows as movement.
- **He swells with his voice** (`SWELL_WITH_VOICE`), and his body turns like a globe
  (`BODY_RADIANS_PER_SECOND`).
- **Listening is the lattice** (`latticeFragment`) and **thinking is the scan plane**
  (`SCAN_SECONDS`).
- **A speck reads as a line, not a bead:** the median one is at least five times as long as it is
  wide (`pickFragmentLength`).
- **The squares are particles, and fewer** ("The squares along the edge should be made from moving
  particles too if possible. The amount of squares should be reduced a bit."): the truss is specks
  of the body, not a painted layer, thirteen boxes where the painted truss had twenty-one. Its boxes
  must read as plainly as the painted ones did at 400 px while he idles, talks and listens: about
  280 specks a rail and 34 or more a rung, mostly bright. Fewer read as a faint dashed scatter.
- **The arcs move while he talks** ("The arcs around his core need to also move when talking"):
  they rock 25-45° either way about the core with his eased agitation, calmly (never over 1.5° a
  frame), and in silence turn with the whorl.
- **Thinking scatters the glow lines** ("While thinking, the direction of the glow lines should
  randomize"): every speck but the truss's lies some way within ±90° of its own (`thoughtTurn`),
  dealt afresh each time it re-lights, eased in with the thought.
