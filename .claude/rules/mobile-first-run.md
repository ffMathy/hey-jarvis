---
paths:
  - "mobile/**"
---

# First run

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

A new install opens on a three-step tour (`src/onboarding-screen.tsx`), not on the two fields it used to. The fields were an unanswerable question: nothing on that screen said what an ElevenLabs agent is, that Jarvis is one, or that the agent — not this app — is where the connections to everything else are made. Somebody who already had a key and an agent ID was the only person the old first screen worked for.

| Step | What it does |
| --- | --- |
| `agent` | What an agent is, that its tools are what make it an assistant, and links to sign up, build one, and read about webhooks and MCP servers |
| `credentials` | The API key and the agent ID, with a link to where each is found |
| `assistant` | The recommendation to hand Jarvis the assistant role, and the button that opens the picker — plus the watch card, when there is a watch, which is where the credentials are handed across to it |

Four things about it are decisions rather than details:

- **The steps, their order and every link live in `src/onboarding.ts`, which imports nothing.** `bun test` cannot parse React Native's Flow types, so anything a test needs an opinion about has to be outside the components — the same reason the contract specs read Kotlin as text. `onboarding.spec.ts` covers the order, the two-step shape in a browser, resuming, the count, and that every link is an `https://elevenlabs.io` address.
- **A browser gets two steps.** There is no assistant role in a browser and no picker to send anyone to, so the last step would be a recommendation nobody could act on. `onboardingSteps` leaves it out, and the count says "Step 2 of 2" rather than promising a third.
- **The credentials are saved the moment they parse, not at the end.** The next step sends the user out to Android's Settings, and the app is not guaranteed to come back alive; a pasted API key held in component state across that is a key lost. Which is why a tour that is resumed with credentials already stored picks up *after* them rather than asking again.
- **Whether the tour has been walked is remembered separately** (`src/onboarding-storage.ts`), and cannot be inferred from the credentials being there — because the last step comes after they are saved. A read of that flag that *fails* answers "walked": showing the tour to somebody who has a working Jarvis is the worse of the two mistakes, and a first-timer who misses it still lands on the settings screen, which is where this app used to open.

Skipping straight to sample mode is offered on every step, because the question somebody has just after installing this is whether it is worth signing up for anything at all, and the honest answer to that is the sphere rather than another paragraph. It is a side trip and not an exit: the tour is not marked walked on the way out, so tapping beside Jarvis comes back to the tour rather than past it. To the first step left to walk, not the one it left from — the screen is unmounted while sample mode is up, and keeping a wizard's position across that is not worth a prop, since by the time the last step is on screen the credentials are saved and it *is* the first one left.

Nothing in the tour is shown to a **summoned** app. Somebody who has just made the assistant gesture asked for Jarvis, and the answer to that is him — sample mode, when there is nothing set up — rather than a guided tour. See `app.tsx`.
