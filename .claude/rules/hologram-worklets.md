---
paths:
  - "hologram/**"
---

# Worklets

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

The drawing, the tracker and the frame clock all run on the UI thread under Reanimated, so every
exported function carries the `'worklet'` directive, helpers are declared before
their callers, and nothing closes over anything but its arguments and
module-level constants. Breaking one of those rules fails at runtime on a device
and nowhere else — the tests call these functions on the JS thread, where a
worklet is an ordinary function.

Modules inside the package import their siblings directly and never `./index`:
a circular import leaves what a worklet captured undefined, which again fails
only on a device, or in the web bundle the mobile e2e runs. Exporting a
function or a constant is safe (the `export` keyword changes nothing about how
it is captured). Moving a constant into a module of its own is safe as long as
nothing that module imports leads back to whoever imports it — `frame-timing.ts`
imports nothing at all — and moving a worklet is safe only if it is still
declared after every worklet it calls.
