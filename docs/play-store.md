# Getting Jarvis onto Play internal testing

What this buys you, and why it is worth the hour: **internal testing is the only way to get the app
onto a paired Wear OS watch.** A watch cannot side-load — there is no file manager, no browser and
no "install from unknown sources" that a phone can push through — so the watch app reaches the watch
by Play noticing that the phone it is paired to has the app and that the app ships a watch variant.
That is what `JARVIS_IS_ON_PLAY` in [`mobile/src/watch-card.tsx`](../mobile/src/watch-card.tsx) is
waiting on; until it is true, the "install on your watch" button stays hidden because it would only
ever fail.

Internal testing is not a public release. It goes to a list of up to a hundred email addresses you
name, it is live within minutes instead of after a week of review, and it never appears in search.

Everything below is done once — **after** §0, which is the part that is currently blocking.
Afterwards it is automatic: **every push to a pull request that
touches the app publishes a build to internal testing**, so what is on your phone and your watch is
the branch you are working on. There is a manual trigger too, for when you want a different track.

---

## 0. You need a developer account that is open

The `ffMathy` account was **closed on 13 February 2024 for inactivity**, after a warning on
12 December 2023 and a deadline of 9 February 2024. Nothing below can be done until there is an open
account, and the pipeline in this repository cannot publish anything without one.

