export default {
  displayName: 'elevenlabs',
  testEnvironment: 'node',
  coverageDirectory: './coverage/elevenlabs',
  testMatch: ['<rootDir>/dist/elevenlabs-test/**/*.spec.js', '<rootDir>/dist/elevenlabs-test/**/*.test.js'],
  testTimeout: 60000,
  maxWorkers: 1,
  moduleFileExtensions: ['js', 'json'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // No transform needed - running on compiled JavaScript
  transform: {},
  transformIgnorePatterns: [],
  rootDir: '..',
  coverageReporters: ['html'],
};
