---
paths:
  - "mcp/**"
---

# Notification Agent

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Delivers a message to a person over whichever channel actually reaches them, based on where they are:
- **5 notification tools**: `sendNotification`, `notifyDevice`, `sendPushNotification`, `setPhoneAlarm`, `getPrimaryUserPresence`
- **Local Qwen3 model** via Ollama, with a fallback provider — the agent only classifies target and urgency, so a small model is enough
- **Deterministic routing**: the channel is decided in code (`routing.ts`), not by the model
- **Presence-aware**: reads the car, the house and the phone's ringer out of Home Assistant before deciding
- **Contact resolution**: also carries `lookupContact`, so a `contact` target named without a number can be resolved to the E.164 number the call and SMS channels require, instead of being reported unreachable
- **Error reporting**: configured with the error reporting processor (see Processors section)

**Who is being notified (`target`):**
The target is an object, and there are exactly two shapes:
- `{ "type": "user" }` — the primary user of the house (Mathias). Carries no contact details: Jarvis works out how to reach him from where he is.
- `{ "type": "contact", "name": ..., "phoneNumber": ..., "email": ... }` — anybody else. Needs a phone number, an email address, or both; a contact with neither is refused.

**How the channel is chosen:**

```
target is the user?
├─ in the car?          → phone call from Jarvis (ElevenLabs), urgent or not
├─ at home?
│   ├─ urgent + phone audible   → Home Assistant Voice announcement
│   ├─ urgent + phone silenced  → push notification (time-sensitive)
│   └─ not urgent              → push notification
└─ out?
    ├─ urgent      → phone call from Jarvis
    └─ not urgent  → push notification

target is a contact?
├─ has a phone number + urgent      → phone call from Jarvis
├─ has a phone number, not urgent   → SMS via Twilio
└─ email only                       → email
```

A driver cannot read a push notification, so being in the car wins over everything else. A phone on
silent or in do-not-disturb is the user asking the house to stay quiet, so an urgent message that
would have been announced falls back to a push notification instead of being dropped.

**How presence is worked out:**
- **In the car** and **at home** are answered by the [Presence Vertical](mcp-presence-vertical-shortcuts-only.md#presence-vertical-shortcuts-only).
- **Phone silenced** is answered by this vertical's own shortcut (`notification/shortcuts.ts`),
  since whether to speak out loud is a notification question: `_ringer_mode` on silent/vibrate, any
  `_do_not_disturb` sensor that is not off, an active iOS `_focus`, or an Android
  `_interruption_filter` that is not `all`. A phone that reports nothing counts as audible, so a
  missing sensor never suppresses an urgent announcement, and another person's silent phone never
  silences the user's.
- `notification/presence.ts` composes the three into the single reading the router takes. All three
  read the same devices, so they are fetched once and handed to each.

**Asking a question (`askQuestion`):**
A notification needs no reply; a question does, so it keeps to the channels that can hear one:

```
in the car?            → phone call from Jarvis
phone silenced?        → push notification saying he can answer the next time he talks to Jarvis
at home?               → Home Assistant Voice announcement, which listens after it speaks
out?                   → phone call from Jarvis
```

Urgency does not come into it: a question holds up the work that asked it. `decideQuestionChannel`
in `routing.ts` is the tree. `askQuestion` only asks; the answer comes back as whatever the user
says next to Jarvis, and finds its way back only if the question is open. So work that asks calls
`askUserQuestion`, which opens the question with a `deliverAnswer` function (see **Questions for
the user** under [Routing](mcp-routing.md#routing)) and then asks it. It is left out of `notificationTools`, so
the notification agent cannot ask a question nobody is waiting on.

**Available Tools:**
- **`sendNotification`**: the one to use. Takes `target`, `message`, `isUrgent` and an optional
  `title`, picks the channel from the tree above, delivers it, and reports which channel it used
  and why.
- **`notifyDevice`**: announces a message on the Home Assistant Voice Preview Edition speakers via
  the firmware's ESPHome `announce` service, on every matching speaker at once. The service is
  discovered rather than configured, because the device is flashed with `name_add_mac_suffix: true`
  and is therefore called `esphome.hass_elevenlabs_<mac>_announce`.
- **`sendPushNotification`**: pushes through the Home Assistant companion app
  (`notify.mobile_app_*`). Urgent pushes ask for a time-sensitive interruption so they surface
  through a focus mode. An optional `url` makes tapping the notification open it in the phone's
  browser; it is sent as both `clickAction` (Android) and `url` (iOS), since each app ignores the
  other's key.
- **`setPhoneAlarm`**: sets an alarm on the phone through the same `notify.mobile_app_*` service,
  sending the companion app's `command_activity` with Android's `SET_ALARM` intent (hour and
  minute as `:int` extras, `SKIP_UI`, and a URL-encoded label). Fire-and-forget: Home Assistant is
  not told whether the clock app took it. The first such command makes the companion app ask for
  the "Display over other apps" permission instead of acting — a one-time step on the phone, which
  Jarvis never mentions when setting an alarm. The
  routed Internet of Things agent reaches it through its `setUserPhoneAlarm` shortcut
  (`internet-of-things/shortcuts.ts`), since the notification agent is not one the router picks.
- **`getPrimaryUserPresence`**: reports in-car / home / phone-silenced and the reason for each.
  `sendNotification` does this for itself; the tool exists for answering "where is he?" and for
  tracing a surprising route.

**Required Environment Variables:**
- `HEY_JARVIS_PRIMARY_USER_PHONE_NUMBER`: the primary user's own number in E.164 format. Needed
  before Jarvis can call him — a `user` target carries no number of its own. Resolved from
  `op://Jarvis/Primary user/Phone number` through `mcp/op.optional.env`, so a missing item only
  disables calling him rather than stopping the server.
- `HEY_JARVIS_PRIMARY_USER_NAME` (optional): the primary user's name. Defaults to `Mathias`, and is
  what person and phone entities are matched against.
- `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` (optional): device slug of his phone, e.g. `mathias_iphone`.
  Set this when the phone is not named after its owner — companion-app entities are named after the
  device, so without it a two-phone household cannot be told apart.
- `HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE` (optional): pins the companion-app notify service, e.g.
  `notify.mobile_app_mathias_iphone`, which is then called without fetching the service list at
  all. Otherwise it is discovered: the user's own `notify.<name>_phone` (e.g. `notify.mathias_phone`,
  the notify group his automations already target) wins when it exists, then the `mobile_app_*`
  phone matching his name or device slug, then the only phone. Watches (`mobile_app_*watch*`) are
  never picked, because the Wear OS companion app ignores `command_activity` and would drop an
  alarm without a word. Discovery refuses to guess between several phones. The
  service list discovery reads is kept between calls and refreshed in the background after ten
  minutes, and looked up afresh when the kept list picks nothing or a service it picked has gone.
- `HEY_JARVIS_CAR_NAME` (optional): the car's name, when it is not a Tesla behind Tessie.

**Example Usage:**
```typescript
// Let the routing decide
await executeTool(sendNotification, {
  target: { type: 'user' },
  message: 'There is water on the utility room floor.',
  isUrgent: true,
});

// Somebody else entirely
await executeTool(sendNotification, {
  target: { type: 'contact', name: 'Julie', phoneNumber: '+4512345678' },
  message: 'The Bilka order arrives between 17 and 18.',
});
```
