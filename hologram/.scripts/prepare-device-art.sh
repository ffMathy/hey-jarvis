#!/bin/bash
# Fetches and prepares the device art the showcase renders Jarvis inside.
#
# Nothing here is drawn by us and nothing is traced. The phone is Google's own device art — the
# same frame Android Studio wraps a screenshot in — the watch is a community vector of a Pixel
# Watch 3, and the wallpaper is a NASA photograph. Provenance and licences are in
# `device-art/NOTICE.md`, which is written by hand rather than by this script: read it first.
#
# Run from the repository root, and only when the art needs regenerating:
#   ./hologram/.scripts/prepare-device-art.sh
#
# Needs `curl`, `cairosvg` and Python with Pillow. What it produces is committed, so nobody
# rendering the showcase has to run this or be online.
set -euo pipefail

art="hologram/.scripts/device-art"

# How wide the frames are committed, in pixels.
#
# Twice what the showcase renders them at, and no more. The art arrives far larger than that — the
# Pixel frame is 1410 px across — and shrinking it by three and a half times while drawing is what
# put a jagged edge round the watch's screen. Reduced to 2:1 here, with a proper filter, the
# renderer's own scaling has almost nothing left to do. Keep this at twice PHONE_WIDTH and
# WATCH_WIDTH in `render-showcase.ts`.
export ART_WIDTH=840
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

aosp="https://android.googlesource.com/platform/tools/adt/idea/+/refs/heads/mirror-goog-studio-main/artwork/resources/device-art-resources"
commons="https://upload.wikimedia.org/wikipedia/commons"
agent="hey-jarvis-showcase/1.0 (https://github.com/ffMathy/hey-jarvis)"

echo "Fetching the Pixel 10 Pro frame from AOSP..."
# Gitiles serves blobs base64-encoded, which is the only way to get a binary file out of it.
curl -sS "$aosp/pixel_10_pro/back.webp?format=TEXT" | base64 -d > "$work/pixel-10-pro.webp"
curl -sS "$aosp/pixel_10_pro/layout?format=TEXT" | base64 -d > "$work/pixel-10-pro.layout"

echo "Fetching the Pixel Watch 3 vector from Wikimedia Commons..."
curl -sSL -A "$agent" "$commons/6/61/Google_Pixel_Watch_3-45_%28Matte_Black_%2B_Obsidian%29.svg" > "$art/pixel-watch-3.svg"

echo "Fetching Roboto Light from Google Fonts..."
# Asked for by stylesheet rather than by a direct link, because the direct links are versioned and
# hashed and go stale. A plain curl user agent is what makes Google answer with a TrueType file
# instead of the WOFF2 a browser would get, and TrueType is what Skia can load.
roboto=$(curl -sS "https://fonts.googleapis.com/css2?family=Roboto:wght@300" -H "User-Agent: curl/7.0" | grep -oE 'https://[^)]+\.ttf' | head -1)
if [ -z "$roboto" ]; then
  echo "Google Fonts did not answer with a TrueType URL." >&2
  exit 1
fi
curl -sSL -A "$agent" "$roboto" > "$art/roboto-light.ttf"

echo "Converting..."
# One change to the vector, and it is why the SVG is committed beside the PNG rather than only the
# PNG: the screen is a light-grey filled circle drawn on top of the case, and the showcase paints
# Jarvis over it. Left light, every pixel the clip's antialiasing does not quite cover shows up as a
# pale ring round the screen. Black, and there is nothing to show.
python3 - "$art/pixel-watch-3.svg" <<'SCREEN'
import sys
path = sys.argv[1]
source = open(path).read()
changed = source.replace('r="99.475" fill="#ddd"', 'r="99.475" fill="#000"')
if changed == source:
    raise SystemExit('The screen circle is not where it was: re-read the SVG before changing this.')
open(path, 'w').write(changed.replace('<svg ', '<!-- Screen fill blacked out; see NOTICE.md. -->\n<svg ', 1))
SCREEN

# Rasterised here rather than at render time, so nothing about the showcase depends on having an
# SVG renderer installed. At ART_WIDTH, for the reason given there.
cairosvg "$art/pixel-watch-3.svg" -o "$art/pixel-watch-3.png" --output-width "$ART_WIDTH"

WORK="$work" ART="$art" python3 - <<'PY'
import os
import re
import random
from PIL import Image, ImageDraw

work = os.environ['WORK']
art = os.environ['ART']

# ---- the phone -------------------------------------------------------------------------------
# WebP to PNG and nothing else. The frame already has a screen-shaped hole through it with the
# camera drawn inside the hole, so the showcase draws the screen first and this over the top.
wide = int(os.environ['ART_WIDTH'])
phone = Image.open(os.path.join(work, 'pixel-10-pro.webp')).convert('RGBA')
native = phone.size
phone = phone.resize((wide, round(wide * phone.height / phone.width)), Image.LANCZOS)
phone.save(os.path.join(art, 'pixel-10-pro.png'))

# ---- the wallpaper ---------------------------------------------------------------------------
# The one thing here that is ours rather than somebody else's, and it took four goes to work out
# why. It began as a photograph — Earth from Apollo 17, then Hubble's Westerlund 2 — and both were
# wrong in the same way: a photograph has detail and contrast in every square inch, and behind a
# hologram that is noise competing with the thing you are meant to be looking at. Flat concentric
# rings fixed that and were wrong the other way, too tidy to read as a wallpaper at all. This is the
# middle: a handful of large soft shapes, off-centre, at angles that line up with nothing.
#
# Composed for what is left visible. The assistant's sheet covers the bottom 40%, so everything
# worth seeing is in the top three fifths and the shapes run off underneath it.
#
# It is also, incidentally, the kindest thing that can be handed a GIF's 256-colour palette: six
# flat tones and one gradient, against a photograph's thousands.
WIDE, TALL = 780, 1740
# Drawn three times over and scaled back down, which is where the curves get their edges: Pillow
# has no antialiasing of its own.
OVER = 3
# Fixed, so the wallpaper is the same every time this is run. Chosen by generating a handful and
# looking at them — there is nothing else this number means.
SEED = 21

