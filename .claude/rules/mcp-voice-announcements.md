---
paths:
  - "mcp/**"
---

# Voice Announcements

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Announcing on the Home Assistant Voice Preview Edition speakers is a tool (`notifyDevice`), not a
workflow — there is nothing to orchestrate, and the routing that decides *whether* to announce lives
in the notification vertical (see [Notification Agent](mcp-notification-agent.md#notification-agent)).

**Technical Implementation:**
- Uses the ESPHome API service the Hey Jarvis firmware exposes: `esphome.{device_name}_announce`
- Parameters: `message` (string), `silence_seconds` (integer)
- The device is flashed with `name_add_mac_suffix: true`, so the service name carries a MAC suffix
  and is discovered from Home Assistant at call time rather than hardcoded
- The device speaks the message and then stays in a normal conversation until the room has been
  silent for `silence_seconds`, so the user can simply answer back
- An announcement is suppressed by the device itself while its master mute switch is on

**Usage Example:**
```typescript
await executeTool(notifyDevice, {
  message: 'Sir, your meeting starts in 5 minutes',
  deviceName: 'kitchen', // Optional: announces on every voice device when omitted
  silenceSeconds: 3, // Optional: defaults to 3
});
```

**ESPHome Device Configuration:**
The target device must expose this service (it is part of
`home-assistant-voice-firmware/home-assistant-voice.elevenlabs.yaml`):
```yaml
api:
  services:
    - service: announce
      variables:
        message: string
        silence_seconds: int
      then:
        - elevenlabs_stream.start:
            initial_message: !lambda 'return message;'
            timeout: !lambda 'return silence_seconds > 0 ? silence_seconds * 1000 : 3000;'
```
