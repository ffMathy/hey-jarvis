---
paths:
  - "mobile/**"
---

# The glance

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

Opened from the launcher, rather than summoned, the app shows a **glance**: a page sir's Jarvis
server made ahead of time from what it has lately seen — an email saying a parcel is due today, and
so a button to unlock the front door. Summoning is unchanged: the gesture, the plain assist intent
and the watch always get Jarvis.

```
server ─ {"type":"glance","glance":{id,url,title,generatedAt,actions:[{id,label,prompt}]}} ─▶ phone   after ready, and on every new one
phone    GlanceScreen: the page at <server>/artifacts/<uuid>, in a WebView (an <iframe> on web)
page  ─  window.jarvis.act(actionId) ─▶ postMessage {"type":"jarvisAction","actionId":…} ─▶ phone
phone    looks the id up in the glance's actions — unknown: ignored
phone    asks sir natively, showing the action's prompt — Alert.alert / window.confirm
phone ─ {"type":"glanceAction","requestId","glanceId","actionId"} ─▶ server
server ─ {"type":"glanceActionResult","requestId","ok","message"} ─▶ phone
phone ─  jarvisactionresult event {actionId, ok, message} ─▶ page   and a toast (a line on web)
```

The line's half — parsing both server messages, `ServerLink.onGlance`, `requestGlanceAction` and
`useGlance` — is `hologram`'s: see [the line to the server](hologram-what-he-is-working-on-and-what-sir-points-at-the.md).

- **Which screen is `chooseScreen` in `src/app-screen.ts`.** The glance only when the app was opened,
  is set up, has a server address and has a glance no older than `GLANCE_SHOWN_FOR_MS` (three hours,
  the server's own `GLANCE_MAX_AGE_MS`). Otherwise the conversation, exactly as before glances — no
  server, or none sent. **Never in the middle of a conversation**: the conversation screen reports
  whether one is under way (`useBackToGlance` in `src/back-to-glance.tsx`: starting, greeting,
  connecting, live, hanging up, or still fading out), and a glance that arrives meanwhile waits for
  him to go. A conversation that never opened is not under way, so a failed one gives way to the glance.
- **The latest glance is kept** (`src/glance-storage.ts`, `jarvis.glance`), and read beside the
  settings before the first screen is chosen. The line takes a socket, a hello and a `ready` to send
  one, and without a kept glance the conversation — greeting and all — would open first and the glance
  wait for it to end. The kept one is read back through `glanceOf`, and the line's replaces it.
- **Jarvis is one tap away.** A small dark button ringed in his copper (`theme.colors.jarvis`), with a
  soft glow and an orange-white core, sits over the bottom of the page (`talk-to-jarvis`). It opens the
  conversation screen; the conversation ending, back on a phone, or "Back to the glance" in a browser
  (`back-to-glance`) comes back. Summoned, none of that is there.
- **The page cannot be trusted, so sir confirms the server's words.** The HTML was written by a model
  from email content, so a button's label is no promise of what it does. A page message is read by
  `bridgeActionOf` (`src/glance-bridge.ts`) and only ever names an action id; `runGlanceAction`
  (`src/glance-actions.ts`) looks it up in the glance's own `actions`, ignores an id it does not list,
  and asks sir with the action's **`prompt`** — what the server will run — before anything is sent.
  Cancelled, the page is told `{ok:false, message:'Cancelled'}` and nothing is sent. One press at a
  time: a press while a question or a request is out is ignored, so a page cannot stack dialogs.
- **The WebView is locked down** (`src/glance-view.tsx`). Every navigation goes through
  `navigationVerdict`: the glance's own origin, exactly, loads; any other web page opens in the
  browser; anything else (`intent:`, `tel:`, `javascript:`, deep links) is blocked. `originWhitelist`
  is `['*']` on purpose: the library's own check matches an origin's *start*, so
  `https://jarvis.example.com.evil.example` passed it, and it hands what fails to `Linking` whatever its
  scheme. No file access, no new windows, no mixed content, JavaScript on for the bridge. A message
  counts only from a page on the glance's origin. The result goes back by `injectJavaScript`
  (`resultDeliveryScript`, every value written as JSON).
- **In a browser it is a sandboxed `<iframe>`** (`src/glance-view.web.tsx`): scripts, forms and its
  own (the server's) origin, popups as real tabs, no top navigation. A message counts only from that
  frame's window and the glance's origin, and the answer is posted to that origin alone. Where a link
  goes *inside* the frame is the browser's, and is not checked.

`react-native-webview` is at **13.16.1**, the version Expo 57's `bundledNativeModules.json` pins; it
needs no config plugin and autolinks. It has no web implementation, and the web build never imports
it — that is what the `.web.tsx` pair is for.

**Tested:** `app-screen.spec.ts`, `glance-bridge.spec.ts`, `glance-actions.spec.ts` and
`glance-storage.spec.ts` offline; and in `tests/e2e/web-app.spec.ts` a Jarvis server played by the
test (`playTheJarvisServer`: the `/api/live` socket answering the hello with `ready` and a `glance`,
and every `glanceAction` with a result, and the page served by `page.route`) — the app opened on the
glance's `<iframe>` at its URL, the talk button and the way back, an unlisted action asking nothing, a
press asking `window.confirm` with the prompt rather than the button's label, the `glanceAction` frame
naming the glance and the action, the result reaching the page and the notice; a cancel sending
nothing and telling the page; and a server with no glance opening on the conversation as before.

**Not yet seen on a device:** the WebView itself — `onShouldStartLoadWithRequest` on Android for
links and redirects, `injectJavaScript` reaching the bridge, the dialog, the toast, and back.
