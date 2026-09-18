import type { ConfigPlugin, withAppBuildGradle } from '@expo/config-plugins';

/**
 * Builds the signing plugin, given the app's own `withAppBuildGradle`.
 *
 * Handed in rather than imported: see the note in `expo-release-signing.js`, which is where the
 * reasoning lives. Each app has its own copy of `@expo/config-plugins` and this file has none.
 */
export declare function createReleaseSigning(mod: typeof withAppBuildGradle): ConfigPlugin;

/**
 * The build number Play orders uploads by. `offset` separates the phone from the watch, which share
 * a Play listing and so may not share a version code: 0 for the phone, 1 for the watch.
 */
export declare function androidVersionCode(offset: number): number;

/**
 * The version a human reads, taken from the monorepo's own released version — the one Release
 * Please bumps on `main`. Shared by both apps, because they are one Play listing.
 */
export declare function androidVersionName(): string;
