---
paths:
  - "mcp/**"
---

# Phone Notifications Into Synapse

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

The Home Assistant companion app on Android reports each notification the phone posts through its
`sensor.<phone>_last_notification` sensor: the state is the text, and the attributes carry the app
(`package`), `android.title`, `android.text`, `android.bigText` and `post_time`. The Home Assistant
event monitor (`internet-of-things/event-monitor.ts`) already receives that sensor's `state_changed`
events, and routes them to `phone/notifications.ts` instead of the device reports. Each one is
registered with Synapse as `notification_posted` from the `phone` source, with `app`, `title`,
`text` and `postedAt`. From there it is an ordinary state change: matched against subscriptions, saved
to memory, and rolled up by the delivery policy rather than waking the reactor per notification.

How these differ from the monitor's other entities:

- **Attribute-only updates count.** The monitor otherwise drops them, but two notifications in a row
  with the same text differ only in their attributes.
- **No bulking.** Each notification is its own message; the bulker would keep only the first and
  last of a burst.
- **Never a device state.** Neither this sensor nor `_last_removed_notification` is reported,
  caught up on, or stored as a device state, so the text never lands in `device_state` storage.
- **No catch-up.** The sensor holds only the latest notification, so one posted while the socket
  was down is not reported on reconnect.
- The `sensitive` label excludes the sensor as it does any other entity. A notification with neither
  a title nor text (media players, progress bars) is dropped.

**Setup:** the *Last notification* sensor and its Allow List, in the
[companion app checklist](mcp-home-assistant-companion-app-setup.md#home-assistant-companion-app-setup) below.
