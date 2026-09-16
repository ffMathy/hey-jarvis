import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Whether the app is in front, as state that re-renders when it changes.
 *
 * Two things hang off this, and both are things that should stop happening when nobody is
 * looking: the microphone, which has no business being open while the app is away, and the
 * hologram's clock, which would otherwise go on rebuilding a picture a phone is not showing.
 */
export function useIsForeground(): boolean {
  const [isForeground, setIsForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setIsForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  return isForeground;
}
