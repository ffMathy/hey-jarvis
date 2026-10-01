import recording from 'hologram/assets/greeting.mp3?url';

/**
 * Where the greeting's recording is, for `createGreetingPlayer`.
 *
 * The firmware's own file, from hologram's assets rather than a copy, so the phone, the watch and
 * the headset all greet with the same take. Vite emits it beside the build and hands over its
 * relative URL, which is resolved against the page so it works under any path the site is served
 * from. Apart from the player so that `bun test` — which has no idea what `?url` means — never has
 * to load it.
 */
export function greetingRecordingUrl(base: string = document.baseURI): URL {
  return new URL(recording, base);
}
