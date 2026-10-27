# Show Progress in Pictures

**ALWAYS show the user what a visual change looks like, in pictures, as it goes.** Whenever a change
alters how something looks — the hologram, a screen of the phone or the watch, the headset's room —
send rendered images of each meaningful step as it happens, not only a description of it.

- **Before and after, side by side.** One image with the old look above the new one, at the same
  moments (arriving, idle, speaking, listening, thinking for the hologram), says more than any
  paragraph. Label the rows and columns in the caption.
- **Every round, not just the last.** Send the first attempt as soon as it renders, and each
  revision after it, so the user can redirect early instead of finding out at the end.
- **Send the file.** Use the tool that delivers a file to the user (`SendUserFile`), with a short
  caption; a path in a message is not a picture they can see.
- **Render what ships.** Draw the stills through the repository's own GPU render harness
  (`hologram/.scripts/render-page.ts` and its page entries), so the picture is what a device draws.
  See [Rendering Jarvis for the README and previews](hologram-renders.md).

Why: a look is judged by eye. A description of a change to the hologram cannot tell the user
whether they like it, and finding out only after a long validation cycle wastes it.

❌ **BAD** — "I filled his middle with specks and widened the strokes; it looks denser now."

✅ **GOOD** — the same sentence, sent with an image of old, new and fused rows at the same five
moments, and another image for each round that follows.
