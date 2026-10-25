---
paths:
  - "mobile/**"
---

# How it fits together

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

```
phone (assist gesture)
  └─ JarvisVoiceInteractionSession          modules/jarvis-assistant (Kotlin)
       └─ heyjarvis://assist                deep link into the app
            └─ ConversationScreen           src/conversation-screen.tsx
                 ├─ GET /v1/convai/conversation/token   → ElevenLabs, with the API key
                 ├─ WebRTC session                      → the ElevenLabs Jarvis agent
                 ├─ camera button (optional)            → sir's Jarvis server: POST /api/photos/slots,
                 │                                        then PUT the photo to the slot
                 └─ live line (optional)                → sir's Jarvis server: a WebSocket on /api/live,
                                                          open for as long as the app runs
```

The agent on the other end is the same one `elevenlabs/` deploys, with the same prompt and the same `routePromptWorkflow` tools. This app adds a way to reach it, not a second Jarvis. The camera button and the live line are the two things that reach past ElevenLabs, and only once sir has given the phone his Jarvis server's address: see "Showing him something", and `jarvis-server-link.ts` in `hologram` for the line. The line is opened by `app.tsx` (`useJarvisServer`) as soon as there is an address, and stays open across conversations and between them. What it hears of his agents at work (`useAgentSatellites`) is put round him as satellites on whichever screen shows him, through `AgentSatellitesContext` at the top of the app: see "Which agents are at work" in `.claude/rules/hologram.md`. The address is handed to the watch with the credentials, so it opens the same line.
