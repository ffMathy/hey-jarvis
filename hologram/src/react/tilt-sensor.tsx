import { useEffect } from 'react';
import {
  InterfaceOrientation,
  SensorType,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedSensor,
  type Value3D,
} from 'react-native-reanimated';
import { type Gravity, TILT_SENSOR_INTERVAL_MS } from '../index';

/** No reading at all, which the tilt reads as a sensor that is missing or stopped. */
export const NO_GRAVITY: Gravity = { x: 0, y: 0, z: 0 };

/** The same in Reanimated's own shape, for its copy of the latest reading. */
const NO_READING: Value3D = { ...NO_GRAVITY, interfaceOrientation: InterfaceOrientation.ROTATION_0 };

/**
 * The phone's gravity, copied into `gravity` as each reading arrives, for the tilt to look around
 * him by. Renders nothing.
 *
 * A component of its own so that it can be mounted only while there is something to tilt — the
 * phone asking for it, the app in front and the GPU body there to draw it — because nothing else
 * stops the sensor. Reanimated registers a listener when this mounts and unregisters it only when
 * this unmounts, and every reading runs a worklet on the thread that draws him. Unmounted, it
 * leaves no reading behind, and the tilt eases him back to straight on.
 *
 * **Nor does Reanimated.** It keeps one sensor per kind for the life of the app, with the latest
 * reading in it, and unregistering stops the readings without clearing it — and a reaction runs
 * once as it starts, before the next reading can arrive. Mounted again on his next arrival, this
 * would hand the tilt the reading from before the app went away as the first of the new showing,
 * and the tilt would take it for the rest pose: he would arrive turned by however far the phone
 * moved meanwhile, and drift back over seconds. So the copy is cleared on the way out too, after
 * the sensor has been unregistered, and the first reading he is shown with is a fresh one.
 *
 * GRAVITY rather than the others: Reanimated's ACCELEROMETER has gravity taken out, and ROTATION is
 * the rotation vector, which reads the compass, so turning on a chair would tilt him.
 */
export function TiltSensor({ gravity }: { gravity: SharedValue<Gravity> }) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: TILT_SENSOR_INTERVAL_MS });

  useAnimatedReaction(
    () => sensor.sensor.value,
    (reading) => {
      gravity.value = reading;
    },
  );

  // Declared after `useAnimatedSensor`, so on unmount it runs after the sensor is unregistered.
  const latest = sensor.sensor;
  useEffect(
    () => () => {
      gravity.value = NO_GRAVITY;
      latest.value = NO_READING;
    },
    [gravity, latest],
  );

  return null;
}
