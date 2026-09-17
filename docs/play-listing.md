# The Play store listing

The text that goes in the Console, kept here so it is reviewed and versioned like everything else
rather than living only in a browser field. The pictures that go beside it are in
[`play-assets/`](./play-assets) — see [play-store.md §3](./play-store.md) for which file fills which
slot.

Every claim below is one the app actually delivers. Play rejects listings that describe features the
app does not have, and a listing that oversells is also the fastest route to one-star reviews from
people who expected a service and got a client.

---

## Short description

**80 characters maximum.** This is the line shown under the app name in search results, so it has to
carry the interaction and the requirement at once.

```
Hold the power button. Talk to your own ElevenLabs agent. On your watch too.
```

*(76 characters.)*

An alternative, if you would rather lead with what it is than with how it feels:

```
Your own ElevenLabs voice agent, as your phone and watch assistant.
```

*(67 characters.)*

---

## Full description

**4000 characters maximum.** The text below is about 2100, which leaves room to grow. Plain text with
blank lines between paragraphs is all Play renders reliably; it does not support Markdown, so the
headings are written as capitalised lines rather than with `#`.

**Put the requirement near the top and repeat it at the bottom.** Jarvis does nothing at all without
an ElevenLabs key, and someone who installs it not knowing that has had a bad experience through no
fault of their own.

```
Jarvis puts your own ElevenLabs conversational agent behind your phone's assistant button.

Hold the power button and he comes up over whatever you were doing: a sphere that listens, answers, and visibly thinks while he works. Set him as your default digital assistant and he takes the place of the one your phone shipped with.

BRING YOUR OWN AGENT

Jarvis is a client, not a service. You supply an ElevenLabs API key and the ID of an agent you have built, and Jarvis talks to it. Whatever you have taught that agent to do — look something up, check a calendar, turn the lights off — is what Jarvis can do. None of that is decided here, and nothing is added on top.

ON YOUR WRIST AS WELL

The Wear OS app is the same assistant on a watch, where the sphere is the whole screen. It installs alongside the phone app and runs on its own, so the watch can hold a conversation with the phone nowhere nearby.

A SPHERE THAT MEANS SOMETHING

The drawing is not decoration. It is at rest when he is waiting, swells and throws light when he speaks, and sweeps a plane through itself while he is working through something, so you can tell which of you is talking without reading anything. It also finds its own quality: it measures the frame rate it is getting and settles on the number of particles your device can actually hold, then remembers that for next time.

IT USES YOUR HEADPHONES

If a headset is connected, Jarvis listens and answers through it rather than through the phone, which is what you wanted when you put them on.

PRIVACY

No accounts. No advertising. No analytics, telemetry or crash reporting of any kind — there is no such library in the app, and no server of ours for it to report to. Your API key is kept in your device's encrypted keystore and is sent to nobody but ElevenLabs. We receive nothing, because there is nothing for us to receive it with.

WHAT YOU NEED

- An ElevenLabs account and an API key.
- An ElevenLabs agent to talk to, and its ID.

Both go into the app's settings once. Usage is billed to your own ElevenLabs account; this app adds no charge of its own and has no purchases in it.

OPEN SOURCE

Jarvis is open source, and the whole of it can be read, built and changed at:
https://github.com/ffMathy/hey-jarvis
```

---

## App access ("Oplysninger om login")

The Console asks whether any part of the app is restricted. **Answer yes.** Jarvis cannot hold a
conversation until an ElevenLabs API key and agent ID are entered, so a reviewer who is given
nothing sees a setup tour and no assistant, and "we could not access the app" is a rejection.

Add one instruction set with no username or password — there is no sign-in to perform — and put
everything in the instructions field:

```
Jarvis is a client for a conversational agent hosted by ElevenLabs (elevenlabs.io). It has
no accounts and no sign-in of its own, but it needs one API key and one agent ID before it
can hold a conversation. Both are entered once, in the app:

1. Open the app. It starts on a short setup tour, on a step explaining what an ElevenLabs
   agent is. Press "Next".
2. Paste this API key into "API key":

   <paste a review-only ElevenLabs API key here>

3. Paste this agent ID into "Agent ID":

   <paste the agent ID here>

4. Press "Continue". The last step of the tour offers to make Jarvis the device's digital
   assistant; that is optional, and pressing "Done" skips it.

5. The assistant screen opens and connects on its own, and you can speak to it. Allow the
   microphone permission when asked.

To reach the settings again afterwards, press and hold anywhere on the assistant screen. Every step
of the tour also has a "Skip all this and just look at him" link, which shows the app's hologram
with no account needed.

The app can also be summoned as the device's digital assistant: set it under
Settings > Apps > Default apps > Digital assistant app, then hold the power button.
```

**Use a key you can revoke.** Make an ElevenLabs API key for review alone, and delete it once the app
is live — a key in a Console field is a key in a third party's hands, and usage against it is billed
to you. The same goes for the agent: a simple one that answers questions is easier to review than one
wired into a house.
