---
paths:
  - "mcp/**"
---

# Visualize Vertical (Shortcuts)

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Answers "visualize…" and "generate a UI for…" with an interactive web page (an artifact), and pushes
its link to the user's phone so a tap opens it in the phone's browser. It builds nothing itself: the
page is written by a Claude Code session, which is the coding vertical's to start, and the push is
the notification vertical's to send. What lives here is the asking — the brief a session builds from —
the reading of the page it hands back, and hosting that page for a day.

**Available Shortcuts** (`visualize/shortcuts.ts`):
- **`createArtifact`**: a shortcut onto the coding vertical's `runCodingTask`. Wraps the request in a
  brief (`buildArtifactTask`) that asks for one self-contained, phone-first HTML page, handed back
  in a fenced ```` ```html ```` block at the end of the session's final message — and tells the
  session not to ask questions, touch a repository, or try to publish the page itself.
- **`openArtifactOnPhone`**: a shortcut onto the notification vertical's `sendPushNotification`,
  refusing to send without a `url`. Also how the agent sends an earlier page again.

**Available Tools** (`visualize/tools.ts`):
- **`generateUserInterface`**: the two shortcuts in order. Builds the page, reads it out of the
  session's last message (`findArtifactHtml`, which takes the *last* fenced block, and refuses a
  document that never reaches `</html>`), hosts it, and pushes the link to the phone unless
  `sendToPhone` is `false`. Returns `artifactUrl`, `expiresAt` and `sentToPhone`. A push that fails
  is reported next to the link rather than thrown, since the page exists either way.

**Hosting** (`visualize/artifact-hosting.ts`): a session run over SSH has nowhere to publish to —
asked to, it invented links like `https://artifacts.local/news-summary` — and free file hosts serve
`.html` as plain text. So the MCP server hosts the pages itself, at
`GET /artifacts/<uuid>` under `HEY_JARVIS_PUBLIC_URL`, the production MCP server's own tunnel
hostname. Not `HEY_JARVIS_CLOUDFLARED_TUNNEL_URL`: that is the ElevenLabs tests' local-testing
tunnel, only up during a test run, and links on it answer Cloudflare error 1033. Each page is a file in `$HEY_JARVIS_STORAGE_PATH/artifacts/`, so Studio's process can
store a page the MCP server serves and a restart keeps the links working. A page lives for 24 hours
(`ARTIFACT_LIFETIME_MILLISECONDS`): after that it answers 404, and expired files are deleted each
time a new page is stored. The random UUID is the only thing keeping a page private, so it is served
with `no-store`, `no-referrer` and `noindex`. If a Cloudflare Access application covers the tunnel
hostname, give `/artifacts/*` a *Bypass* policy, or the phone gets Access's login page instead.

**Agent:** `visualize` is routable, so the planner sends it visualization requests. The builder
cannot reach Jarvis's own data, so a page about the calendar, the house or the shopping list needs
that agent to fetch it first and the planner to pass it along — the agent's description says so.

**Weekly digest:** `weeklyNewsDigestWorkflow` (`web-research/workflows.ts`), scheduled for Monday
at 7:00, has the web research agent research the past week's news while `getDailyDevTopPosts`
(`web-research/tools.ts`) fetches daily.dev's most upvoted posts of the week, then hands both to
`generateUserInterface` in one brief, which builds the page and pushes it to the phone. daily.dev is
read through its GraphQL endpoint's `mostUpvotedFeed`, which needs no token; its documented public
API needs a Plus subscription. Like every page, the digest's link lives for 24 hours.

**Also reached from web research:** `visualizeResearch` (`web-research/shortcuts.ts`) is a shortcut
onto `generateUserInterface`, so "look into X and show me a chart" is one delegation to `webResearch`
— it researches, then hands its findings to the builder itself, rather than the planner chaining a
second agent that would only get the research as text. It is slow like the tool it wraps. It sits
beside Gemini's built-in search, a mix only Gemini 3 accepts in one request, so the research agent
must stay on a Gemini 3 model.

The shortcut is for research *on the web*. A request about Jarvis himself — ideas for his code, why
he failed — is not research the web can do, however it is phrased, and web research's description
says so and names the coding and reflection agents instead. Those are chained by the planner rather
than reached through more shortcuts on web research: a shortcut belongs to the agent that already
holds the context, and here web research holds none of it.

**Requirements:** the Claude Code sandbox under [Coding Agent](mcp-coding-agent.md#coding-agent);
`HEY_JARVIS_PUBLIC_URL` (in `op.optional.env`, the `Public URL` field of the `Jarvis` item), the
production MCP server's public address; plus the
companion-app notify service the [Notification Agent](mcp-notification-agent.md#notification-agent) uses for the push.

**Example Use Cases:**
- "Visualize the electricity prices for the rest of the day"
- "Generate a UI for tracking my running times"
- "Send that chart to my phone again"
