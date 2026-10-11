import type { DirectCommand } from '../../utils/direct-lookup-factory.js';
import { phoneAlarmCommand } from './phone-alarm.js';

/** The Internet of Things agent's requests that can be carried out without it. */
export const internetOfThingsCommands: readonly DirectCommand[] = [phoneAlarmCommand];
