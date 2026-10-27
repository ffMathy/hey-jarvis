---
paths:
  - "hologram/**"
---

# What he looks like

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

**The reference is the Vision Quest footage**: J.A.R.V.I.S. close up, in the scene where he dies.
It replaced the *Avengers: Age of Ultron* lab scene he was first drawn from, wherever the two
disagree. What was measured on it — the ring, the shell, the wireframe, the bloom, the colours and
the churn — is at the top of `src/hologram-drawing.ts`, with every layer and what each frame field
does to it.

## His parts

- **The core:** a white-hot thin ring (`CORE_RING_RADIUS`), the brightest thing in him, round a
  glow that is mostly see-through, with a faint hooked ring and bar across it (`drawCore`).
- **The body of specks:** up to `PARTICLE_COUNT` of them, the old body fused with the film's shell
  (`buildBody`, drawn by `gpu/gpu-body.ts`): most fill the ball as the old body did
  (`BODY_FILL_SHARE`), in its wide strokes, deep orange tiers and broad halos, and the rest lie on
  the film's shell from about half his radius out, ringing his edge with the brightest gold beads.
- **The stream:** a few specks below the core turning about the vertical on a clock of their own
  (`buildStream`).
- **The cage:** the film's loose wireframe, hairlines between seeded nodes round the shell, in
  three dimensions and turning with the body (`buildCage`, `drawCage`).
- **The embers:** golden flecks drifting out from the shell's edge, more of them while he talks
  (`buildEmbers`, `drawEmbers`).
- **The aura:** the film's bloom, a soft warm band round him, see-through in the middle
  (`AURA_INNER`, `AURA_OUTER`, `drawAura`).
- **The fray and the chips:** strands and streaks off the shell's edge while he talks, and shards
  of light thrown off its left on a syllable, streaking back the way they came and snapping as they
  break up (`drawFray`, `drawChips`).
- **The thinking pulse and the satellites:** a ring blooming out of the core as each pass of the
  scan plane ends, and the agents at work circling him (`drawThinkingPulse`, `drawSatellites`).

## What the user asked for, which a change must keep

- **Dense, as the old body was.** The film's hollow shell alone left a dark donut round the core,
  and the user liked how packed the old body looked better: his middle is filled with specks and
  dimmed only a little (`SHELL_FACE_DIMMING`). Do not hollow him out again.
- **Nothing but particles fills him.** "I just want the particles to speak for themselves": no warm
  volume or haze painted under them; the density is the specks'.
- **No protrusions.** Nothing grows out of him and dissolves in a repeating pattern; the cage is
  always there, and calm.
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
