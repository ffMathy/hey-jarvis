---
paths:
  - "mcp/**"
---

# Integration Capabilities

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## Internet of Things (IoT)
- Voice command processing through ESPHome firmware
- Smart device control and automation
- Alarms on the user's phone, through the companion app (`setUserPhoneAlarm`, a shortcut onto the notification vertical's `setPhoneAlarm`)
- **Everyday control is one tool call.** "Turn off the living room lights" is `callIoTService`
  with `{"area_id": "living_room"}`, made without any lookup: the agent's instructions list the
  home's areas (cached for ten minutes, refreshed in the background), and Home Assistant targets
  a whole area, or a list of entities, in one call. `findEntities` returns only id, name, area and
  state for when ids are needed; `getAllDevices`, with every attribute, is for when they matter.
  The agent runs at `low` thinking (`LOW_THINKING_PROVIDER_OPTIONS`), since each step of its tool
  loop is a wait before the house changes. Routing logs `elapsedMs` for the plan, its
  registration and each delegation, and `callIoTService` logs the service call itself, so a slow
  request can be read back as a breakdown
- **Reports the entities it touches**, for sir's headset to light up (see
  [What a request touches](mcp-routing-affected-entities.md#affected-entities)). `callIoTService` resolves the entities a call
  reaches alongside the call itself (`resolveServiceTargets`), from the cached copy of the house or
  else with one template render: the ids it names, and the service domain's entities in the areas
  and devices it names. The lookup is given up on after 1.5 seconds and can never fail the call, and its result is also returned to the agent as
  `targets`. `findEntities` reports a handful of matches and `getEntityLogbook` the entity it read.
  A command carried out without the agent (`runHomeCommand` in `home-commands.ts`) reports the
  entities it called the service on. Given an entity id — the thing sir is pointing at — the agent
  acts on exactly that id with no lookup
- Sensor data processing and analysis
- Scene and routine management

### Home Assistant Event Monitor
`verticals/internet-of-things/event-monitor.ts` holds one subscription to Home Assistant's
websocket API (through the official `home-assistant-js-websocket` client) and files what happens in
the house for the State Change Reactor as it happens. It is started by `mcp-server.ts` only, the
process that also owns the schedules, so Studio never files a change twice.

- **What it listens to.** `state_changed` events whose state value moved (attribute-only updates
  and entities being added or removed are dropped), and every other bus event except
  `IGNORED_EVENT_TYPES` — Home Assistant's own bookkeeping, plus `call_service`,
  `automation_triggered` and `script_started`, whose effects are reported as state changes anyway.
  Other events are what bring button presses, doorbells and tag scans to the reactor, filed as
  `home_assistant_event`; state changes keep the `device_state_change` type. The companion app's
  notification sensors are the exception: they are routed to the phone vertical, not reported as
  device states (see [Phone Notifications Into Synapse](mcp-phone-notifications-into-synapse.md#phone-notifications-into-synapse)).
- **Spammy sources are bulked** (`change-bulker.ts`). Changes are collected per entity, or per event
  type and source. A quiet bucket is released after 30 seconds; one that reaches 5 changes is spammy
  and held for 10 minutes, then reported once with `changeCount`/`occurrences`, the first and last
  value and the distinct values in between.
- **Filtering** (`change-reports.ts`). Anything whose entity or device carries the `sensitive` label
  is dropped. A state bucket is dropped as noise unless some value it passed through differs from
  where it started by more than the entity's noise baseline, so a door that opened and closed inside
  one window is still reported.
- **Catch-up.** On every connect and reconnect it compares `get_states` against the last states it
  saw (persisted in `iot_device_states`) and reports what changed while it was away.
- **A copy of the house for the lookups** (`home-state-cache.ts`). The same connection keeps every
  state current through `subscribe_entities`, plus the entity, device and area registries, which are
  fetched again on their `*_registry_updated` events and on every reconnect. Since the states are
  only patched by deltas, the whole copy is also fetched again every hour: the registries are
  refetched and `subscribe_entities` is reopened (after the client library's 5-second grace period,
  so Home Assistant sends every state afresh), with the old copy answering meanwhile. `findEntities`,
  `getAllDevices`, `getChangedDevicesSince`, `inferUserLocation`, the areas in the agent's
  instructions, the targets `callIoTService` resolves and the home commands and questions answered
  without the agent all read it, with no request to Home Assistant. Its readers return exactly
  what the templates they replace render. The copy is only used while it is complete and the socket
  is up. Before the first states arrive, from a drop until the states after the reconnect, and in
  every process without the monitor (Studio, the tests), the lookups render templates over REST
  as before.

## Model Context Protocol (MCP)
- Server-client communication for tool sharing
- Resource management and discovery
- Secure agent-to-agent communication
- Real-time data synchronization

## Voice Interface
- Speech-to-text processing
- Natural language understanding
- Text-to-speech generation with ElevenLabs
- Wake word detection and response