[Google's documented remedy](https://support.google.com/googleplay/android-developer/answer/11605267)
is to create a new account. There is a "request help" path from the Play Console Help page and it is
worth one attempt, but closure for inactivity is not framed as an appealable enforcement action the
way a policy strike is. Assume a new account:

- **The £/$25 registration fee is not refundable and does not transfer.** A new account is a new fee.
- **Identity verification is required** and takes days rather than minutes, so start it before you
  need it.
- The package name `com.ffmathy.heyjarvis` is not taken by the closed account in any way that
  matters — nothing was ever published under it.

**Internal testing is not blocked by the new-account rules**, which is the part that matters here.
A personal account created today has to run a closed test with twelve testers for fourteen days
before it can apply for *production* access —
[that requirement is production-only](https://support.google.com/googleplay/android-developer/answer/14151465).
Internal testing works immediately, and internal testing is all this repository wants: it is what
puts the app on a paired watch.

### Signing up again, in the browser

1. **Probably sign in as a different Google account — but check first, because it is free to.**
   Google's own page on
   [closure of inactive accounts](https://support.google.com/googleplay/android-developer/answer/11605267)
   says to create a new account and says nothing at all about which Google account to create it on.
   Third-party guides say a new email is required; they are not Google. What *is* visible is that
   the old account still opens a Play Console — the one showing "Account closed" — so there is
   already a developer account attached to it, and the sign-up flow has nowhere to put a second one.

   **The US$25 is charged at the end of sign-up, not the start**, so walking the flow while signed
   in as the old account costs nothing and settles it: either it offers to register, or it puts you
   back in the closed console. Do that before deciding. If it refuses, use a Google account that has
   never held a developer account — a fresh one made for the purpose is tidier than a personal one
   anyway, and the account that owns the app does not have to be the account on your phone.
2. Go to **<https://play.google.com/console/signup>**.
3. Choose **Personal**, not Organization. An organization account now needs a nine-digit
   [D-U-N-S number](https://support.google.com/googleplay/android-developer/answer/10841920) from
   Dun & Bradstreet and possibly company paperwork on top, which is a great deal of friction for
   something that is going to have one tester.
4. Accept the Developer Distribution Agreement and pay the **US$25** one-time fee. The card has to
   be in your own legal name — it is part of how the identity check works, not just a payment.
5. Complete identity verification: expect a **government ID and a card under the same legal name**,
   through a Google payments profile. This is the part that takes days.
6. **Verify a device.** Since 2024 a new account also has to prove access to an Android device
   through the Play Console app, so install that on the Pixel and sign in as the new developer
   account when asked.
7. The moment the console opens, go to **Account details** and verify the contact email and phone.
   See below for why that is not optional.

> **The developer account does not have to be the account on your phone.** Whichever Google account
> you register with owns the app and invites the service account; the account on the phone paired to
> the watch just needs to be on the internal testing tester list (§3). They can be the same account
> or not, and there is no advantage to their being the same.

### Then do not let it happen again

[The closure criteria](https://support.google.com/googleplay/android-developer/answer/11605267) are
worth reading once, because a hobby project walks into both of them:

- an account created more than a year ago that has **never submitted an app for review**; or
- every published app under a thousand lifetime installs, **and** no verified phone number and
  contact email, **and** no Play Console sign-in for 180 days.

So: verify the email and phone on the Account details page as soon as the account exists — that is
one of the two documented ways out of the second case — and get one build submitted rather than
leaving the account empty. The workflow here helps with the rest by itself: it uploads on every push
to a pull request, so the account does not sit untouched for six months.

---

## 1. The upload key

Android will not install an unsigned app, so React Native's template signs release builds with a
debug keystore — the same well-known key on every machine, committed into the template. Play will
not accept it, and rightly: anyone holding that key can sign an "update" your phone will install.

So you need a key of your own. Make it once and never lose it: **Play ties your app's identity to
the first key it sees, and a key you cannot reproduce is an app you cannot update.**

```bash
keytool -genkeypair -v \
  -keystore jarvis-upload.jks \
  -alias jarvis-upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storetype PKCS12
```

It asks for a password (use one password for both the store and the key — the tooling allows two and
nothing is gained by it) and for a name and organisation, which only ever appear in the certificate
and are not shown to anybody.

Then turn it into something that fits in a secret:

```bash
base64 -w 0 jarvis-upload.jks > jarvis-upload.jks.base64
```

`-w 0` matters. Without it `base64` wraps at 76 characters and the newlines survive into the secret,
and what comes out the other end is not a keystore. On macOS the flag is `-b 0`.

> **Play App Signing.** When you create the app, Google offers to hold the *app signing* key itself
> and treat yours as an *upload* key. Say yes. It means a lost or compromised upload key is a
> support ticket rather than an app you can never update again, and it is why this one is called
> `jarvis-upload` rather than `jarvis-release`.

## 2. The Play publisher account

This is the identity the workflow uploads as: a Google Cloud service account that the Play Console
has been told about. It is made entirely in the Cloud console and then *invited* into Play — there
is no linking step and no "API access" page.

> **If you are following an older guide, it will tell you to go to Play Console → Setup → API
> access and link a Google Cloud project.** That page has been removed and the link is no longer
> required — a service account reaches the Play API without the developer account and the Cloud
> project knowing about each other. Everything to do with API access now happens under **Users and
> permissions**, which is in the left-hand menu at the account level.

1. In the [Google Cloud console](https://console.cloud.google.com/), pick a project or make one. It
   does not matter which — it exists only to own the service account, and nothing connects it to
   the Play account.
2. Enable the **Google Play Android Developer API** on that project (APIs & Services → Library).
   The service account's calls are billed and authorised against the project it belongs to, so the
   API has to be on there even though nothing else links the two.
3. **IAM & Admin → Service Accounts → Create service account.** Name it something like
   `jarvis-play-publisher`. Give it **no project role at all** — its permissions come from Play, and
   a publisher that can do nothing in Cloud is one less thing to worry about.
4. On the new account: **Keys → Add key → Create new key → JSON**. That downloads a file once and
   only once. It is the whole of what goes into 1Password in §4.
5. Back in **Play Console → Users and permissions → Invite new user**, paste the service account's
   email — it ends `@<project>.iam.gserviceaccount.com` — and give it access to the Jarvis app only,
   with **Release to testing tracks** and **View app information**. It does not need production
   release rights, and a publisher that cannot publish to production cannot be made to by a bad
   workflow.

The service account can take a few minutes to become visible to the Play API after inviting it. A
first upload that fails with "application not found" is usually this.

## 3. The app itself

In the Play Console, create the app with the package name **`com.ffmathy.heyjarvis`** — it has to
match [`mobile/app.config.ts`](../mobile/app.config.ts) exactly and cannot be changed afterwards.
Then, before any upload is accepted, Play requires the app's declarations to be filled in: content
rating, data safety, target audience, privacy policy, ads. That is the slow part, and there is no
way round it.

**The store listing's pictures are generated, not drawn.** The form has four slots it will not save
without, and every one of them is in `docs/play-assets/`, rendered by

```bash
bun hologram/.scripts/render-play-assets.ts
```

| Slot in the Console | What to upload |
| --- | --- |
| **Appikon** (512×512) | `icon-512.png` |
| **Fremhævet grafik** / Feature graphic (1024×500) | `feature-graphic-1024x500.png` |
| **Screenshots fra telefonversion** (2-8, 9:16) | the four `phone-*.png`, in name order |
| **Screenshots for Wear OS** (up to 8, 1:1) | the four `watch-*.png`, in name order |

Four phone screenshots rather than the two Play demands, because four with a shortest side of at
least 1080 px is what makes the listing eligible for promotion — the Console says so in a note under
that slot. All ten are drawn by the app's own `drawHologram`, so they are the product rather than a
picture of it, and all ten are written with no alpha channel at all, because the Wear OS slot
rejects anything carrying transparency. The script measures each finished file against Play's size
limit and fails rather than hand you one the Console would refuse.

**The first bundles have to be uploaded by hand.** The Play API will not create an app's first
release, so upload `dist/mobile-aab/jarvis.aab` *and* `dist/watch-aab/jarvis.aab` through the
Console once. Every upload after that can be the workflow.

**And the watch has to be switched on.** Play does not accept a watch artifact until the app opts in
to the form factor: **Test and release → Advanced settings → Form factors → Add form factor →
Wear OS**, then agree to the Wear OS review policies. This is also the step that puts the watch app
through its own review, which is separate from the phone's. It is what makes the `wear:` tracks
appear, so the quickest way to check whether it has been done is to look at the track list — see
below.

**The watch is published separately from the phone, and has to be.** Play gave Wear OS tracks of its
own in March 2023, and a mobile track now refuses a watch artifact outright:

```
The APK or bundle with version code <odd number> requires the Wear OS system feature
android.hardware.type.watch. To publish this release on the current track, remove this artifact.
```

(The odd version code is the watch's — see §7. Play sometimes says `Internal error encountered`
instead, which is the same refusal with none of the detail.)

So the workflow publishes twice: the phone bundle to `internal`, and the watch bundle to
`wear:internal`.

**Do not take that track name from Google's documentation, which is wrong.** The
[tracks page](https://developers.google.com/android-publisher/tracks) says a form factor's track is
`"[prefix]:defaultTrackName"` and offers `"wear:production"`, `"wear:beta"` and `"wear:qa"` as the
Wear OS set — and `wear:qa` does not exist. The API is the authority, and it answers the question
itself when given a name it does not know:

```
Track "wear:qa" could not be found. Available tracks are:
production,beta,alpha,internal,wear:beta,wear:internal,wear:production
```

That list is also how you can tell the Wear OS form factor is switched on: the `wear:` tracks are not
there otherwise.

That split is worth more than correctness. It used to be one release holding both bundles, which
meant one fate: the watch being refused failed the commit, and **the phone did not publish either**.
Now a watch Play will not take cannot stop the phone app shipping. The phone step runs first for the
same reason.

Finally, on **Testing → Internal testing**, create a tester list and add the addresses that should
get it — including the Google account on the phone that is paired to the watch.

## 4. The secrets

**All of them live in 1Password and nowhere else.** CI already holds one
`OP_SERVICE_ACCOUNT_TOKEN`, and every `HEY_JARVIS_*` value in this repository is resolved from the
`Jarvis` vault at run time by `.scripts/run-with-env.sh` — so **there is nothing to add to GitHub**.
Put these in the vault and the workflow can already reach them.

**Item: `Jarvis Android upload key`** (a Secure Note is fine)

| Field | What goes in it |
| --- | --- |
| `keystore base64` | the contents of `jarvis-upload.jks.base64`, one line |
| `keystore password` | the password you gave `keytool` |
| `key alias` | `jarvis-upload` |
| `key password` | the same password, unless you deliberately set two |

Attach `jarvis-upload.jks` itself to the item as well. The base64 is what the build reads; the file
is what you will want the day you need to sign something by hand.

**Item: `Jarvis Google Play publisher`**

| Field | What goes in it |
| --- | --- |
| `service account json` | the whole JSON file from §2, pasted as text |

The field names are not free-form — they are the right-hand side of
[`mobile/op.env`](../mobile/op.env) and [`mobile/op.publish.env`](../mobile/op.publish.env), which is
how `run-with-env.sh` finds them. Rename a field and you rename it there too.

Two files rather than one, and the split is deliberate: nothing you can run on a laptop uploads to
Play, so the publisher account is kept out of the file the bundle build reads. Otherwise every local
build would stop to fetch a secret it was not going to use.

> **The service account token has to be able to see the vault.** These are new items, so if the
> 1Password service account is scoped to particular vaults rather than to `Jarvis` as a whole,
> nothing will read them. A build that stops with `❌ Missing:` and a list of names, on a machine
> where `op` is signed in, is usually this.

## 5. Testing it, in the order that fails fastest

Each step proves one thing. Stop at the first one that does not work — the later steps cannot
succeed if an earlier one did not.

### a. Does the key sign anything? (2 minutes, no Play, no 1Password, no CI)

Set the four values in your shell and build:

```bash
export HEY_JARVIS_ANDROID_KEYSTORE_BASE64="$(base64 -w 0 jarvis-upload.jks)"
export HEY_JARVIS_ANDROID_KEYSTORE_PASSWORD='the password you chose'
export HEY_JARVIS_ANDROID_KEY_ALIAS='jarvis-upload'
export HEY_JARVIS_ANDROID_KEY_PASSWORD='the password you chose'
bunx turbo build:aab --filter=mobile
```

`run-with-env.sh` finds all four already set and never calls 1Password, so this works before any of
it is in a vault. Then check what actually signed it:

```bash
keytool -printcert -jarfile dist/mobile-aab/jarvis.aab
```

Look at the owner. **`CN=Android Debug` means the upload key did not engage** and the bundle is
worthless to Play — the Gradle properties did not reach it. Your own name means it worked; compare
the SHA-256 fingerprint against the key itself if you want to be sure:

```bash
keytool -list -v -keystore jarvis-upload.jks -alias jarvis-upload | grep SHA256
```

### b. Does 1Password have it right? (1 minute)

Open a new shell so none of the exports above survive, sign in to `op`, and run the same build. If
it gets as far as Gradle, the item and field names match `mobile/op.env`. If it stops with
`❌ Missing:` and a list, a field name is wrong — or the service account cannot see the vault.

This is the step that proves CI will work, because CI takes exactly this path: the same script, the
same file, the same vault, with a service account token in place of your signed-in session.

### c. Does Play accept it? (the slow one)

Upload `dist/mobile-aab/jarvis.aab` through the Console by hand, as §3 says you must for the first
release. This is where the app's declarations get demanded. Nothing automatic can work until one
bundle has gone up this way.

### d. Does the workflow work?

Push anything to a pull request that touches `mobile/`, or run **Play internal testing** from the
Actions tab. Watch the **Publish to Play** step. The build before it takes about fifteen minutes, so
if the run fails in seconds it is the secrets, not the build.

### e. Did it reach the watch?

On the phone, open Play → Manage apps & device → the watch's tab. The app appears there once the
phone's Google account is on the tester list and the app is installed on the phone.

## 6. Building it

Locally, once 1Password has the items above and `op` is signed in:

```bash
bunx turbo build:aab --filter=mobile
```

That writes `dist/mobile-aab/jarvis.aab`, and `--filter=watch` writes `dist/watch-aab/jarvis.aab`.
CI builds both. They build **bundles**, not APKs, because Play has not accepted APKs for new apps
since 2021 — an `.aab` carries every ABI and density and Play builds the APK each device downloads.
It is also why these take longer than `build:apk`, which only ever builds `arm64-v8a`.

The two go to **different tracks** — the phone to `internal`, the watch to `wear:internal` — and Play works
out which device gets which. What makes them one app rather than two is that they share a package
name (`com.ffmathy.heyjarvis`) and an upload key; what keeps them apart is the
`uses-feature android.hardware.type.watch` the watch declares, and a version code that must be
unique across every form factor, so the phone takes twice the run number and the watch one more.

In CI, nothing needs running. Pushing to a pull request that touches `mobile/`, `hologram/` or the
dependency lock builds a bundle and sends it to the internal track, numbered by the workflow's run
number. The **Play internal testing** workflow can also be started by hand from the Actions tab,
which is the only way to pick a different track or to leave the build as a draft.

The workflow runs straight on the runner rather than in the dev container — the runner image carries
the Android SDK with its licences accepted, which the container does not — so it installs the `op`
CLI itself before anything asks 1Password for a secret.

## 7. How the signing actually works

Worth knowing, because it is the part that looks like magic:

- `withReleaseSigning` in [`mobile/app.config.ts`](../mobile/app.config.ts) is an Expo config plugin. It appends a
  second `android { }` block to the generated `android/app/build.gradle` which adds an `upload`
  signing config and points release builds at it — but only when the Gradle property
  `JARVIS_UPLOAD_STORE_FILE` is set. It is a plugin rather than an edit because `android/` is
  generated by `expo prebuild` and anything written there by hand is lost on the next run. It lives
  in `app.config.ts` rather than a file of its own because Expo transpiles the config to a `.js`
  beside it and then `require`s that with plain Node, which cannot resolve a relative import of a
  TypeScript file.
- [`mobile/.scripts/build-aab.sh`](../mobile/.scripts/build-aab.sh) decodes the keystore to a
  `chmod 600` file in a temporary directory that it deletes on the way out, checks it opens with
  `keytool` before starting a forty-minute build, and hands Gradle the four values as
  `ORG_GRADLE_PROJECT_…` environment variables. Not as `-P` arguments: those are visible in `ps` to
  everything else on the machine, which on a shared runner is a password in public.
- Because the plugin only acts when the property is there, `bunx expo run:android` and
  `build:apk` are untouched and still need no keystore at all.

## 8. Things that will go wrong

| What you see | What it is |
| --- | --- |
| `Package not found: com.ffmathy.heyjarvis` | the first release was never uploaded by hand, or the service account was invited but has not propagated yet |
| `Google Play Android Developer API has not been used in project …` | step 2 of §2 — the API is not enabled on the service account's Cloud project |
| `Could not close incremental caches` / `Daemon compilation failed` during the build | the phone and watch Gradle builds ran at the same time and fought over one shared copy of `@react-native/gradle-plugin`. The workflow passes `--concurrency=1` to stop that; a local `turbo build:aab` across both filters needs it too |
| Nothing in the Play Console works at all | the developer account is closed — see §0 |
| `1Password CLI is not authenticated` in CI | `OP_SERVICE_ACCOUNT_TOKEN` is not reaching the job, or the `op` install step was removed |
| `Version code N has already been used` | `JARVIS_ANDROID_VERSION_CODE` repeated. In CI it is `github.run_number`, which only rises; locally it is 1, so a locally built bundle can be uploaded once and never again |
| `You uploaded an APK or Android App Bundle signed with a key that is also used to sign APKs delivered to users` | the debug key got in, which means the Gradle property was missing and the build silently fell back |
| `keystore did not open` from the build script | the base64 was wrapped. Re-run it with `-w 0` |
| The bundle's certificate says `CN=Android Debug` | the four Gradle properties never arrived, so the build fell back to the debug key. Check the four variables are set in the shell that runs it |
| `requires the Wear OS system feature android.hardware.type.watch. To publish this release on the current track, remove this artifact` | a watch bundle was sent to a *mobile* track. Play has not allowed that since March 2023 — the watch goes to `wear:internal`. See §3 |
| `Internal error encountered` after a bundle says it uploaded | the same refusal as the row above, with none of the detail. Play gives one or the other |
| `Track "…" could not be found. Available tracks are: …` on **Publish the watch to Play** | read the list in the error rather than Google's documentation, which names a `wear:qa` track that does not exist. If no `wear:` track is listed at all, the Wear OS form factor has not been added — see §3. The phone will have published regardless, which is why the two are separate steps |
| The watch app does not appear on the watch | the Wear OS form factor was never added under Test and release → Advanced settings, or the phone's Google account is not on the tester list |
| `Version code N has already been used` on the *watch* bundle | both apps derive their version code from the same run number — the phone takes twice it, the watch one more — so this means one was uploaded outside the workflow |
