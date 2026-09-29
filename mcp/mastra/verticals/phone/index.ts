// Phone vertical exports
export {
  type Contact,
  type ContactPhoneNumber,
  clearContactsCache,
  contactTools,
  getContacts,
  lookupContact,
  normalizePhoneNumber,
  rankContacts,
  scoreContactMatch,
  toContact,
} from './contacts.js';
export {
  isLastNotificationSensor,
  isNotificationSensor,
  type PhoneNotification,
  readNotificationAttributes,
  toNotificationStateChange,
} from './notifications.js';
export { initiatePhoneCall, phoneTools, sendTextMessage } from './tools.js';
