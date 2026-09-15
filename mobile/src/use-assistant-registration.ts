import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { type AssistantRegistration, readAssistantRegistration } from '../modules/jarvis-assistant';

/**
 * Keeps an eye on whether Jarvis is still the phone's assistant.
 *
 * The answer changes on a screen this app does not own — Android does not let an
 * app request the assistant role, so the user makes the choice in Settings — and
 * it can change while the app is in the background. Re-reading whenever the app
 * comes back to the foreground is therefore not an optimisation; it is the only
 * moment the answer can have changed without anything here being called.
 */
export function useAssistantRegistration(): AssistantRegistration {
  const [registration, setRegistration] = useState<AssistantRegistration>(readAssistantRegistration);

  const refresh = useCallback(() => setRegistration(readAssistantRegistration()), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
      }
    });

    return () => subscription.remove();
  }, [refresh]);

  return registration;
}
