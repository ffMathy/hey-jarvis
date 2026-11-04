---
paths:
  - "mobile/**"
---

# First run

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

A new install opens on a two-step tour (`src/onboarding-screen.tsx`), not on a bare field. A field asking for a server's address is an unanswerable question to somebody who has not been told that Jarvis lives on that server.

| Step | What it does |
| --- | --- |
| `server` | What the Jarvis server is — it holds the ElevenLabs key and the agent, reaches sir's calendar, shopping list and house, and starts every conversation on every device — and pairing this device with it (`server-pairing.tsx`, the same form as the settings screen's). Pairing is what completes the step |
| `assistant` | The recommendation to hand Jarvis the assistant role, and the button that opens the picker — plus the watch card, when there is a watch, which is where the pairing is handed across to it if the phone's own sending missed it |

It used to open on two steps for an ElevenLabs key — `agent`, what an ElevenLabs agent is and the links to make one, and `credentials`, the API key, the agent ID and, optionally, the server and a Cloudflare Access service token. No app needs a key any more: the server holds it, and pairing is the only way in (see [Configuration](mobile-configuration.md#configuration)).

Five things about it are decisions rather than details:

- **The steps and their order live in `src/onboarding.ts`, which imports nothing.** `bun test` cannot parse React Native's Flow types, so anything a test needs an opinion about has to be outside the components — the same reason the contract specs read Kotlin as text. `onboarding.spec.ts` covers the order, the one-step shape in a browser, resuming, and the count.
- **A browser gets one step, and no count.** There is no assistant role in a browser and no picker to send anyone to, so the last step would be a recommendation nobody could act on. `onboardingSteps` leaves it out, and the screen shows no "Step 1 of 1".
- **Pairing moves the step on, and nothing else does.** The server step has no Next until the device is paired. A browser pairs in the tap, and moves on in the same tap (`pairAndGoOn`): pairing it leaves no step to walk, and the app shows the conversation before an effect could run. The phone pairs in the browser and the token comes back later, on the app's own link, so the step also moves on whenever a *new* device token arrives while it is showing — a new one, so that going Back and pairing again moves on too, and a pairing already there when the step was shown does not.
- **The pairing is kept the moment it arrives, not at the end.** The next step sends the user out to Android's Settings, and the app is not guaranteed to come back alive. Which is why a tour that is resumed on a paired phone picks up *after* the server step (`isPaired` in `OnboardingGround`) rather than asking again — and why the pairing link restarting a stopped app lands on the assistant step.
- **Whether the tour has been walked is remembered separately** (`src/onboarding-storage.ts`), and cannot be inferred from the pairing being there — because the last step comes after it is made. A read of that flag that *fails* answers "walked": showing the tour to somebody who has a working Jarvis is the worse of the two mistakes, and a first-timer who misses it still lands on the settings screen, which is where this app used to open.

Skipping straight to sample mode is offered on every step, because the question somebody has just after installing this is whether it is worth setting anything up at all, and the honest answer to that is the sphere rather than another paragraph. It is a side trip and not an exit: the tour is not marked walked on the way out, so tapping beside Jarvis comes back to the tour rather than past it. To the first step left to walk, not the one it left from — the screen is unmounted while sample mode is up, and keeping a wizard's position across that is not worth a prop, since by the time the last step is on screen the device is paired and it *is* the first one left.

Nothing in the tour is shown to a **summoned** app. Somebody who has just made the assistant gesture asked for Jarvis, and the answer to that is him — sample mode, when there is nothing set up — rather than a guided tour. See `isTouring` in `app.tsx`.
