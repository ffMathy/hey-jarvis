---
paths:
  - "mcp/**"
---

# Home Assistant Companion App Setup

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Jarvis reads the primary user's Android phone entirely through the Home Assistant companion app:
where he is, whether he is driving, whether the phone is silenced, and what notifications it gets. It
also sends to the phone through the app. Every toggle below is in the companion app unless stated
otherwise, and most are under **Settings → Companion app → Manage sensors**.

**Home Assistant side:**

- **Assign the phone to the user's person.** Go to Settings → People → *the user* → *Track device*
  and add the phone's `device_tracker`. The `person` entity is what "is he home" and "how far is he
  from the car" are answered from (`inferUserLocation`). A phone that isn't assigned to a person
  gives no location at all.
- **Tell Jarvis which phone is his.** Companion-app devices are named after the phone ("Pixel 9"),
  not after the user. Do one of these:
  - set `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` to the device name;
  - name the device after the user;
  - make a notify group called `notify.<user>_phone`.

  In a household with only one phone, none of this is needed.

**Companion app:**

| Toggle | Where | Permission | Used for |
| --- | --- | --- | --- |
| Background location | Location sensors | Location → *Allow all the time* | The user's zone and GPS fix: home or away, distance to the car |
| Detected activity | Activity sensors | Physical activity | "In vehicle" means he is driving, so an urgent message becomes a call |
| Android Auto | Android Auto sensors | — | Connected to the car, so the same as driving |
| Ringer mode | Audio sensors | — | Silent or vibrate means an urgent message is not spoken out loud in the house |
| Do not disturb | Do not disturb sensors | — | Same as ringer mode, for DND and its priority-only modes |
| Battery level | Battery sensors | — | Only used to recognise the device as a phone |
| Last notification | Notification sensors | Notification access; set the **Allow List** | Feeds the phone's notifications into Synapse (see [above](mcp-phone-notifications-into-synapse.md#phone-notifications-into-synapse)) |
| Notifications | Android app settings → Notifications | Allow notifications | Push notifications from `sendPushNotification` / `sendNotification` |
| Display over other apps | Android app settings | Display over other apps | `command_activity`, which is how Jarvis sets an alarm on the phone |

Notes:

- **Leave *Last removed notification* off.** Jarvis never reads it and keeps it out of every report,
  so enabling it only costs battery.
- **Allow List for *Last notification*:** everything allowed ends up in shared memory, so leave out
  banking, one-time codes and the like.
- **Display over other apps can't be requested up front.** The companion app asks for it the first
  time a `command_activity` arrives, so the first alarm Jarvis sets only opens that prompt. Grant it,
  and every alarm after that works.
- **Battery:** set the companion app's battery usage to *Unrestricted* in Android's app settings.
  Otherwise Android defers its background updates, and the location, activity and notification
  sensors can be minutes behind. Jarvis would then route messages based on where the user was, not
  where he is.
- **A Wear OS watch** with the companion app registers as a device of its own. Jarvis never sends to
  it, because the phone mirrors its notifications onto the watch anyway, so nothing on the watch
  needs enabling.
- **A reinstalled app** comes back as a new device. Assign its new `device_tracker` to the person
  again. The rest is picked up on its own within ten minutes.
