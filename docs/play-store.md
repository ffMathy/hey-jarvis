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

Everything below is done once. Afterwards it is automatic: **every push to a pull request that
touches the app publishes a build to internal testing**, so what is on your phone and your watch is
the branch you are working on. There is a manual trigger too, for when you want a different track.

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

This is the identity the workflow uploads as. It is a Google Cloud service account that the Play
Console has been told about — two consoles, and both halves are needed.

1. **Play Console → Setup → API access.** Link a Google Cloud project if you have not (any project
   will do; it exists only to own the service account).
2. In that Cloud project: **IAM & Admin → Service Accounts → Create**. Name it something like
   `jarvis-play-publisher`. It needs no project-level role at all — its permissions come from Play,
   not from Cloud.
3. On the new account: **Keys → Add key → Create new key → JSON**. That downloads a file once and
   only once.
4. Back in **Play Console → Users and permissions → Invite new user**, invite the service account's
   email (it ends `@<project>.iam.gserviceaccount.com`). Give it access to the Jarvis app only, with
   **Release to testing tracks** and **View app information**. It does not need production release
   rights, and a publisher that cannot publish to production cannot be made to by a bad workflow.

The service account can take a few minutes to become visible to the Play API after inviting it. A
first upload that fails with "application not found" is usually this.

## 3. The app itself

In the Play Console, create the app with the package name **`com.ffmathy.heyjarvis`** — it has to
match [`mobile/app.config.ts`](../mobile/app.config.ts) exactly and cannot be changed afterwards.
Then, before any upload is accepted, Play requires the app's declarations to be filled in: content
rating, data safety, target audience, privacy policy, ads. That is the slow part, and there is no
way round it.

**The first bundle has to be uploaded by hand.** The Play API will not create an app's first
release, so upload `dist/mobile-aab/jarvis.aab` through the Console once. Every upload after that
can be the workflow.

Finally, on **Testing → Internal testing**, create a tester list and add the addresses that should
get it — including the Google account on the phone that is paired to the watch.

## 4. The secrets

Five of them, and the same five in both places. 1Password is where they live; GitHub Actions gets a
copy because a workflow cannot reach 1Password.

### In 1Password

The vault is `Jarvis`, matching the other `op.env` files in this repository. Create two items:

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
| `service account json` | the whole JSON file, pasted as text |

The first item's field names are not free-form — they are the right-hand side of
[`mobile/op.env`](../mobile/op.env), which is how `run-with-env.sh` finds them. Rename a field and
you rename it there too.

The publisher JSON is deliberately **not** in `op.env`. Nothing you can run locally uploads to Play,
so no local script ever wants it — and listing it there would mean every local bundle build stopped
to ask 1Password for a secret it was not going to use. It is in 1Password so there is a copy of it
somewhere other than a GitHub secret box; the only thing that reads it is the workflow.

### In GitHub

**Settings → Environments → New environment → `google-play`**, then add these five secrets to it.
An environment rather than plain repository secrets, because an environment can carry a required
reviewer — worth turning on, since these are the credentials that can publish under your name.

| Secret | Source |
| --- | --- |
| `HEY_JARVIS_ANDROID_KEYSTORE_BASE64` | `jarvis-upload.jks.base64` |
| `HEY_JARVIS_ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `HEY_JARVIS_ANDROID_KEY_ALIAS` | `jarvis-upload` |
| `HEY_JARVIS_ANDROID_KEY_PASSWORD` | the key password |
| `HEY_JARVIS_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | the whole service account JSON |

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
`❌ Missing:` and a list, a field name is wrong.

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

That writes `dist/mobile-aab/jarvis.aab`. It builds a **bundle**, not an APK, because Play has not
accepted APKs for new apps since 2021 — an `.aab` carries every ABI and density and Play builds the
APK each phone downloads. It is also why this one takes longer than `build:apk`, which only ever
builds `arm64-v8a`.

In CI, nothing needs running. Pushing to a pull request that touches `mobile/`, `hologram/` or the
dependency lock builds a bundle and sends it to the internal track, numbered by the workflow's run
number. The **Play internal testing** workflow can also be started by hand from the Actions tab,
which is the only way to pick a different track or to leave the build as a draft.

> **Do not add a required reviewer to the `google-play` environment** unless you want to approve
> every push. An environment that asks for approval holds the job until somebody answers, which
> defeats the automatic trigger. The environment is still worth having — it is what keeps these
> secrets out of reach of every other workflow in the repository.

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
| `Version code N has already been used` | `JARVIS_ANDROID_VERSION_CODE` repeated. In CI it is `github.run_number`, which only rises; locally it is 1, so a locally built bundle can be uploaded once and never again |
| `You uploaded an APK or Android App Bundle signed with a key that is also used to sign APKs delivered to users` | the debug key got in, which means the Gradle property was missing and the build silently fell back |
| `keystore did not open` from the build script | the base64 was wrapped. Re-run it with `-w 0` |
| The bundle's certificate says `CN=Android Debug` | the four Gradle properties never arrived, so the build fell back to the debug key. Check the four variables are set in the shell that runs it |
| The watch app does not appear on the watch | the watch build has to be in the *same* Play app as the phone build, not a separate listing. It is not wired up yet — see [`wear/`](../wear) |
