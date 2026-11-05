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
  faint bar across it (`buildCoreGlyph`, `drawCore`). While he talks the white-hot ring draws in
  toward the eye as each syllable leaves him, by up to `CORE_RING_DRAW` of its radius, and lets go
  (`coreRing`): in, never out.
- **The body of specks:** up to `PARTICLE_COUNT` of them, the old body fused with the film's shell
  (`buildBody`, drawn by `gpu/gpu-body.ts`): most fill the ball as the old body did
  (`BODY_FILL_SHARE`), in its wide strokes, copper and orange tiers and broad red-orange halos, and
  the rest lie on the film's shell from about half his radius out, ringing his edge with the
  brightest orange beads.
- **The rings of his voice:** while he talks, each syllable leaves his core as a ring of his own
  specks — pushed out from the core by up to `VOICE_WAVE_REACH`, so far that at its front they
  crowd to up to five times as close into a crisp line, their strokes laid along it (only about
  0.6–0.7R from the core, where the taper adds its slope, do a few briefly overtake) — that travels
  out at `VOICE_WAVE_SPEED` and melts into his shell by `VOICE_WAVE_GONE`. The clock keeps how
  sharply each 40 ms of his voice started a syllable (`hologram/src/voice-wave.ts`), and each slot is
  a ring `VOICE_WAVE_STEP` further out than the next (`voiceWaveKnots`, `voiceWavePush`,
  `voiceWaveTurn`). Every speck but the truss's; the arcs and the stream are carried out but keep
  their way. Held back until he has formed, and given way to the lattice and the thinking band.
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
- **The cascades:** now and then a box of the truss fires and a pulse spreads through the cage from
  the node over it like a firing neuron (`cage-cascade.ts`): the box's own square flares (its rails
  and rungs lit over, `CASCADE_BOX_FLARE_SECONDS`), then the pulse runs hop by hop over the cage's
  own edges (`CASCADE_HOP_SECONDS`, 0.2 s a hop, `CASCADE_OUT_HOPS`, six deep), each node lighting up
  to three of the neighbours that show most out in the dark and run round his edge
  (`CASCADE_BRANCHES`, `nextAlongHisEdge`), then the edges closing the patch's triangles. Each lit
  edge is a solid orange line about two and a half pixels across
  in a tight red-orange glow on the very hairline, lit up to the tail of an orange comet with a
  short bright head racing along it, and a soft deep-orange flash on the node it lands on; the
  patch holds, then fades from where it started outward. As it reaches its tips the return gathers
  from its own tips, up to four hops (`CASCADE_RETURN_HOPS`), onto the node over another box nearby
  (`planBestReturn`), every branch landing
  together, and that box flares as it lands — the box under that node as it lands, where the truss
  has rolled it by then (`landingBox`). Picked from the clock by a hash, one chance every
  `CASCADE_PERIOD` (3 s), each over before the next however late it fires and however far it
  spreads (`CASCADE_LATEST_FIRE` + `CASCADE_LONGEST_SECONDS` is the period, to the frame): every
  other chance fires, `CASCADE_IN_SILENCE` (0.35) of the rest and any beside a chance that finds
  nothing, and all of them while he talks or thinks — over 1200 s one every 4.5 s in silence and one
  every 3.0 s while busy, about 28 edges each (21 out, 7 back), some 5.2R of lit cage. The user asked
  for them "a bit bigger and more frequent" when they were one every 5.1 s and 3.3 s, 17 edges
  (12.6 out, 4.6 back) and 3.1R: over 600 s something of one is now lit 57% of the time in silence
  and 84% while busy, where it was 48% and 74%, and none is dark for 5 s, where 9.5 s was. In
  silence two chances in a row go dark only where the cage, as it is turned then, offers neither of
  them a node to fire from at all, and over 1200 s that never happened: three chances in 400 find no
  node, where one in ten did, with a stretch of three dark chances (12 s).
  It fires from the node over the truss whose pulse would show most (`seenLength`), as a pulse over
  the bright truss and edge alone could not be seen. They light only existing edges of the painted
  cage, both of whose nodes stay past 0.82R (`CASCADE_LIMB`) — over his bright edge and the truss
  at the least, where they are drawn dimmer, never in over his body — and no further back than
  `CASCADE_DEEPEST` for every moment the edge is lit (`clearOver`, `judgeNode`), however his body
  turns and the cage sways meanwhile, and never a spoke out into the dark whose outer node no other
  edge of the same cascade reaches (`markSpokeEnds`, `dropLoneSpokes`), so nothing stands out past
  where the cage already reaches. That is judged over the whole cascade, not frame by frame: while
  steadily lit every spoke leads on to a lit edge, but as its spark first leaves, or as it fades after
  the edge beyond it has gone out, one can be the only lit edge at its outer node for up to a hop
  (`CASCADE_HOP_SECONDS`). A pulse never fires from a node it would not leave (`leavesItsSource`),
  whose box would flare with nothing leaving it once a lone spoke out of it was dropped. Judged where the cage stood as they fired, as they first
  were, two edges in five were drawn over his bright body or behind him before they went out, a
  third of every lit edge's frames, and nearly every return landed beside the box that flared for
  it; held to the whole of their lives they were a third smaller, and one chance in ten found
  nowhere to fire, until reaching in from his limb at 0.9R to 0.82R, quicker hops (0.24 s to 0.2)
  that fit six out and four back where five and three did, and three branches a node rather than
  two won it back — larger than the cascades the user chose by eye, which lit 26 edges. They are drawn over his body as
  well as the picture (`drawGpuPictureCascade`, from `drawGpuFrame` only, so the headset draws
  none: `.claude/rules/vr-the-honest-limits.md`), at `CASCADE_OVER_HIM` of their light over his
  edge and the truss, so the lit net shows where the cage crosses the rim and the headset's picture
  is drawn to the byte as before. What tried and failed: a tree of single edges under the body, lost
  on the truss's rail; nodes past 1.0R only, too few to fire one every twenty seconds; a glow four
  times the hairline, which made every lit spoke out there a stick with a knob on its end; spreading
  only round his edge and never along a spoke, which kept the pulse on the bright band where it
  showed least; and a white-hot heart in a pale comet over the lit wire, and a glow wide enough to
  fill a box, which Screened into a cream blob and a flat slab.
