---
paths:
  - "mcp/**"
---

# Presence Vertical (Shortcuts Only)

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Answers where the primary user is. No agents, no workflows and no tools of its own — everything it
knows comes from the Internet of Things vertical, and what lives here is the *reading* of it.

**Available Shortcuts** (`presence/shortcuts.ts`):
- **`getUserLocation`**: the primary user's own location, a shortcut onto the IoT vertical's
  `inferUserLocation` narrowed to the one person this vertical is about.
- **`getPresenceDevices`**: the car and the user's phone, a shortcut onto `getAllDevices` filtered
  to the two devices any presence question turns on.

**Available Functions:**
- **`isUserHome()`**: Home Assistant already answers this — a person entity's state is the zone they
  are in, and `home` is the zone the house is in. The zone list is checked too, so a person standing
  in a named sub-zone of the property still counts as home.
- **`isUserInCar()`**: two independent signals, either of which is enough. The *phone* says so —
  companion-app activity recognition reporting `automotive`/`in_vehicle`, or a live Android Auto or
  car Bluetooth connection, which works in any car including one the house cannot see. Or the *car*
  says so — Tessie reporting somebody on board, a non-parked shift state or a non-zero speed — *and*
  the user's GPS is within 150m of it. The occupancy half is what makes the second signal usable: a
  car parked in the driveway sits within GPS range of somebody standing in the kitchen, so proximity
  alone would put the user in the car every time he is home.
- **`fetchPresenceSources()`**: both questions read the same two sources, so a caller asking more
  than one fetches once and passes the result to each. The whole house is searched only to *find*
  the car and the phone; their device ids are then remembered per user, and later calls render just
  those two (`renderDevicesById` in the IoT vertical), with states always fresh. After ten minutes
  the ids are still used and the house is searched again behind the request; a device that has
  gone, or a render that fails, falls back to the full search. `getPresenceDevices` still renders
  the whole house.

Each answer comes back as `{ answer, reason }` — the reason is carried through to the notification
routing, so a surprising route can be traced back to the sensor that caused it.

**Required Environment Variables:**
- `HEY_JARVIS_PRIMARY_USER_NAME` (optional): the primary user's name, defaulting to `Mathias`. It is
  what person entities and companion-app devices are matched against.
- `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` (optional): the device name of his phone, e.g.
  `Mathias' iPhone`. Set this when the phone is not named after its owner — companion-app devices
  are named after the phone, so without it a two-phone household cannot be told apart.
- `HEY_JARVIS_CAR_NAME` (optional): the car's name, when it is not a Tesla behind Tessie.
