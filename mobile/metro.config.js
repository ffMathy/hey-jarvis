// Metro has to be told about the monorepo twice: once so it watches sibling
// packages for changes, and once so it looks for modules in the workspace root
// as well as here. Bun installs this app's own dependencies into
// `mobile/node_modules` and the shared ones into the root, so a bundler that
// knows about only one of the two resolves half the tree.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// `disableHierarchicalLookup` is the usual monorepo advice and is wrong here.
// Bun's isolated linker gives every package its own `node_modules` alongside it
// under `node_modules/.bun/<name>@<version>+<hash>/`, and walking up from the
// importing file is how a package's own dependencies are found at all —
// switching it off leaves `expo` unable to resolve `expo-modules-core`.
//
// The other half of that advice — a resolver forcing `react`, `react-native`,
// `livekit-client` and the two LiveKit packages to one copy each — is
// deliberately absent, and it is worth saying why, because the failure it would
// guard against is a quiet one: `@elevenlabs/react-native` installs the WebRTC
// globals through `@livekit/react-native` and `@elevenlabs/client` reads them
// back, so two copies would connect and then play silence, with no error
// anywhere.
//
// It is absent because it was measured and does nothing. Bun's store is keyed by
// version *and* dependency closure, so it really can hold one package twice — 19
// of them here at the time of writing, `expo` and `babel-preset-expo` among them
// — but none of those five are in that set, and bundling with the resolver and
// without it produced the same hash and the same 895 modules. If a dependency
// bump ever does split one of them, the symptom is silence on a connected
// session and the fix is a `resolver.resolveRequest` anchoring those names on
// this package's entry point. Measure before adding it back rather than carrying
// it on the strength of the reasoning: that is how it came to be here the first
// time.

// For `.scripts/verify-hologram-on-emulator.sh` only: an emulator has no
// ElevenLabs session, so that script bundles the app with a recorded voice in
// place of the live one. Only `src/`'s own import of `./jarvis-voice` is
// redirected, and only when the script sets the variable — an ordinary build,
// and every CI build, never takes this branch.
if (process.env.JARVIS_VOICE_REPLAY === '1') {
  const sourceRoot = path.join(projectRoot, 'src') + path.sep;
  const replayVoice = path.join(projectRoot, 'tests', 'hologram-preview', 'jarvis-voice.replay.ts');
  const defaultResolveRequest = config.resolver.resolveRequest;

  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === './jarvis-voice' && context.originModulePath.startsWith(sourceRoot)) {
      return { type: 'sourceFile', filePath: replayVoice };
    }
    return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
  };
}

module.exports = config;
