import { fetchPresenceSources, getPrimaryUserName, isUserHome, isUserInCar } from '../presence/index.js';
import { isUserPhoneSilenced } from './shortcuts.js';

/** The three questions the notification router asks about the primary user. */
export interface UserPresence {
  userName: string;
  isHome: boolean;
  isInCar: boolean;
  isPhoneSilenced: boolean;
  /** Why each verdict came out the way it did. Reported by the tools so a surprising route can be traced. */
  reasons: {
    home: string;
    car: string;
    phone: string;
  };
}

/**
 * Where the primary user is, and whether his phone would make a sound.
 *
 * The three answers come from two verticals — the presence vertical for the car and the house, the
 * notification vertical's own shortcut for the ringer — but all three read the same devices, so
 * they are fetched once here and handed to each rather than fetched three times.
 */
export async function getUserPresence(userName: string = getPrimaryUserName()): Promise<UserPresence> {
  const sources = await fetchPresenceSources(userName);

  const [home, car, phone] = await Promise.all([
    isUserHome(sources),
    isUserInCar(sources),
    isUserPhoneSilenced(sources.devices),
  ]);

  return {
    userName,
    isHome: home.answer,
    isInCar: car.answer,
    isPhoneSilenced: phone.answer,
    reasons: {
      home: home.reason,
      car: car.reason,
      phone: phone.reason,
    },
  };
}
