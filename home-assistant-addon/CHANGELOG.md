# Changelog

## [3.1.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v3.0.5...home-assistant-addon-v3.1.0) (2025-11-07)


### Features

* **home-assistant-addon:** add catch-all proxy and improve e2e test assertions ([56650e4](https://github.com/ffMathy/hey-jarvis/commit/56650e45652879ba7bf8ce7cccc177efac5a541b))
* **home-assistant-addon:** add catch-all proxy and improve e2e test assertions ([0a9b41c](https://github.com/ffMathy/hey-jarvis/commit/0a9b41cddf8a67012831da6852315abf187cf119))
* **home-assistant-addon:** add nginx to e2e test for ingress simulation ([eac41e8](https://github.com/ffMathy/hey-jarvis/commit/eac41e86f3d603ea27ab6044e17543ebc5e5b993))
* **home-assistant-addon:** add nginx to e2e test for ingress simulation ([22a7d96](https://github.com/ffMathy/hey-jarvis/commit/22a7d969151e7d9f0a976908694fc3c686498b83))


### Bug Fixes

* better paths ([b461d2b](https://github.com/ffMathy/hey-jarvis/commit/b461d2b1bbb08f01d1b3f8ac6ee09015667678a2))
* better tests ([c3f1b29](https://github.com/ffMathy/hey-jarvis/commit/c3f1b29aa4570e4b9c689e9ae12334058f6b91f2))
* end-to-end Home Assistant tests ([20e6860](https://github.com/ffMathy/hey-jarvis/commit/20e6860d21f791f4c760e67b7e355f259afd1480))
* end-to-end Home Assistant tests ([d146536](https://github.com/ffMathy/hey-jarvis/commit/d146536c785523a5775771677c761a1891480145))
* end-to-end Home Assistant tests ([3a553ac](https://github.com/ffMathy/hey-jarvis/commit/3a553ac451061dbc1a58cf72f96db0b024337e08))
* **home-assistant-addon:** simplify test entrypoint with direct env vars ([f4b5c20](https://github.com/ffMathy/hey-jarvis/commit/f4b5c20b8e5a0f80b1e8c9d6bbcf81f88e8bcb5e))
* missing lines ([439cff5](https://github.com/ffMathy/hey-jarvis/commit/439cff5ab0d5837284b58935f96a2b169921dbf9))
* playwright installation ([8f2197e](https://github.com/ffMathy/hey-jarvis/commit/8f2197e475226452b016bbe5d7ca168f29ea4c48))
* proper env check ([c28b0fd](https://github.com/ffMathy/hey-jarvis/commit/c28b0fd24430860d468f64927a85a54fe9e761ae))
* test performance ([ec3910d](https://github.com/ffMathy/hey-jarvis/commit/ec3910d7e3c2e89ccaaa10e9194dfcc48f8f795a))
* test url ([798260e](https://github.com/ffMathy/hey-jarvis/commit/798260ed57f873309694b70ef912a2f2a0633985))
* test url ([201da19](https://github.com/ffMathy/hey-jarvis/commit/201da19873fb01bec64563fd8ba0bc5171e7a420))
* tests now truly run via nx too ([85d3ac5](https://github.com/ffMathy/hey-jarvis/commit/85d3ac52e76e04162d325c6f5bdc297ae14a8fac))

## [3.0.5](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v3.0.4...home-assistant-addon-v3.0.5) (2025-11-06)


### Bug Fixes

* **home-assistant-addon:** remove invalid --port flag from mastra dev command ([c5344b0](https://github.com/ffMathy/hey-jarvis/commit/c5344b037b49a9ff2cc2422e5ee95d286c4965b7))

## [3.0.4](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v3.0.3...home-assistant-addon-v3.0.4) (2025-11-06)


### Bug Fixes

* **home-assistant-addon:** address code review feedback for error handling ([1cf0798](https://github.com/ffMathy/hey-jarvis/commit/1cf0798cb0ff77822e6c370dba33a7d31c466fc8))
* **home-assistant-addon:** explicitly specify port for mastra dev command ([9b29ee2](https://github.com/ffMathy/hey-jarvis/commit/9b29ee2f9545caa9894ea1ed51c317ae540104d3))
* **home-assistant-addon:** improve error handling for parallel server startup ([e5e71ac](https://github.com/ffMathy/hey-jarvis/commit/e5e71ac8df559f39c6099148843581ca15020171))
* **home-assistant-addon:** start both Mastra and MCP servers in parallel ([abf4104](https://github.com/ffMathy/hey-jarvis/commit/abf4104e07344d9de7ebf93e4e5915cf755ab587))

## [3.0.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v3.0.2...home-assistant-addon-v3.0.3) (2025-11-06)


### Bug Fixes

* **home-assistant-addon:** resolve docker entrypoint error and correct server path ([1271727](https://github.com/ffMathy/hey-jarvis/commit/127172723c8ea03e2cc276e45b235c78e03059e2))

## [3.0.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v3.0.1...home-assistant-addon-v3.0.2) (2025-11-06)


### Bug Fixes

* proper architecture ([b0f32c8](https://github.com/ffMathy/hey-jarvis/commit/b0f32c87e4b6179538107919278bd2a1c09ab536))

## [3.0.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v3.0.0...home-assistant-addon-v3.0.1) (2025-11-06)


### Bug Fixes

* update architecture label in Dockerfile ([3dc8dc8](https://github.com/ffMathy/hey-jarvis/commit/3dc8dc8c3b7620cde49fc5b629fa1f66487de243))

## [3.0.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v2.0.0...home-assistant-addon-v3.0.0) (2025-11-06)


### ⚠ BREAKING CHANGES

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51))

### Features

* add environment variable configuration support to Home Assistant addon ([#59](https://github.com/ffMathy/hey-jarvis/issues/59)) ([a7fae30](https://github.com/ffMathy/hey-jarvis/commit/a7fae30e99beebc43ff145c4e679d69844f4ed45))
* add new project and deploy pipeline ([857dd8a](https://github.com/ffMathy/hey-jarvis/commit/857dd8a7290100f31984d7a94fd822f85f2a1987))
* bump release to trigger new versions ([124c40a](https://github.com/ffMathy/hey-jarvis/commit/124c40aea32cecdc100bba92be17ef5d75f0f192))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))


### Bug Fixes

* 403 Docker build errors by using locally built base images ([#29](https://github.com/ffMathy/hey-jarvis/issues/29)) ([2af6a45](https://github.com/ffMathy/hey-jarvis/commit/2af6a45188878cfc16291454b07ff564f1a0c032))
* attempt at variable substitution ([7f3cbce](https://github.com/ffMathy/hey-jarvis/commit/7f3cbcebec69a3a322e2d1edf655e3252dd95b64))
* better deploy script ([#40](https://github.com/ffMathy/hey-jarvis/issues/40)) ([ae7a673](https://github.com/ffMathy/hey-jarvis/commit/ae7a67396bd900f0a4b9e44182d2fe8ea7836703))
* better version bumping ([296dced](https://github.com/ffMathy/hey-jarvis/commit/296dceda7add657fe42f73e3b8e091c2ba0399b9))
* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51)) ([0190cc9](https://github.com/ffMathy/hey-jarvis/commit/0190cc9332ff27a79d7dc34ca0f26539cb5a3b48))
* multi architecture builds ([#38](https://github.com/ffMathy/hey-jarvis/issues/38)) ([7d1237f](https://github.com/ffMathy/hey-jarvis/commit/7d1237fd23bf389a290ceab3160e74cf67786399))
* new changelog format ([0052c34](https://github.com/ffMathy/hey-jarvis/commit/0052c34e8b7d5e672ed00e8a3a43fe8b9ede5219))
* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))
* resolve build issue in dockerfile ([5f92e5a](https://github.com/ffMathy/hey-jarvis/commit/5f92e5a830540c43b523e863ca53a71be5664ea2))

## [2.0.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.2.0...home-assistant-addon-v2.0.0) (2025-11-06)


### ⚠ BREAKING CHANGES

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51))

### Features

* add environment variable configuration support to Home Assistant addon ([#59](https://github.com/ffMathy/hey-jarvis/issues/59)) ([a7fae30](https://github.com/ffMathy/hey-jarvis/commit/a7fae30e99beebc43ff145c4e679d69844f4ed45))
* add new project and deploy pipeline ([857dd8a](https://github.com/ffMathy/hey-jarvis/commit/857dd8a7290100f31984d7a94fd822f85f2a1987))
* bump release to trigger new versions ([124c40a](https://github.com/ffMathy/hey-jarvis/commit/124c40aea32cecdc100bba92be17ef5d75f0f192))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))


### Bug Fixes

* 403 Docker build errors by using locally built base images ([#29](https://github.com/ffMathy/hey-jarvis/issues/29)) ([2af6a45](https://github.com/ffMathy/hey-jarvis/commit/2af6a45188878cfc16291454b07ff564f1a0c032))
* attempt at variable substitution ([7f3cbce](https://github.com/ffMathy/hey-jarvis/commit/7f3cbcebec69a3a322e2d1edf655e3252dd95b64))
* better deploy script ([#40](https://github.com/ffMathy/hey-jarvis/issues/40)) ([ae7a673](https://github.com/ffMathy/hey-jarvis/commit/ae7a67396bd900f0a4b9e44182d2fe8ea7836703))
* better version bumping ([296dced](https://github.com/ffMathy/hey-jarvis/commit/296dceda7add657fe42f73e3b8e091c2ba0399b9))
* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51)) ([0190cc9](https://github.com/ffMathy/hey-jarvis/commit/0190cc9332ff27a79d7dc34ca0f26539cb5a3b48))
* multi architecture builds ([#38](https://github.com/ffMathy/hey-jarvis/issues/38)) ([7d1237f](https://github.com/ffMathy/hey-jarvis/commit/7d1237fd23bf389a290ceab3160e74cf67786399))
* new changelog format ([0052c34](https://github.com/ffMathy/hey-jarvis/commit/0052c34e8b7d5e672ed00e8a3a43fe8b9ede5219))
* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))
* resolve build issue in dockerfile ([5f92e5a](https://github.com/ffMathy/hey-jarvis/commit/5f92e5a830540c43b523e863ca53a71be5664ea2))

## [1.2.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.1...home-assistant-addon-v1.2.0) (2025-11-06)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [1.1.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.0...home-assistant-addon-v1.1.1) (2025-11-05)


### Bug Fixes

* resolve build issue in dockerfile ([5f92e5a](https://github.com/ffMathy/hey-jarvis/commit/5f92e5a830540c43b523e863ca53a71be5664ea2))

## [1.1.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.0.3...home-assistant-addon-v1.1.0) (2025-10-14)


### Features

* add environment variable configuration support to Home Assistant addon ([#59](https://github.com/ffMathy/hey-jarvis/issues/59)) ([a7fae30](https://github.com/ffMathy/hey-jarvis/commit/a7fae30e99beebc43ff145c4e679d69844f4ed45))

## [1.0.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.0.2...home-assistant-addon-v1.0.3) (2025-10-14)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize jarvis-mcp versions

## [1.0.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.0.1...home-assistant-addon-v1.0.2) (2025-10-14)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize jarvis-mcp versions

## [1.0.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.0.0...home-assistant-addon-v1.0.1) (2025-10-07)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize jarvis-mcp versions

## [1.0.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.3.5...home-assistant-addon-v1.0.0) (2025-10-04)


### ⚠ BREAKING CHANGES

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51))

### Bug Fixes

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51)) ([0190cc9](https://github.com/ffMathy/hey-jarvis/commit/0190cc9332ff27a79d7dc34ca0f26539cb5a3b48))

## [0.3.5](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.3.4...home-assistant-addon-v0.3.5) (2025-10-04)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize jarvis-mcp versions

## [0.3.4](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.3.3...home-assistant-addon-v0.3.4) (2025-10-02)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize jarvis-mcp versions

## [0.3.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.3.2...home-assistant-addon-v0.3.3) (2025-10-02)

## [0.3.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.3.1...home-assistant-addon-v0.3.2) (2025-10-02)


### Bug Fixes

* better deploy script ([#40](https://github.com/ffMathy/hey-jarvis/issues/40)) ([ae7a673](https://github.com/ffMathy/hey-jarvis/commit/ae7a67396bd900f0a4b9e44182d2fe8ea7836703))

## [0.3.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.3.0...home-assistant-addon-v0.3.1) (2025-10-02)


### Bug Fixes

* multi architecture builds ([#38](https://github.com/ffMathy/hey-jarvis/issues/38)) ([7d1237f](https://github.com/ffMathy/hey-jarvis/commit/7d1237fd23bf389a290ceab3160e74cf67786399))

## [0.3.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.2.2...home-assistant-addon-v0.3.0) (2025-10-02)


### Features

* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))

## [0.2.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.2.1...home-assistant-addon-v0.2.2) (2025-10-01)


### Bug Fixes

* 403 Docker build errors by using locally built base images ([#29](https://github.com/ffMathy/hey-jarvis/issues/29)) ([2af6a45](https://github.com/ffMathy/hey-jarvis/commit/2af6a45188878cfc16291454b07ff564f1a0c032))

## [0.2.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.2.0...home-assistant-addon-v0.2.1) (2025-09-30)


### Bug Fixes

* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))

## [0.2.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.1.0...home-assistant-addon-v0.2.0) (2025-09-30)


### Features

* add new project and deploy pipeline ([857dd8a](https://github.com/ffMathy/hey-jarvis/commit/857dd8a7290100f31984d7a94fd822f85f2a1987))
* bump release to trigger new versions ([124c40a](https://github.com/ffMathy/hey-jarvis/commit/124c40aea32cecdc100bba92be17ef5d75f0f192))


### Bug Fixes

* attempt at variable substitution ([7f3cbce](https://github.com/ffMathy/hey-jarvis/commit/7f3cbcebec69a3a322e2d1edf655e3252dd95b64))
* better version bumping ([296dced](https://github.com/ffMathy/hey-jarvis/commit/296dceda7add657fe42f73e3b8e091c2ba0399b9))
* new changelog format ([0052c34](https://github.com/ffMathy/hey-jarvis/commit/0052c34e8b7d5e672ed00e8a3a43fe8b9ede5219))
