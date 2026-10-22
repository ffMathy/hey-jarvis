import { useEffect } from 'react';
import { SensorType, type SharedValue, useAnimatedReaction, useAnimatedSensor } from 'react-native-reanimated';
import { TILT_SENSOR_INTERVAL_MS } from '../index';

/** A gravity reading in Reanimated's device coordinates: see `tilt.ts`. */
export interface Gravity {
  x: number;
  y: number;
  z: number;
}

/** No reading at all, which the tilt reads as a sensor that is missing or stopped. */
export const NO_GRAVITY: Gravity = { x: 0, y: 0, z: 0 };

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

  useEffect(
    () => () => {
      gravity.value = NO_GRAVITY;
    },
    [gravity],
  );

  return null;
}
