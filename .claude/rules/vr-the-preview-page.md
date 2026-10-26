---
paths:
  - "vr/**"
---

# The preview page

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

`preview.html` (`src/preview/`), published at /hey-jarvis/vr/preview.html:
Jarvis in 3D on a normal desktop canvas, with a camera to drag round him, black or
passthrough grey behind him, a button for each phase (arriving, greeting,
speaking, listening, thinking, idle, leaving — driven by the greeting's
measurement, the simulated voices and a simulated listener, as sample mode is),
and the alpha factor. **Enter your room** opens the same hologram in a
headset, 1.6 m ahead; there a select moves on to the next phase. It is what the
browser tests photograph and measure, through `window.__hologramPreview`
(`preview-hook.ts`) — including his picture alone, drawn into a target of the
stage's renderer exactly as the headset draws it (`picture-check.ts`:
`drawPictures`, `checkPicture`, `pictureFacts`, `orbitPoints`).

**Testing the glyphs** (`satellites-panel.ts`). Under the controls, a button for every vertical's
glyph, read at build time from the server's own glyph files (`mcp/mastra/verticals/agent-glyphs.ts`
and the `glyph.ts` files it gathers, which import nothing — which is why `tsconfig.json`'s `rootDir`
is the repository's, and why `turbo.json` puts those files in `vr#typecheck`'s and `vr#build`'s hash).
A tap sets that agent to work round him on the stage, as the headset draws it, and again has it
answer; beside the stage they are drawn as the phone draws them, over the phone's picture of him at
rest, by `hologram/gpu`'s `drawGpuPicture` on a WebGL 2 canvas of its own, cleared and faded as the
phone's canvas is. Buttons for all of them send every agent to work (at most eight
at once, as on every device), call a tool, have one ask sir or fail, and finish them all. A path of
your own can be tried too, and is read by `agentActivityOf` exactly as one from the server: one the
devices refuse says so and shows as a plain ring. Everything goes through `agentActivity` messages,
built as routing builds them. `window.__hologramPreview.satellites` lists what is out, and
`tests/e2e/preview-satellites.spec.ts` drives the panel.
