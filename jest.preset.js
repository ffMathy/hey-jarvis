const nxPreset = require('@nx/jest/preset').default;
const path = require('path');
const options = require('./tsconfig.base.json');

// Register ts-node for TypeScript global setup/teardown files
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: options.compilerOptions,
});

module.exports = {
  ...nxPreset,
  testMatch: ['**/+(*.)+(spec|test).+(ts|js)?(x)'],
  resolver: '@nx/jest/plugins/resolver',
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageReporters: ['html'],
  globalSetup: path.join(__dirname, 'jest.global-setup.ts'),
  globalTeardown: path.join(__dirname, 'jest.global-teardown.ts'),
};
