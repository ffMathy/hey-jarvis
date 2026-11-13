import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Whether the app is in front, as state that re-renders when it changes.
 *
 * What hangs off this should stop happening when nobody is looking: the hologram's clock, which
 * would otherwise go on rebuilding a picture a phone is not showing, and the watch card's checks.
 * The microphone does not: a conversation goes on behind the camera app, which takes the screen in
 * the middle of one. Back is what ends it (`back-press.ts` in the phone app).
 */
export function useIsForeground(): boolean {
  const [isForeground, setIsForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setIsForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  return isForeground;
}
