---
paths:
  - "**/README.md"
---

# READMEs: Show, Don't Tell

**ALWAYS show what a project does instead of describing it.** A README leads with a picture, a clip,
a diagram or a command and its output. Prose is only the caption that a picture can't carry.

- **One or two short sentences per picture.** Say what is on screen, not how it was made.
- **NEVER explain the rendering, encoding or licensing in the README.** Frame rates, particle
  counts, why GitHub plays no video, where the device art came from: that belongs in the rule that
  owns the script (for example [`hologram-renders`](hologram-renders.md)), or in a `NOTICE.md`. A
  licence notice the art requires stays as a single linked line.
- **A table or a code block beats a paragraph.** Use a table for a list of projects and a code
  block for how to run something.
- **Link out for the details.** Setup guides, design decisions and conventions live in `docs/` and
  `.claude/rules/`. The README links them in one line.

Why: people judge a project by eye in the first few seconds. A wall of text under a picture gets
skipped, and the explanations in it go stale without anyone noticing.

❌ **BAD**
```markdown
These clips are that same drawing rendered frame by frame at the most particles each device is
allowed — 10,000 on the phone, 5,000 on the watch — as animated WebP at 40 fps and 95% quality,
because a README cannot show a video...
```

✅ **GOOD**
```markdown
Hold the power button and he comes up over whatever you were doing. On the watch he is the whole screen.

<img alt="Jarvis summoned on a phone" src="./docs/jarvis-on-a-phone.gif" />
```
