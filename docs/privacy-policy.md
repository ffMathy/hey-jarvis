# Privacy Policy for Jarvis

**Effective date: 17 September 2026**
**Last updated: 17 September 2026**

This Privacy Policy describes how the Jarvis application ("Jarvis", "the App") handles information.
It applies to the Android application, the Wear OS application and the web version, all published
under the package name `com.ffmathy.heyjarvis` (together, "the App").

The App is provided by an individual developer ("we", "us", "the Developer"). Contact details are in
[§10](#10-contact).

---

## 1. Summary

**We do not collect, receive, store, process, sell or share any personal data.**

The Developer operates no servers, no accounts, no analytics and no advertising. No information about
you or your device is transmitted to the Developer at any time, for any purpose. There is no
mechanism in the App by which that could occur.

The sections below explain what the App does hold on your own device, and what it sends to the
third-party service you choose to connect it to. They are provided for completeness and transparency;
none of it involves the Developer receiving anything.

---

## 2. Information we collect

**None.**

We do not collect any of the following, whether directly, through third parties, or by any automated
means:

- personal identifiers, including name, email address, postal address, telephone number, or any
  government-issued identifier;
- account credentials, because the App has no accounts and no sign-in;
- device identifiers, advertising identifiers, or IP addresses;
- location data of any kind, whether precise or approximate;
- contacts, calendar entries, photographs, files, or messages;
- usage analytics, telemetry, crash reports, diagnostics, or performance data;
- cookies or similar tracking technologies used for tracking purposes.

The App contains no analytics software development kit, no advertising software development kit, no
crash-reporting service and no tracking library of any description.

---

## 3. Information stored on your device

The App stores a small amount of information locally so that it works between launches. **This
information never leaves your device except as described in [§4](#4-third-party-services), and is
never transmitted to us.**

| What | Why | Where it is kept |
| --- | --- | --- |
| Your ElevenLabs API key | To authenticate you to the voice service you have chosen to use | Android and Wear OS: the operating system's encrypted keystore (`expo-secure-store`). Web: your browser's `localStorage` |
| Your ElevenLabs agent identifier | To know which assistant to connect you to | As above |
| A remembered particle count | A display setting, so the animation opens at a quality your device has already sustained | As above |

You may erase all of it at any time by uninstalling the App, or, in the web version, by clearing site
data for the page in your browser. The Developer has no copy of it and no means of obtaining one.

---

## 4. Third-party services

The App is a client for **ElevenLabs**, a third-party conversational voice service. It is not usable
until you supply your own ElevenLabs API key, and it connects to no other remote service.

When, and only when, you hold a conversation:

- audio captured from your microphone is transmitted to ElevenLabs in order to be understood;
- text you type, where you use the text input instead of speaking, is transmitted to ElevenLabs;
- the assistant's replies are received from ElevenLabs.

**That transmission is to ElevenLabs, not to us.** We neither receive, intercept, log nor retain any
of it. What ElevenLabs does with it is governed by its own agreement with you and its own privacy
policy, at <https://elevenlabs.io/privacy>. We are not a party to that relationship and we encourage
you to read it.

If you have configured your ElevenLabs assistant to reach further services of your own — a home
automation system, a calendar, or any other tool — those exchanges occur between ElevenLabs and those
services under your configuration and your credentials. The App is not a participant in them and the
Developer has no visibility of them.

---

## 5. Permissions

The App requests the following permissions, and uses each only for the stated purpose:

- **Microphone (`RECORD_AUDIO`)** — to hear you during a conversation. Audio is streamed to
  ElevenLabs while a conversation is open and is not recorded to storage, retained by the App, or
  sent anywhere else. The App does not listen when a conversation is not open. If you decline this
  permission, the web version offers a text field instead, and the App remains usable.
- **Audio settings (`MODIFY_AUDIO_SETTINGS`)** — to route the conversation to a connected headset
  rather than the device speaker.
- **Network access (`INTERNET`, `ACCESS_NETWORK_STATE`)** — to reach ElevenLabs.
- **Wake lock (`WAKE_LOCK`)** — to keep the screen available during a conversation.

---

## 6. Children's privacy

The App is not directed to children, and we do not knowingly collect personal data from anyone,
including children under the age of 13 (or the equivalent minimum age in your jurisdiction). As
described in [§2](#2-information-we-collect), the App collects no personal data from any user of any
age. If you believe a child has provided personal data to us, please contact us, although we do not
expect that to be possible.

---

## 7. Your rights

Rights of access, rectification, erasure, restriction, portability and objection under the General
Data Protection Regulation (GDPR), and rights of access, deletion, correction and opt-out under the
California Consumer Privacy Act (CCPA) as amended by the CPRA, apply to personal data held by a
controller.

**We hold no personal data about you, so there is nothing for us to disclose, correct, delete,
restrict, port or stop processing.** We have never sold or shared personal data, and we do not
process personal data for behavioural advertising. Data held on your own device is under your control
and may be removed as described in [§3](#3-information-stored-on-your-device).

To exercise rights in respect of data held by ElevenLabs, contact ElevenLabs directly.

---

## 8. Data retention and security

We retain nothing, because we receive nothing. Information stored on your device is retained until
you remove it, and is protected by your device's own security — on Android and Wear OS by the
operating system's encrypted keystore. In the web version it is held in browser storage, which is
less strongly protected than a keystore; treat a shared or public computer accordingly.

---

## 9. Changes to this policy

We may update this Privacy Policy, for example if the App gains a feature that changes how
information is handled. Any revision will be published at this address with an updated effective
date. Material changes will be reflected in the App's Google Play listing. Continued use of the App
after a revision constitutes acceptance of it.

---

## 10. Contact

Questions about this Privacy Policy may be sent to:

**`<add your contact email address here before publishing>`**

---

## 11. Google Play Data Safety

The declarations made in the Google Play Data Safety section for this App are consistent with this
policy: no data is collected, and no data is shared with the Developer. Audio and text transmitted to
ElevenLabs during a conversation are handled by ElevenLabs as a service you have chosen and
authenticated to with your own key.
