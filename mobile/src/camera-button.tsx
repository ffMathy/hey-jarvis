import { SPHERE_FRACTION } from 'hologram';
import { Pressable, StyleSheet, View } from 'react-native';
import { theme } from './theme';

/** How big the button is, and so how much of it there is to press. */
const BUTTON_SIZE = 40;

/**
 * How far out from the sphere's centre the button sits, as a share of the sphere's radius.
 *
 * Just outside the limb, with room for the swell his voice gives the sphere, so the button sits
 * beside him rather than on him.
 */
const BESIDE_THE_LIMB = 1.2;

/** Down and to the right, 45 degrees: the side the rim's slabs of light never break off from. */
const DIAGONAL = Math.SQRT1_2;

interface CameraButtonProps {
  /** Whether it is on screen at all. See `showsCameraButton` in `conversation-screen.tsx`. */
  visible: boolean;
  /** The hologram's square, whose centre the sphere is drawn around. See `hologram-size.ts`. */
  hologramSize: number;
  onPress: () => void;
}

/**
 * The one thing on the conversation screen that is not him: a small camera beside the sphere.
 *
 * **Faint until it is pressed.** A muted outline at half strength, at the sphere's lower right, is
 * something to find rather than something to read — the screen's argument is still that it has
 * nothing on it but him. It takes the accent colour only under a finger. Jarvis cannot light it up
 * or open the camera himself: showing him something is sir's to decide, and this is the only way in.
 *
 * **Drawn from views, not an icon set or Skia.** No icon library is installed, and Skia may not be
 * touched on this screen before CanvasKit has loaded in a browser — which is the whole reason
 * `jarvis-hologram.web.tsx` exists.
 *
 * Positioned from the middle of the screen, where the sphere is, rather than laid out: the square
 * he is drawn in is wider than the screen, and anything taking part in the layout would push him
 * off centre. The typed field and the problem line are placed the same way, for the same reason.
 */
export function CameraButton({ visible, hologramSize, onPress }: CameraButtonProps) {
  if (!visible) {
    return null;
  }
  const radius = SPHERE_FRACTION * hologramSize;
  // Its centre, along the diagonal, far enough out that its nearest corner clears the limb.
  const fromTheMiddle = (radius * BESIDE_THE_LIMB + BUTTON_SIZE / 2) * DIAGONAL;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send Jarvis a photo"
      hitSlop={theme.spacing.small}
      onPress={onPress}
      style={[
        styles.button,
        {
          marginLeft: fromTheMiddle - BUTTON_SIZE / 2,
          marginTop: fromTheMiddle - BUTTON_SIZE / 2,
        },
      ]}
      testID="open-camera"
    >
      {({ pressed }) => <CameraGlyph colour={pressed ? theme.colors.accent : theme.colors.mutedText} />}
    </Pressable>
  );
}

/** A camera in three strokes: the body, the lens, and the bump the shutter sits on. */
function CameraGlyph({ colour }: { colour: string }) {
  return (
    <View style={styles.glyph}>
      <View style={[styles.bump, { backgroundColor: colour }]} />
      <View style={[styles.body, { borderColor: colour }]}>
        <View style={[styles.lens, { borderColor: colour }]} />
      </View>
    </View>
  );
}

const STROKE = 1.5;

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    // Half strength: something to find, not something to read.
    opacity: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    alignItems: 'center',
  },
  bump: {
    width: 8,
    height: 3,
    borderTopLeftRadius: STROKE,
    borderTopRightRadius: STROKE,
  },
  body: {
    width: 22,
    height: 15,
    borderWidth: STROKE,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lens: {
    width: 8,
    height: 8,
    borderWidth: STROKE,
    borderRadius: 4,
  },
});