- **The embers:** orange flecks drifting out from the shell's edge, more of them while he talks
  (`buildEmbers`, `drawEmbers`).
- **The aura:** the film's bloom, a soft warm band round him, see-through in the middle
  (`AURA_INNER`, `AURA_OUTER`, `drawAura`).
- **The fray and the chips:** strands and streaks off the shell's edge while he talks, and shards
  of light thrown off its left on a syllable, streaking back the way they came and snapping as they
  break up (`drawFray`, `drawChips`).
- **The listening lattice:** while someone talks to him his specks snap onto a slowly turning
  hexagonal lattice (`latticeFragment`, `latticeTarget`) that swells with how loud they are now
  (`LATTICE_BREATH`), and each syllable they say flows in through it, from `HEARD_WAVE_FROM` at his
  edge to `HEARD_WAVE_GONE` inside the white-hot ring, as a ring of its knots pulled in toward the
  core and crowded into a line whose knots get back the length the lattice shrinks away
  (`pushAlongRings`, `latticeStrokeShare`) — his own rings run backwards. The frame clock keeps
  their syllables as it keeps his (`heard`, from `heardRise` in `hearing.ts`).
- **The thinking band:** one soft band gliding up through him and back down (`SCAN_SECONDS` a pass,
  `scanAt`), its plane rocking up to 20° on a clock of its own (`scanTiltAt`), its light falling
  off as a bell (`SCAN_SOFTNESS`) to `SCAN_FLOOR` of his light, some of its specks promoted to the
  brightest tier by chance (`SCAN_PROMOTED_SHARE`, dealt from each speck's re-lighting) and drawn a
  little longer (`SCAN_STRETCH`) — `scanned`. The aura, the cage and the core's glow recede by
  `THOUGHT_PICTURE_DIMMING` meanwhile.
- **The satellites:** the agents at work circling him (`drawSatellites`).

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
- **Signal flowing through his cage, cooler and clearer** (the user asked for particles or signal
  flowing between the cage's triangles and the rim, "cooler and clearer", and chose the network
  cascade among the looks tried, by eye): now and then a box of the truss fires a pulse through the
  cage's own triangles and a return lands on another box (the cascades, above). It squares with
  "No protrusions" by lighting only edges the cage already has, never a spoke standing out on its
  own, both ends past 0.82R for as long as an edge is lit; and with "Calm" by being one chance a
  `CASCADE_PERIOD` at most, each over before the next. Then "Make the cascades a bit bigger and more
  frequent": about one every four and a half seconds in silence (it was five), never five seconds
  dark, and half as big again (28 edges where 17 were). Do not shrink them back to buy a guarantee:
  each edge stays judged over its whole lit life.
- **The squares near his edge stay** ("I'd also like to still have the weird squares near the edge
  of the hologram"): the truss is always there, between `TRUSS_INNER_RAIL` and `TRUSS_OUTER_RAIL`, so
  it never stands off him. The script that chose between it, a crescent and a thin ring is gone.
- **He arrives as a vortex out of his core** and in no other way, and nothing flashes as he forms.
- **He leaves the way he came** ("The leaving animation should also be way more sophisticated.
  Maybe the reverse of the arriving animation."): presence runs the arrival's vortex backwards
  (`vortexOf`), over as long as the arrival takes (`LEAVING_SECONDS` is `MATERIALISE_SECONDS`), so a
  frame at presence `p` is the frame at appearance `p`. Do not go back to fading and shrinking him
  where he stands.
- **Hanging up is not a thought** ("When calling end call tool, the hologram should not show a
  thinking animation"): ElevenLabs' system tools (`end_call`, `skip_turn`…) never start the scan
  plane; only a call that goes out and does work does (`startsAThought` in `tool-activity.ts`).
- **Ten thousand particles at most** (`PARTICLE_COUNT`): fifteen thousand read as a mass.
- **Calm, never a sizzle:** the specks' clocks are slower than the film's (`pickFragmentRate`),
  and every twinkle is slow.
- **His glow answers his voice by a tenth** (`GLOW_WITH_VOICE`); speech shows as movement.
- **He swells with his voice** (`SWELL_WITH_VOICE`), and his body turns like a globe
  (`BODY_RADIANS_PER_SECOND`).
- **Listening is the lattice** (`latticeFragment`) and **thinking is the scan plane**
  (`SCAN_SECONDS`).
- **The lattice moves with their voice** ("The listening animation doesn't move much with the
  voice. Perhaps spice it up and make it better"): it once breathed on a sine of its own, only
  scaled by their loudness, so it kept its own time and never theirs. Now each syllable they say
  flows in from his edge to his core as a lit ring of its knots, and it swells with how loud they
  are this moment; nothing of it moves on a clock of its own but its slow turn. On sample mode's
  listening clip the lattice moves 3.4 times as much from frame to frame as it did (the mean change
  of his light's radial profile, 0.066 against 0.020), with his light and hue unchanged. Do not
  give it a clock of its own back.
- **One thought, softly** ("As for the thinking animation, it is currently too dull. Maybe it's
  because there are 2 thinking stripes or pulses, when there should be 1 … The stripe also looks
  very sharp. Maybe it could be more subtly blending in"): the ring that bloomed out of the core at
  the end of every pass is gone, so the band is the whole of a thought; its edge is a bell and its
  bright specks are dealt by chance rather than past a threshold, so it thins into him; the rest of
  him keeps `SCAN_FLOOR` (0.38) of his light rather than an eighth, and the picture recedes by a
  third rather than a half; and it glides up and back like a pendulum rather than wrapping from top
  to bottom. Over a thought at 400 px his mean luma is about 90 where it was 58 (calm is 118), his
  hue 26° and near-white 0.16% of his light. A radar sweep round the core and an orbiting comet were
  tried beside it: the sweep is one more rotation, and the comet too faint to read.
- **A speck reads as a line, not a bead:** the median one is at least five times as long as it is
  wide (`pickFragmentLength`).
- **The squares are particles, and fewer** ("The squares along the edge should be made from moving
  particles too if possible. The amount of squares should be reduced a bit."): the truss is specks
  of the body, not a painted layer, thirteen boxes where the painted truss had twenty-one. Its boxes
  must read as plainly as the painted ones did at 400 px while he idles, talks and listens: about
  280 specks a rail and 34 or more a rung, mostly bright. Fewer read as a faint dashed scatter.
- **The arcs move while he talks** ("The arcs around his core need to also move when talking"):
  they rock 25-45° either way about the core with his talk envelope, calmly (never over 1.5° a
  frame), and in silence turn with the whorl.
- **Thinking scatters the glow lines** ("While thinking, the direction of the glow lines should
  randomize"): every speck but the truss's lies some way within ±90° of its own (`thoughtTurn`),
  dealt afresh each time it re-lights, eased in with the thought.
- **It is plain when he is speaking** ("Update the talking animation to more cool and expressive -
  right now it's not very clear that Jarvis is speaking"): each syllable leaves his core as a ring
  of his own specks that sweeps out through him (the rings above), and the white-hot ring draws in
  as it goes. Both are movement, as the tenth of a glow asks: over a sentence his light is within 3%
  of what it was, its hue (30°) and G/R (0.70) unchanged, no near-white added, and in silence he is
  drawn to the byte as before. At the first design's 0.06R push a ring's front crowded the specks by
  at most 0.3, and the rings showed only in a plot of his light against distance and time; at 0.16R
  they are a crisp line anyone sees. A ring has gone about 1.3 s after his last syllable
  (`VOICE_WAVE_FLOOR`). The arcs, the fray and the embers follow the talk envelope, which holds through the
  gaps between words, so he no longer drops back to idle a dozen times a sentence.
