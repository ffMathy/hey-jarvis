// Metro has to be told about the monorepo twice: once so it watches sibling
// packages for changes, and once so it looks for modules in the workspace root
// as well as here. Bun installs this app's own dependencies into
// `watch/node_modules` and the shared ones into the root, so a bundler that
// knows about only one of the two resolves half the tree.
//
// The sibling that matters most is `hologram/`, which holds the sphere and is
// shared with the phone app. It is TypeScript source, not a build, so Metro
// compiles it here along with everything else — which is the point: there is one
// copy of Jarvis and both apps bundle it from the same files.
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

// `disableHierarchicalLookup` is the usual monorepo advice and is wrong here,
// for the reason `mobile/metro.config.js` sets out at length: Bun's isolated
// linker puts every package's own dependencies beside it, and walking up from
// the importing file is how they are found at all.

module.exports = config;
