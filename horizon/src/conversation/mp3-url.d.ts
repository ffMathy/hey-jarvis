/**
 * A sound as Vite hands it over when asked for its URL: `import recording from '….mp3?url'`.
 *
 * Only the `?url` form is declared, on purpose. `hologram` declares a bare `*.mp3` as a number —
 * Metro's asset id, which is what the phone and the watch get — and the headset must never import
 * one that way: in Vite it would be a URL typed as a number. Asking for the URL by name keeps the
 * two apart, so neither declaration can be mistaken for the other.
 */
declare module '*.mp3?url' {
  const url: string;
  export default url;
}
