// Metro has to be told about the monorepo twice: once so it watches sibling
// packages for changes, and once so it looks for modules in the workspace root
// as well as here. Bun installs this app's own dependencies into
// `mobile/node_modules` and the shared ones into the root, so a bundler that
// knows about only one of the two resolves half the tree.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

/**
 * Packages that must never appear twice in one bundle.
 *
 * Two copies of React is the familiar version of this problem. The one that
 * matters more here is quieter: `@elevenlabs/react-native` calls
 * `registerGlobals()` from `@livekit/react-native` to install the WebRTC globals,
 * and `@elevenlabs/client` reads them back. If those two ever looked at different
 * physical copies, the session would report itself connected and then produce
 * silence, with no error anywhere.
 */
const SINGLETON_PACKAGES = [
  'react',
  'react-native',
  'livekit-client',
  '@livekit/react-native',
  '@livekit/react-native-webrtc',
];

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// `disableHierarchicalLookup` is the usual monorepo advice and is wrong here.
// Bun's isolated linker gives every package its own `node_modules` alongside it
// under `node_modules/.bun/<name>@<version>/`, and walking up from the importing
// file is how a package's own dependencies are found at all — switching it off
// makes `expo` unable to resolve `expo-modules-core`. Duplicate copies are kept
// out by the resolver below instead, which is the narrower tool for that job.

const upstreamResolveRequest = config.resolver.resolveRequest;

const resolve = (context, moduleName, platform) =>
  (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);

/**
 * Resolves the packages above as if every import of them came from the app's own
 * entry point, so they all land on the same copy however deep in the tree the
 * importer sits.
 *
 * Anchoring on the entry file rather than on each package's `package.json` is
 * deliberate: several of these declare an `exports` map with no `./package.json`
 * entry, and asking for one is an outright resolution error.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton = SINGLETON_PACKAGES.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));

  if (!isSingleton) {
    return resolve(context, moduleName, platform);
  }

  return resolve({ ...context, originModulePath: path.join(projectRoot, 'index.ts') }, moduleName, platform);
};

module.exports = config;
