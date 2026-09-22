/**
 * A sound bundled with the app.
 *
 * Metro turns an imported `.mp3` into the id of an asset it registered, and `expo-audio` takes that
 * id as a source and resolves it itself — to a file in the APK on a device, and to a URL in the
 * export in a browser. Nothing else is ever done with it, so a number is the whole of its type.
 */
declare module '*.mp3' {
  const asset: number;
  export default asset;
}
