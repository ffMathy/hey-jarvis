---
paths:
  - "mobile/**"
---

# How it fits together

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

```
phone (launcher), with a glance from the server
  └─ GlanceScreen                           src/glance-screen.tsx
       ├─ WebView (<iframe> on web)          → the glance's page, <server>/artifacts/<uuid>
       ├─ an action, once sir confirms        → glanceAction on the live line, glanceActionResult back
       └─ talk button                         → ConversationScreen, and back when it ends

phone (assist gesture)
  └─ JarvisVoiceInteractionSession          modules/jarvis-assistant (Kotlin)
       └─ heyjarvis://assist                deep link into the app
            └─ ConversationScreen           src/conversation-screen.tsx
                 ├─ POST /api/paired/conversation       → sir's Jarvis server, with the device token;
                 │                                        it asks ElevenLabs with its own key
                 ├─ WebRTC session                      → the ElevenLabs Jarvis agent
                 ├─ camera button                       → sir's Jarvis server: POST /api/photos/slots,
                 │                                        then PUT the photo to the slot
                 └─ live line                           → sir's Jarvis server: a WebSocket on /api/paired/live,
                                                          open for as long as the app runs
```

The agent on the other end is the same one `elevenlabs/` deploys, with the same prompt and the same `routePromptWorkflow` tools. This app adds a way to reach it, not a second Jarvis. Everything goes through sir's Jarvis server, which this phone is paired with — the only way the app is set up (see [Configuration](mobile-configuration.md#configuration)): every conversation is asked of it, the camera sends its photos there ("Showing him something"), and the line to it (`jarvis-server-link.ts` in `hologram`) opens with the device token. The line is opened by `app.tsx` (`useJarvisServer`) as soon as the app is paired, and stays open across conversations and between them. What it hears of his agents at work (`useAgentSatellites`) is put round him as satellites on whichever screen shows him, through `AgentSatellitesContext` at the top of the app: see "Which agents are at work" in `.claude/rules/hologram.md`. The pairing is handed to the watch, which shares it, so it opens the same line. The same line brings the glance the app opens on from the launcher, and carries its actions back (`useOpeningGlance`, and [The glance](mobile-the-glance.md)); before the server has sent a glance, the launcher opens the conversation as it always did.