GROUND_TOP, GROUND_BOTTOM = (24, 44, 82), (16, 30, 58)
TONES = [(36, 70, 124), (52, 104, 168), (88, 150, 204), (142, 196, 228), (202, 229, 241)]
ACCENT = (238, 172, 136)

def blob(canvas, centreX, centreY, across, down, turn, colour):
    """One ellipse, rotated. Drawn into a layer of its own because Pillow cannot rotate a shape."""
    pad = round(max(across, down) * 1.6)
    layer = Image.new('RGBA', (pad, pad), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        [pad / 2 - across / 2, pad / 2 - down / 2, pad / 2 + across / 2, pad / 2 + down / 2],
        fill=colour + (255,),
    )
    canvas.alpha_composite(layer.rotate(turn, resample=Image.BICUBIC), (round(centreX - pad / 2), round(centreY - pad / 2)))

random.seed(SEED)
ground = Image.new('RGB', (WIDE * OVER, TALL * OVER))
pen = ImageDraw.Draw(ground)
for line in range(TALL * OVER):
    share = line / (TALL * OVER)
    pen.line([(0, line), (WIDE * OVER, line)], fill=tuple(round(top + (bottom - top) * share) for top, bottom in zip(GROUND_TOP, GROUND_BOTTOM)))

canvas = ground.convert('RGBA')
# Light on dark, roughly in that order, so the pale shapes land on top of the deep ones.
for tone in (TONES[0], TONES[1], TONES[2], TONES[1], TONES[3], TONES[2], TONES[4]):
    across = random.uniform(340, 900) * OVER
    blob(
        canvas,
        random.uniform(-0.15, 1.15) * WIDE * OVER,
        random.uniform(-0.05, 0.72) * TALL * OVER,
        across,
        across * random.uniform(0.55, 0.95),
        random.uniform(0, 180),
        tone,
    )
# One warm shape, because a wallpaper of a single hue is a swatch.
blob(
    canvas,
    random.uniform(0.15, 0.85) * WIDE * OVER,
    random.uniform(0.05, 0.5) * TALL * OVER,
    random.uniform(180, 320) * OVER,
    random.uniform(150, 280) * OVER,
    random.uniform(0, 180),
    ACCENT,
)
# And two long thin ones, to break up all that roundness.
for _ in range(2):
    blob(
        canvas,
        random.uniform(0, 1) * WIDE * OVER,
        random.uniform(0, 0.7) * TALL * OVER,
        random.uniform(700, 1200) * OVER,
        random.uniform(40, 90) * OVER,
        random.uniform(0, 180),
        random.choice(TONES[2:]),
    )

canvas.convert('RGB').resize((WIDE, TALL), Image.LANCZOS).save(os.path.join(art, 'wallpaper.jpg'), quality=92, optimize=True)

# ---- and what the renderer needs to know about them ------------------------------------------
# The showcase carries the screen windows as fractions of each frame's size. They are printed here,
# measured from the art itself, so that updating the art means copying six numbers rather than
# guessing at them. See SCREEN in `render-showcase.ts`.
print()
print('Screen windows, as fractions — check these against SCREEN in render-showcase.ts:')

display = re.search(r'display\s*\{([^}]*)\}', open(os.path.join(work, 'pixel-10-pro.layout')).read())
said = {key: int(value) for key, value in re.findall(r'(\w+)\s+(\d+)', display.group(1))}
part = re.search(r'name\s+device\s+x\s+(\d+)\s+y\s+(\d+)', open(os.path.join(work, 'pixel-10-pro.layout')).read())
left, top = int(part.group(1)), int(part.group(2))
wide, tall = native
print(f"  phone  art {phone.size[0]}x{phone.size[1]} (from {native[0]}x{native[1]}), "
      f"hole {said['width']}x{said['height']} at ({left},{top}) r={said['corner_radius']}")
print(f"         x={left / wide:.6f} y={top / tall:.6f} width={said['width'] / wide:.6f} "
      f"height={said['height'] / tall:.6f} radius={said['corner_radius'] / wide:.6f}")

# The watch's screen is a filled circle rather than a hole — the case is drawn behind it — so it is
# measured from the vector rather than from the pixels, which are now black on a dark case and have
# no edge left to find. The circle is `r` less half its stroke, in the SVG's own units.
face = re.search(r'<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#000"[^>]*stroke-width="([\d.]+)"', open(os.path.join(art, 'pixel-watch-3.svg')).read())
box = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', open(os.path.join(art, 'pixel-watch-3.svg')).read())
shift = re.search(r'translate\(0 (-?[\d.]+)\)', open(os.path.join(art, 'pixel-watch-3.svg')).read())
watch = Image.open(os.path.join(art, 'pixel-watch-3.png'))
units = float(box.group(1)) / watch.size[0]
centreX = float(face.group(1)) / units
centreY = (float(face.group(2)) + float(shift.group(1))) / units
radius = (float(face.group(3)) - float(face.group(4)) / 2) / units
wide, tall = watch.size
print(f'  watch  art {wide}x{tall}, screen circle centre ({centreX},{centreY}) radius {radius}')
print(f'         centreX={centreX / wide:.6f} centreY={centreY / tall:.6f} radius={radius / wide:.6f}')
PY

echo
echo "Done:"
ls -la "$art"
