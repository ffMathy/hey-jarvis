# Changelog

## [1.3.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.2.3...mcp-v1.3.0) (2026-01-10)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [1.2.3](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.2.2...mcp-v1.2.3) (2026-01-09)


### Bug Fixes

* **mcp:** keep default port as 4112 for tests, use 8112 in production ([3200c18](https://github.com/ffMathy/hey-jarvis/commit/3200c1852c496bc1a4bc5d295fd0ae10f4477294))
* **mcp:** resolve nginx circular proxy by using internal port 8112 ([d2a9eb3](https://github.com/ffMathy/hey-jarvis/commit/d2a9eb3cae9938ccf93350a13860906bcc6a4f3a))
* **mcp:** resolve nginx circular proxy configuration ([#456](https://github.com/ffMathy/hey-jarvis/issues/456)) ([f373c13](https://github.com/ffMathy/hey-jarvis/commit/f373c1390789b4e724c9985f9e3c37ad2d1fc183))

## [1.2.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.2.1...mcp-v1.2.2) (2026-01-09)


### Bug Fixes

* **mcp,home-assistant-addon:** fix nginx connection refused to upstream services ([9ccfdfc](https://github.com/ffMathy/hey-jarvis/commit/9ccfdfc8d363c2f5fc7eaa2400cc81f60cba3a06))
* **mcp,home-assistant-addon:** resolve nginx IPv6 connection failures to upstream services ([#454](https://github.com/ffMathy/hey-jarvis/issues/454)) ([5c3f62d](https://github.com/ffMathy/hey-jarvis/commit/5c3f62d98234e36b2d56cff8590ddcc62041d2dd))

## [1.2.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.2.0...mcp-v1.2.1) (2026-01-09)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [1.2.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.7...mcp-v1.2.0) (2026-01-09)


### Features

* **iot:** add noise baseline calculation and filtering for state changes ([8f7fb89](https://github.com/ffMathy/hey-jarvis/commit/8f7fb8915a96a4e5d9c4c24e1b18c46bb869de24))
* **iot:** Add noise baseline filtering for IoT state changes ([#444](https://github.com/ffMathy/hey-jarvis/issues/444)) ([ee351a5](https://github.com/ffMathy/hey-jarvis/commit/ee351a5b80cde0d6834ddb76fc9606b9fb75f891))


### Bug Fixes

* **mcp:** thread email count through workflow pipeline ([#445](https://github.com/ffMathy/hey-jarvis/issues/445)) ([a3e6358](https://github.com/ffMathy/hey-jarvis/commit/a3e6358aff1fbe1216cc7c6ec7ddbff070a90170))
* **mcp:** thread email count through workflow pipeline to fix logging inconsistency ([ab47b2d](https://github.com/ffMathy/hey-jarvis/commit/ab47b2d09cef20215cf57b624b9f0df97ec66610))
* **tests:** fix shopping list API content filtering issues ([e345298](https://github.com/ffMathy/hey-jarvis/commit/e3452989ad61d6f7dda3d588486d425c5c5b9371))

## [1.1.7](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.6...mcp-v1.1.7) (2026-01-08)


### Bug Fixes

* better stability around ports ([753f7c1](https://github.com/ffMathy/hey-jarvis/commit/753f7c189fc2b678d66d421f4543d92b9ffae2a6))
* better stability around ports ([#442](https://github.com/ffMathy/hey-jarvis/issues/442)) ([37beddc](https://github.com/ffMathy/hey-jarvis/commit/37beddcb343e5b5eeb2516acfa129de8651f3879))

## [1.1.6](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.5...mcp-v1.1.6) (2026-01-08)


### Bug Fixes

* new ingress relay ([57c2e0a](https://github.com/ffMathy/hey-jarvis/commit/57c2e0a9c639e3b10b4d4678446baf48fa5f63b7))
* new ingress relay ([#441](https://github.com/ffMathy/hey-jarvis/issues/441)) ([27da5a9](https://github.com/ffMathy/hey-jarvis/commit/27da5a9a9f8c01d9736a810e09ca4fe1e3339ca6))

## [1.1.5](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.4...mcp-v1.1.5) (2026-01-08)


### Bug Fixes

* **addon:** route ingress traffic through nginx for path rewriting ([#437](https://github.com/ffMathy/hey-jarvis/issues/437)) ([9836ad8](https://github.com/ffMathy/hey-jarvis/commit/9836ad814d77bc8f09ae6e74ec31e0dbe2ce176b))
* **addon:** update nginx and supervisord to handle ingress on port 4113 ([e0ae5c0](https://github.com/ffMathy/hey-jarvis/commit/e0ae5c0147ad5248a282ae7a23041530f9aecb89))

## [1.1.4](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.3...mcp-v1.1.4) (2026-01-07)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [1.1.3](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.2...mcp-v1.1.3) (2026-01-07)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [1.1.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.1...mcp-v1.1.2) (2026-01-07)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [1.1.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.0...mcp-v1.1.1) (2026-01-06)


### Bug Fixes

* better base URL support ([9e6bfdf](https://github.com/ffMathy/hey-jarvis/commit/9e6bfdf7e19f4a56ff9d073f32236bae6c2dd31d))
* better project startup ([a41faaa](https://github.com/ffMathy/hey-jarvis/commit/a41faaac498b893d656b9a9d730471b81ab0e843))
* better start_mastra function ([60c27c3](https://github.com/ffMathy/hey-jarvis/commit/60c27c321ed5235dfaa3c3634385513d5d4d5792))
* build failures ([428d5c0](https://github.com/ffMathy/hey-jarvis/commit/428d5c0e84a17347d9263ecea34e1447c940a5a9))
* docker build ([f2467eb](https://github.com/ffMathy/hey-jarvis/commit/f2467eb4ae22e55a74ad2befd1e7db868c9d18e2))
* jarvis stability ([#427](https://github.com/ffMathy/hey-jarvis/issues/427)) ([35298b1](https://github.com/ffMathy/hey-jarvis/commit/35298b10d354015eeab9e7059dfa64ba54304460))
* skip ollama tests ([b541c04](https://github.com/ffMathy/hey-jarvis/commit/b541c0498b8bca5a0c87343be8211c2b8df8d8b9))
* test ([1145c47](https://github.com/ffMathy/hey-jarvis/commit/1145c47bac24d7c1c6cd8664389f54891bdf221d))
* updates to stability ([8215965](https://github.com/ffMathy/hey-jarvis/commit/8215965e8818c22d6a94cc4b0d399063d39c2612))

## [1.1.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.0.2...mcp-v1.1.0) (2025-12-29)


### Features

* **mcp:** add Mastra Studio UI support to Docker and local development ([a5f4420](https://github.com/ffMathy/hey-jarvis/commit/a5f442084d8dac58f06c1c994b20758e2fbb8a05))
* **mcp:** add Mastra v1 Studio UI with Docker support (verified working) ([#423](https://github.com/ffMathy/hey-jarvis/issues/423)) ([d7dc6b0](https://github.com/ffMathy/hey-jarvis/commit/d7dc6b068c398e9b009862dc968719c10cb8bfa4))


### Bug Fixes

* **mcp:** make Studio UI health check mandatory ([edc2360](https://github.com/ffMathy/hey-jarvis/commit/edc236078f949c4918e44f8b6507338951e0148d))
* **mcp:** resolve Docker build and make services work without mastra build ([caaab48](https://github.com/ffMathy/hey-jarvis/commit/caaab480b2a3d6d1316bed205c0a9854a7d161c6))

## [1.0.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.0.1...mcp-v1.0.2) (2025-12-11)


### Bug Fixes

* **mcp:** correct import path for ollama-provider in weather workflow tests ([3fb6ec0](https://github.com/ffMathy/hey-jarvis/commit/3fb6ec02f46262f65fcfaa95b308c20d3a7386f4))
* **mcp:** fix test failures for weather workflow and IoT tests ([1fb1cad](https://github.com/ffMathy/hey-jarvis/commit/1fb1cad439e50f55afddd0597b3c6520f3a0eceb))
* **mcp:** remove --bytecode flag from Docker build commands ([#418](https://github.com/ffMathy/hey-jarvis/issues/418)) ([fa03673](https://github.com/ffMathy/hey-jarvis/commit/fa03673e67b0e232986b6555fca00ce7224688c1))
* **mcp:** remove bytecode flag from Dockerfile to fix build failure ([594fe1f](https://github.com/ffMathy/hey-jarvis/commit/594fe1fdca684bd4d9b51d7b1886667d6d48bcd2))

## [1.0.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.0.0...mcp-v1.0.1) (2025-12-11)


### Bug Fixes

* **mcp:** add twilio to bundler externals ([#415](https://github.com/ffMathy/hey-jarvis/issues/415)) ([d1772a7](https://github.com/ffMathy/hey-jarvis/commit/d1772a71db2ed437f339ce3cecd662e222d1a6e3))
* **mcp:** add twilio to Mastra bundler externals to fix build failure ([0856143](https://github.com/ffMathy/hey-jarvis/commit/0856143df8701b7025f26c8beaf46d7291a67952))

## [1.0.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.26.1...mcp-v1.0.0) (2025-12-11)


### ⚠ BREAKING CHANGES

* None - this is a workaround for an internal Mastra bug

### Features

* upgrade Mastra packages to beta.9 and run v1 codemod ([02255f3](https://github.com/ffMathy/hey-jarvis/commit/02255f36cfc3bc098e5d65f5197c47b7040c04a2))
* upgrade to Mastra v1 beta.10 and fix UsageStats API changes ([21ec867](https://github.com/ffMathy/hey-jarvis/commit/21ec867a30bda1a4b1a63bd592696e0c94ab5233))


### Bug Fixes

* add Home Assistant addon support and Docker health checks ([c2165c5](https://github.com/ffMathy/hey-jarvis/commit/c2165c55f49700419bb9e4992c180b9568a3f62a))
* add missing CI env vars and skip broken routing workflow test ([f90affe](https://github.com/ffMathy/hey-jarvis/commit/f90affe954186919f99e0e5f77dd5555188cf6c0))
* add missing port environment variables to MCP Dockerfile ([e311605](https://github.com/ffMathy/hey-jarvis/commit/e31160511cb3ae388d475a850b6dbb3e8bdb1f97))
* better bundling ([a9973f2](https://github.com/ffMathy/hey-jarvis/commit/a9973f29c8e88d6d36df07e146c3a6905cea1d64))
* bypass Mastra memory.getInputProcessors bug in workflow agents ([48524e6](https://github.com/ffMathy/hey-jarvis/commit/48524e6e6d6f2b1337b7b67ee04f09e778d7e45a))
* compile issues resolved ([6e58099](https://github.com/ffMathy/hey-jarvis/commit/6e580993b752fa94581399bf8beebe10723376b9))
* downgrade Mastra packages to beta.5 to restore routing workflow test compatibility ([2f40ea6](https://github.com/ffMathy/hey-jarvis/commit/2f40ea6ac8d5dba40a2062063055b0794b8ffa96))
* fix broken reference ([96c02c8](https://github.com/ffMathy/hey-jarvis/commit/96c02c87372c4bd949950bdc5c19764ba42e0e05))
* remove readonly property assignments but mastra build still fails due to version conflict ([1fb8fcf](https://github.com/ffMathy/hey-jarvis/commit/1fb8fcf539b4aaffb614f067d9995e293f17069d))
* remove unnecessary HEY_JARVIS_BILKA_SESSION environment variable requirement ([f2d5efc](https://github.com/ffMathy/hey-jarvis/commit/f2d5efc0ea0ac885e398c3bc279e87dffe618c6b))
* resolve all unnecessary [@ts-expect-error](https://github.com/ts-expect-error) directives ([040e0ed](https://github.com/ffMathy/hey-jarvis/commit/040e0ed274c1bde657082f9e79ee103cdc09155e))
* resolve mastra build error by deferring async initialization ([b60d1e3](https://github.com/ffMathy/hey-jarvis/commit/b60d1e3d35449539132ee48c925439f20779ae5f))

## [0.26.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.26.0...mcp-v0.26.1) (2025-12-07)


### Bug Fixes

* 400 Bad Request in email workflow due to unencoded OData filters ([#411](https://github.com/ffMathy/hey-jarvis/issues/411)) ([631e135](https://github.com/ffMathy/hey-jarvis/commit/631e135bd03d3422ba400625a4b0bef558dad64a))
* **email:** add URL encoding for receivedDateTime filter to prevent 400 errors ([2a1d79e](https://github.com/ffMathy/hey-jarvis/commit/2a1d79e6d9aada60b8d8dad7ba99b6f616beac7f))
* **email:** add URL encoding for search filters and improve error logging ([844eee6](https://github.com/ffMathy/hey-jarvis/commit/844eee63c41a9eac8b3fd65f54d542ece97687fd))

## [0.26.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.25.1...mcp-v0.26.0) (2025-12-07)


### Features

* add token usage tracking with startup logging and quota management via AI tracing ([#406](https://github.com/ffMathy/hey-jarvis/issues/406)) ([ce76b31](https://github.com/ffMathy/hey-jarvis/commit/ce76b3159fcf6a88cd0b06b37ff5742fe70365a7))
* migrate web research agent from Tavily API to Google Search tool ([#407](https://github.com/ffMathy/hey-jarvis/issues/407)) ([fd6eb85](https://github.com/ffMathy/hey-jarvis/commit/fd6eb857617cbb8f7fab71f055a10ec4acbc7563))
* **token-usage:** add token usage tracking and quota management ([aa1ac5f](https://github.com/ffMathy/hey-jarvis/commit/aa1ac5f630e2edec5a80c098c276b70144aaecd1))
* **web-research:** migrate to Google Search Grounding ([3947b73](https://github.com/ffMathy/hey-jarvis/commit/3947b73a5f0dc386de1a500fb0381a2e8861b76c))


### Bug Fixes

* **observability:** correct import path for exporters ([747689e](https://github.com/ffMathy/hey-jarvis/commit/747689ec24147b65cbc3c0f08f6b2c2145802a4c))
* **tests:** fix unused variable warning in token usage tests ([b139933](https://github.com/ffMathy/hey-jarvis/commit/b139933c5c890861427981d662417008bc475dbd))
* **token-usage:** address code review feedback ([3c380c4](https://github.com/ffMathy/hey-jarvis/commit/3c380c4e590c423e77e16bad3fb0416d09fab5e0))
* **token-usage:** correct import paths in token-usage-tools.ts ([579dc77](https://github.com/ffMathy/hey-jarvis/commit/579dc775498a4be32eda5c1ab85d0e73761f0bdb))
* **web-research:** use google.tools.googleSearch instead of grounding ([cf46ad8](https://github.com/ffMathy/hey-jarvis/commit/cf46ad8accdc1418cd8149ea78b3a53064f33678))

## [0.25.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.25.0...mcp-v0.25.1) (2025-12-06)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [0.25.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.24.0...mcp-v0.25.0) (2025-12-06)


### Features

* **email:** Add email trigger capability for programmatic workflow execution ([68642ea](https://github.com/ffMathy/hey-jarvis/commit/68642ea01d92d95ea75b2738681d810526046fdc))
* **email:** add email trigger system for programmatic workflow execution ([#403](https://github.com/ffMathy/hey-jarvis/issues/403)) ([9c4fe30](https://github.com/ffMathy/hey-jarvis/commit/9c4fe30ca62c4a65cd282e986aa0900eab9af284))


### Bug Fixes

* **ci:** scope build cancellation to same branch per actor ([490693c](https://github.com/ffMathy/hey-jarvis/commit/490693c271cc7288d84db4276cf61ad00863ce41))
* **mcp:** use separate storage keys for email workflows to prevent race condition ([490693c](https://github.com/ffMathy/hey-jarvis/commit/490693c271cc7288d84db4276cf61ad00863ce41))

## [0.24.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.23.0...mcp-v0.24.0) (2025-12-05)


### Features

* **mcp:** add createShortcut utility and update shortcuts to use Tessie patterns ([f32b4af](https://github.com/ffMathy/hey-jarvis/commit/f32b4af3e048bc36ce5e16769e119a18f2f53e95))
* **mcp:** add shortcuts.ts pattern for cross-vertical tool re-use ([0856e9a](https://github.com/ffMathy/hey-jarvis/commit/0856e9aec5b89bac0f75863e06a4c4625cbeaf7d))
* **mcp:** add shortcuts.ts pattern for cross-vertical tool re-use ([#401](https://github.com/ffMathy/hey-jarvis/issues/401)) ([662b0db](https://github.com/ffMathy/hey-jarvis/commit/662b0dbd5b36a9746ea21eb6387f75e445aa569e))
* **mcp:** change Ollama default URL to homeassistant.local and remove Ollama from Docker ([53cd0fa](https://github.com/ffMathy/hey-jarvis/commit/53cd0fad20c202ed2c2f3f13df79488da9ff60ea))


### Bug Fixes

* change Ollama provider to use homeassistant.local and remove from Docker image ([#394](https://github.com/ffMathy/hey-jarvis/issues/394)) ([ff8e4e4](https://github.com/ffMathy/hey-jarvis/commit/ff8e4e40521087dcb179b2d7a170e8dc283554b6))
* **mcp:** add min(1) validation to shopping list input schema and fix CI test failures ([#390](https://github.com/ffMathy/hey-jarvis/issues/390)) ([74f4afa](https://github.com/ffMathy/hey-jarvis/commit/74f4afa7278390fe5b57e5e71cbc9257d9e8567b))
* **mcp:** add min(1) validation to shopping list input schema to reject empty prompts ([84e9620](https://github.com/ffMathy/hey-jarvis/commit/84e962094198de88daac1ed40a7a3b4980bb24ca))
* **mcp:** add retry with validation for flaky LLM test that checks explicit location handling ([af62c50](https://github.com/ffMathy/hey-jarvis/commit/af62c50ad72eac8fc0eac5864b5e20a647a1ff5d))
* **mcp:** address code review feedback for shortcuts ([11c7fd3](https://github.com/ffMathy/hey-jarvis/commit/11c7fd378a788596ae3350117859aed9da808076))
* **mcp:** also exclude MCP subpaths from JSON body parsing middleware ([d437c28](https://github.com/ffMathy/hey-jarvis/commit/d437c28538863ca7fe4ff09384744c6c9755a8bc))
* **mcp:** exclude MCP endpoint from express.json middleware ([#389](https://github.com/ffMathy/hey-jarvis/issues/389)) ([610d4b1](https://github.com/ffMathy/hey-jarvis/commit/610d4b1e6af99e367d779edb1b985e7f030c99bf))
* **mcp:** exclude MCP endpoint from express.json middleware to fix body consumption issue ([b6a6a49](https://github.com/ffMathy/hey-jarvis/commit/b6a6a49f351b8b9659b1c3ab5ae69c30b615e966))
* **mcp:** remove getOllamaHost and getOllamaPort exports from index.ts ([178f63e](https://github.com/ffMathy/hey-jarvis/commit/178f63e3fdf77eec1db1f709410e3b15b4d928b0))

## [0.23.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.22.3...mcp-v0.23.0) (2025-12-03)


### Features

* **mcp:** add REST API endpoints for workflow invocation ([#387](https://github.com/ffMathy/hey-jarvis/issues/387)) ([8893863](https://github.com/ffMathy/hey-jarvis/commit/889386345f91447e588592b7bc8345a3b0f256ea))
* **mcp:** add shopping list API endpoint with Zod validation ([f6de36b](https://github.com/ffMathy/hey-jarvis/commit/f6de36bb5d237365e5f63276294a09a9c7c01daa))


### Bug Fixes

* **mcp:** improve MCP server startup reliability for tests ([4b9431a](https://github.com/ffMathy/hey-jarvis/commit/4b9431ac90bb4adc7ab68e191a761d7c1eb9a442))

## [0.22.3](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.22.2...mcp-v0.22.3) (2025-12-02)


### Bug Fixes

* **cooking:** add plain text description to subject field in outputSchema ([7e95a60](https://github.com/ffMathy/hey-jarvis/commit/7e95a603c14947f11d1bfded9c9b4f383313eac3))
* **cooking:** clarify prompt to return HTML body and plain text subject ([473ca0e](https://github.com/ffMathy/hey-jarvis/commit/473ca0eadf1b3862f088943b64ed04876a05df08))
* **cooking:** ensure meal plan email subject is plain text only ([c716d28](https://github.com/ffMathy/hey-jarvis/commit/c716d28276db3f7fd43fb9dc6f270d6b21bedb27))
* **cooking:** ensure meal plan email subject is plain text only ([#384](https://github.com/ffMathy/hey-jarvis/issues/384)) ([7909336](https://github.com/ffMathy/hey-jarvis/commit/7909336441070af72e2c623504e0e1e3a8bdc080))

## [0.22.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.22.1...mcp-v0.22.2) (2025-12-02)


### Bug Fixes

* better local testing of cooking ([4547cda](https://github.com/ffMathy/hey-jarvis/commit/4547cdadb8cba4e625f2b4c19deac118534f8afe))
* better local testing of cooking ([#382](https://github.com/ffMathy/hey-jarvis/issues/382)) ([37b4c99](https://github.com/ffMathy/hey-jarvis/commit/37b4c9992023d8242d3e232222005e539bf87288))

## [0.22.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.22.0...mcp-v0.22.1) (2025-12-02)


### Bug Fixes

* address code review comments for state change batcher ([065918d](https://github.com/ffMathy/hey-jarvis/commit/065918d7207eba3b34023ad84fcf184718316825))
* correct Ollama tokens/sec metric and add state change batching ([#379](https://github.com/ffMathy/hey-jarvis/issues/379)) ([804a7b9](https://github.com/ffMathy/hey-jarvis/commit/804a7b9a23fa419eaf3bf1188e3204edd1ce1d72))
* correct tokens per second metric to use total tokens ([ce72523](https://github.com/ffMathy/hey-jarvis/commit/ce725233f93c4cbcb18c77fbb4787fc34aa237de))

## [0.22.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.21.0...mcp-v0.22.0) (2025-12-02)


### Features

* **mcp:** optimize Ollama queue overflow handling and reduce IoT monitoring frequency ([902e71f](https://github.com/ffMathy/hey-jarvis/commit/902e71f39c8bc0dd752786cb264f10e857501073))


### Bug Fixes

* disable mastra dev due to bundler bug causing module resolution error ([8eb8e67](https://github.com/ffMathy/hey-jarvis/commit/8eb8e67445ba6d8e844102214561b42368355eb9))
* disable mastra dev due to bundler bug causing module resolution error ([#375](https://github.com/ffMathy/hey-jarvis/issues/375)) ([4f930e8](https://github.com/ffMathy/hey-jarvis/commit/4f930e8b37b2d942cf705c85f25eaf912d10bea4))
* **mcp:** change IoT monitoring interval to every 15 minutes ([1152d04](https://github.com/ffMathy/hey-jarvis/commit/1152d04cb9cc33d4409b37c935c1535996d770b4))
* **mcp:** replace non-null assertion with safe access pattern ([c1624af](https://github.com/ffMathy/hey-jarvis/commit/c1624af3ee81e5532af781f21b2ba7f7c769a194))
* remove TODO placeholder from supervisord comment ([2ef4a01](https://github.com/ffMathy/hey-jarvis/commit/2ef4a01f158405d6191ddc29e759d41581b6ba7c))

## [0.21.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.20.0...mcp-v0.21.0) (2025-12-01)


### Features

* **mcp:** add Ollama request queue for serial processing with max pending limit ([0a92467](https://github.com/ffMathy/hey-jarvis/commit/0a92467f237cd6578f353fbdfa5adb32b8dc4bda))
* **mcp:** add Ollama request queue for serial processing with max pending limit ([#373](https://github.com/ffMathy/hey-jarvis/issues/373)) ([a547ff2](https://github.com/ffMathy/hey-jarvis/commit/a547ff25a818100153d05c77a1e733e2ad65cd42))

## [0.20.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.19.0...mcp-v0.20.0) (2025-12-01)


### Features

* **mcp:** add logging and CPU limiting for Ollama inference calls ([2b2fc54](https://github.com/ffMathy/hey-jarvis/commit/2b2fc542c6d0ba10aeaa9a2e07519122f52afacd))
* **mcp:** add logging and CPU limiting for Ollama inference calls ([#370](https://github.com/ffMathy/hey-jarvis/issues/370)) ([1ee0c0b](https://github.com/ffMathy/hey-jarvis/commit/1ee0c0b6f8258d50db59e8fea4ca6c887e1bcd9d))
* **mcp:** add token metrics (tokens/sec) to Ollama inference logging ([e55f36e](https://github.com/ffMathy/hey-jarvis/commit/e55f36e615d02ea3ffd0b592b1469f7e1608fbe5))
* **phone,iot,notification:** add text messaging and user location tools ([2984654](https://github.com/ffMathy/hey-jarvis/commit/29846545abe3784bb75a86b2e49ddf1b1ea45ed3))
* **phone,iot,notification:** add text messaging and user location tools ([#367](https://github.com/ffMathy/hey-jarvis/issues/367)) ([51fb660](https://github.com/ffMathy/hey-jarvis/commit/51fb660594d2fc7cdd1d263bd88b7897f379f6d7))
* **synapse:** add console.log to output full JSON serialized changes in state change reactor workflow ([6c9328e](https://github.com/ffMathy/hey-jarvis/commit/6c9328e67bcada71196a2e4d73008631fbd5a7aa))
* **synapse:** log full JSON state changes in reactor workflow ([#372](https://github.com/ffMathy/hey-jarvis/issues/372)) ([35f2ee6](https://github.com/ffMathy/hey-jarvis/commit/35f2ee620304724176b98eb7113cffb5ab677a8b))


### Bug Fixes

* **mcp:** add @mastra/core to bundler externals to fix Docker module resolution ([#368](https://github.com/ffMathy/hey-jarvis/issues/368)) ([fe926aa](https://github.com/ffMathy/hey-jarvis/commit/fe926aa75ea31c2948b074e18683f1d07d14b23d))
* **mcp:** add @mastra/core to bundler externals to fix module resolution error ([261f20a](https://github.com/ffMathy/hey-jarvis/commit/261f20a6039d99da8c1f3dc8762592974d0141bf))
* **mcp:** add comment explaining bundler externals workaround ([8774b24](https://github.com/ffMathy/hey-jarvis/commit/8774b24cacd1698c83f6368600c1567fac8b4bd9))
* **mcp:** address code review - avoid mutation and ensure consistent fetch params ([e3ce96d](https://github.com/ffMathy/hey-jarvis/commit/e3ce96de4bd00dfa291d22822f2eb954a264c676))

## [0.19.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.18.0...mcp-v0.19.0) (2025-12-01)


### Features

* implement email state storage and enhance email processing workflows with persistent tracking ([fa4664c](https://github.com/ffMathy/hey-jarvis/commit/fa4664c94a850f8031d3d78fdacabb513bc7c368))


### Bug Fixes

* tests now pass ([f9d4778](https://github.com/ffMathy/hey-jarvis/commit/f9d47787b76c773bb766ea91e6482e8dd0f6d83e))
* tests now pass ([#363](https://github.com/ffMathy/hey-jarvis/issues/363)) ([5d16d8c](https://github.com/ffMathy/hey-jarvis/commit/5d16d8c5775654bd1688d11a38cb57bb27c800d3))
* typing issue ([e1f6b91](https://github.com/ffMathy/hey-jarvis/commit/e1f6b914c55282dc3b1e0cff4cbe2b3c3cbb342d))

## [0.18.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.17.0...mcp-v0.18.0) (2025-12-01)


### Features

* **iot:** add device state tracking and monitoring workflow ([d355cf2](https://github.com/ffMathy/hey-jarvis/commit/d355cf2f133f73c7c9cfad1d5aae8e7f9b7e2ead))
* **iot:** add device state tracking and monitoring workflow ([#360](https://github.com/ffMathy/hey-jarvis/issues/360)) ([8acf6fb](https://github.com/ffMathy/hey-jarvis/commit/8acf6fbc6ce1779dd6c3297163020cc42d4a026a))
* **mcp:** add GitHub Models support for CI/testing and DevContainer environments ([#354](https://github.com/ffMathy/hey-jarvis/issues/354)) ([45a9257](https://github.com/ffMathy/hey-jarvis/commit/45a9257602f46d5a0bc1d042bd78f8b923c4c9e3))
* **phone:** add phone vertical with initiatePhoneCall tool using ElevenLabs Twilio API ([9d791e7](https://github.com/ffMathy/hey-jarvis/commit/9d791e7fa59ba59c9bc25cd8fffad681f52c0a22))
* **phone:** add phone vertical with initiatePhoneCall tool using ElevenLabs Twilio API ([#361](https://github.com/ffMathy/hey-jarvis/issues/361)) ([7673c5f](https://github.com/ffMathy/hey-jarvis/commit/7673c5f56ef86c935cb6e8c75d4549463333bfa4))


### Bug Fixes

* disable working memory for State Change Reactor agent and fix ElevenLabs TS errors ([b794e48](https://github.com/ffMathy/hey-jarvis/commit/b794e48c66e567f8dbdfc8f82cba5c52ba741c54))
* make State Change Reactor the decision-maker with working memory for intelligent notification routing ([#359](https://github.com/ffMathy/hey-jarvis/issues/359)) ([ab9f8f1](https://github.com/ffMathy/hey-jarvis/commit/ab9f8f13d7a7b116139585f435596066c8a8767e))
* make State Change Reactor the decision-maker with working memory re-enabled ([8f4395f](https://github.com/ffMathy/hey-jarvis/commit/8f4395fa9960499e0bfd1c47d3aeb9dc3f30dc62))
* **phone:** address review feedback - hardcode phone number ID, throw errors, prefer test agent ID ([14dcf2f](https://github.com/ffMathy/hey-jarvis/commit/14dcf2f74d52c21e026915fd01ff5afc2ce0be85))
* replace .network() with .generate() in synapse workflow to avoid agent/tool confusion ([7c95aea](https://github.com/ffMathy/hey-jarvis/commit/7c95aea8ef074f77425e384d03eab90068b226f7))

## [0.17.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.16.2...mcp-v0.17.0) (2025-12-01)


### Features

* **mcp:** add Ollama lazy model loading and automatic model pull on Docker startup ([#357](https://github.com/ffMathy/hey-jarvis/issues/357)) ([7d1fb7a](https://github.com/ffMathy/hey-jarvis/commit/7d1fb7af13e7d3d1d8d1896a8eebb3f7fb4f54df))
* **mcp:** add Ollama lazy model loading and startup model pull ([38bf02e](https://github.com/ffMathy/hey-jarvis/commit/38bf02ee78851eb201bc32ed183d74b8151b8f08))


### Bug Fixes

* **mcp:** address code review feedback for Ollama lazy loading ([1906833](https://github.com/ffMathy/hey-jarvis/commit/19068339714815585d3061647cacac5162767bc3))
* **mcp:** improve Ollama model manager and update tests ([f1c7e90](https://github.com/ffMathy/hey-jarvis/commit/f1c7e90137fff29855a8100af692de2fb61ae3ef))

## [0.16.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.16.1...mcp-v0.16.2) (2025-12-01)


### Bug Fixes

* resolve circular dependency and add missing opentelemetry package ([bc1a71f](https://github.com/ffMathy/hey-jarvis/commit/bc1a71ff8ae748c9ec52778670bd7b8ff39ae94a))
* resolve circular dependency and add missing opentelemetry package ([#355](https://github.com/ffMathy/hey-jarvis/issues/355)) ([9bcd2c3](https://github.com/ffMathy/hey-jarvis/commit/9bcd2c3567c88ed075bb398b7418efb7a063274a))

## [0.16.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.16.0...mcp-v0.16.1) (2025-12-01)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [0.16.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.15.0...mcp-v0.16.0) (2025-11-30)


### Features

* switch Ollama to gemma3:1b for better performance ([91f6993](https://github.com/ffMathy/hey-jarvis/commit/91f699361ef873b48d41aa88b04410cbf1fd4b7e))
* switch to qwen3:0.6b and add Ollama integration tests ([7f9989c](https://github.com/ffMathy/hey-jarvis/commit/7f9989c75828ab4d547cc8f8c216d846a9a8168d))


### Bug Fixes

* enable strict mode and fix multiple TypeScript errors ([8256b36](https://github.com/ffMathy/hey-jarvis/commit/8256b3666d34e24aa5ab160e7a0915db4243d683))
* resolve remaining TypeScript strict mode errors ([7b84732](https://github.com/ffMathy/hey-jarvis/commit/7b84732e943d10b35852350592bbfc389032602f))
* restore /api suffix in Ollama baseURL ([b91d7d2](https://github.com/ffMathy/hey-jarvis/commit/b91d7d2eed1f96cedf40c4f0dec3609d72dbeac2))
* upgrade to ollama-ai-provider-v2 for AI SDK v5 compatibility ([a4ead0f](https://github.com/ffMathy/hey-jarvis/commit/a4ead0f9b6993933033192d13f1bc20a222ddf77))
* use Gemini Flash for cooking workflows instead of Ollama ([d733e5d](https://github.com/ffMathy/hey-jarvis/commit/d733e5daf1a8a4c452144a0474f5ac8184c08a1c))
* warnings and errors from building and linting the project ([#350](https://github.com/ffMathy/hey-jarvis/issues/350)) ([594c658](https://github.com/ffMathy/hey-jarvis/commit/594c658cacf0937cdff05b2887ade91795317ea6))

## [0.15.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.14.0...mcp-v0.15.0) (2025-11-29)


### Features

* add async DAG mode and update prompt wording per review feedback ([f7b02a3](https://github.com/ffMathy/hey-jarvis/commit/f7b02a3ef5730275a8248ef194866a8e118068e1))
* add human-in-the-loop feedback to weekly meal planning workflow ([274271f](https://github.com/ffMathy/hey-jarvis/commit/274271f617a7098f69d1e8f5b061a3f917bdc9a7))
* add instructions property to routePromptWorkflow and update elevenlabs prompt ([84e7d6f](https://github.com/ffMathy/hey-jarvis/commit/84e7d6f591493f1249b1b0ace731520aad921ea0))
* add lint-staged to husky pre-commit and global lint dependencies ([4bb4777](https://github.com/ffMathy/hey-jarvis/commit/4bb4777aeb8e9db1e5537b25c81ebd3249e3eb0e))
* add lint-staged to husky pre-commit and global lint dependencies ([#343](https://github.com/ffMathy/hey-jarvis/issues/343)) ([83f5fe8](https://github.com/ffMathy/hey-jarvis/commit/83f5fe8c630ece3f2086baeb9e81e28ddcae2d98))
* add local Gemma 3 LLM via Ollama for scheduler-triggered agents ([6534d27](https://github.com/ffMathy/hey-jarvis/commit/6534d272703c5ca65893aa9cbca0aa3920e1c755))
* add local Gemma 3 LLM via Ollama for scheduler-triggered agents ([#339](https://github.com/ffMathy/hey-jarvis/issues/339)) ([761b201](https://github.com/ffMathy/hey-jarvis/commit/761b201c173cf16fb4318c7978a6206278e98bb8))
* configure Ollama models to store in /data/llm/models with backup exclusion ([#348](https://github.com/ffMathy/hey-jarvis/issues/348)) ([a486d19](https://github.com/ffMathy/hey-jarvis/commit/a486d194817683d4d50a990cb22baf4077b8c1fc))
* implement TypeScript project linking in the monorepo ([a09787e](https://github.com/ffMathy/hey-jarvis/commit/a09787e2afd61e11700975e85d215c38057b1918))
* **mcp:** add LLM-evaluated tests for routing workflows DAG generation ([318cba4](https://github.com/ffMathy/hey-jarvis/commit/318cba435b427cc72264cbbf76a45161464f2031))
* **mcp:** add LLM-evaluated tests for routing workflows DAG generation ([#336](https://github.com/ffMathy/hey-jarvis/issues/336)) ([b87c264](https://github.com/ffMathy/hey-jarvis/commit/b87c264a18c9522a3b5f3393f322a40f3989caec))
* **mcp:** configure Ollama models directory to /data/llm/models ([05a778e](https://github.com/ffMathy/hey-jarvis/commit/05a778e6515c3a2121f0acb26be61afc28f8fcc6))
* simplify elevenlabs prompt to single tool with instructions-driven flow ([#340](https://github.com/ffMathy/hey-jarvis/issues/340)) ([58fb497](https://github.com/ffMathy/hey-jarvis/commit/58fb497e32ec6a7fdfd20337c2bc6ad84b166492))
* switch state change reactor and scheduler agents to Gemma 3 ([57e7074](https://github.com/ffMathy/hey-jarvis/commit/57e7074d5ebe174d4c0b46b09a1d16feafe0a1c6))


### Bug Fixes

* limit feedback history and add message fallback ([07560f4](https://github.com/ffMathy/hey-jarvis/commit/07560f491052f4758d190e2dcabdc0e0e8ec3c9e))
* remove all any casts using .map() for type-safe data transformation ([0d89196](https://github.com/ffMathy/hey-jarvis/commit/0d89196f0b01c48ded8041ae417b8d96c3510e6a))
* remove dist-spec build artifacts and use global dist folder ([c70d21e](https://github.com/ffMathy/hey-jarvis/commit/c70d21ebb2cafb1f6915489b3a6ca379e890a1ac))
* remove docker-package.json by using jq to modify package.json inline ([7168a81](https://github.com/ffMathy/hey-jarvis/commit/7168a811b4731987334e573aab5366d47e7f8c1a))
* resolve merge conflict in routing workflows formatting ([f87758b](https://github.com/ffMathy/hey-jarvis/commit/f87758b35c1ae06e054a051615eab5ed80ae42e0))
* resolve merge conflicts with main branch ([ea1145d](https://github.com/ffMathy/hey-jarvis/commit/ea1145d2ac9d500a592afe3f508d82bc6fbce4d8))
* revert unintentional formatting changes and remove cloudflared.deb ([aa47eaf](https://github.com/ffMathy/hey-jarvis/commit/aa47eafa733892a4663f76a9c888551d2d9591c6))

## [0.14.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.13.3...mcp-v0.14.0) (2025-11-28)


### Features

* add github_api_token to Home Assistant addon config ([b91aaa7](https://github.com/ffMathy/hey-jarvis/commit/b91aaa7d2e5b5ebdac711063282815a8c8225f06))
* add github_api_token to Home Assistant addon config ([#330](https://github.com/ffMathy/hey-jarvis/issues/330)) ([8adb6f3](https://github.com/ffMathy/hey-jarvis/commit/8adb6f30e1ea9633da8f2474fb833cacf4e974db))
* human in the loop ([#313](https://github.com/ffMathy/hey-jarvis/issues/313)) ([c047d6c](https://github.com/ffMathy/hey-jarvis/commit/c047d6cff761256ae38b9a26a8df1563f1b14678))
* introduce human in the loop ([9f1b714](https://github.com/ffMathy/hey-jarvis/commit/9f1b714a3786be2fc2858eeafeb22d08792339de))
* jarvis routing agent ([2a17251](https://github.com/ffMathy/hey-jarvis/commit/2a172514f4f43bd7e4a0f146d7f62b1ef28a0112))
* **mcp:** add agents option to routing agent for testing ([d6a2f38](https://github.com/ffMathy/hey-jarvis/commit/d6a2f38576e40e089fe555a18d694f7d293a4b4f))
* **mcp:** add async orchestration routing vertical ([#331](https://github.com/ffMathy/hey-jarvis/issues/331)) ([79d5c76](https://github.com/ffMathy/hey-jarvis/commit/79d5c76eea37b74a9fc195006f51d8885ac81c90))
* **mcp:** add async orchestration routing vertical with executePlan and getPlanResult tools ([8c1c9d8](https://github.com/ffMathy/hey-jarvis/commit/8c1c9d82e3f439221de17e9040928c8cd03f6756))


### Bug Fixes

* improve agents workflows ([ea7d4f8](https://github.com/ffMathy/hey-jarvis/commit/ea7d4f871afb85a93ef998becfe3437db8d0361d))
* improvements to agent handling ([3397a24](https://github.com/ffMathy/hey-jarvis/commit/3397a24ad672dea5ec6e7ee4f66e07cc77497b8c))
* **mcp:** fix commute tool review time type and skip flaky routing tests ([d4432cc](https://github.com/ffMathy/hey-jarvis/commit/d4432ccda50185cf2c0bb4dfb39f8330ae4f06cd))
* **mcp:** fix routing tests with generate() and maxSteps, add cloudflared to copilot setup ([a342d95](https://github.com/ffMathy/hey-jarvis/commit/a342d95e9c377f0dcb5708d9171d0422f7a6870c))
* **mcp:** include mcp/mastra tests in test runner ([242a4f3](https://github.com/ffMathy/hey-jarvis/commit/242a4f3cabe23effdf9de0394eb8af91166873b6))
* **mcp:** simplify network() call and improve routing agent prompt ([3b17023](https://github.com/ffMathy/hey-jarvis/commit/3b17023ffe653aa923498cc50149770af21518b1))
* **mcp:** use network() with proper stream consumption for routing agent ([19a1a47](https://github.com/ffMathy/hey-jarvis/commit/19a1a4718360c05f53c6192aa3e432a906811142))
* much better DAG ([4b3851d](https://github.com/ffMathy/hey-jarvis/commit/4b3851dd41b596b510a27d27d2052aca432075a9))

## [0.13.3](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.13.2...mcp-v0.13.3) (2025-11-24)


### Bug Fixes

* include commute in MCP ([e458480](https://github.com/ffMathy/hey-jarvis/commit/e458480ff2da87af7d2783332958f10af1e29973))
* include commute in MCP ([#311](https://github.com/ffMathy/hey-jarvis/issues/311)) ([7d5e712](https://github.com/ffMathy/hey-jarvis/commit/7d5e7126efd68c83c58c565f3f92249a303faa3e))

## [0.13.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.13.1...mcp-v0.13.2) (2025-11-24)


### Bug Fixes

* broken google key reference ([7930141](https://github.com/ffMathy/hey-jarvis/commit/7930141d881be8cd191f44f4132f702758ba3c0f))
* more google maps fixes ([189f9e8](https://github.com/ffMathy/hey-jarvis/commit/189f9e831022a9305012eb7cea605a4ad47446e9))
* more google maps fixes ([#309](https://github.com/ffMathy/hey-jarvis/issues/309)) ([1c9c1e2](https://github.com/ffMathy/hey-jarvis/commit/1c9c1e2803c1c12eac87ad61f64ac11ee2b6a02a))

## [0.13.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.13.0...mcp-v0.13.1) (2025-11-24)


### Bug Fixes

* improvements to commute agent ([54ca7c6](https://github.com/ffMathy/hey-jarvis/commit/54ca7c6590123d48d0a04bbc1aa6a5fe95eaeed3))
* improvements to commute agent ([#307](https://github.com/ffMathy/hey-jarvis/issues/307)) ([dcc0d84](https://github.com/ffMathy/hey-jarvis/commit/dcc0d841eccba1bdd2ec3b8d8ff92a679fffa058))

## [0.13.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.12.3...mcp-v0.13.0) (2025-11-24)


### Features

* add commute agent with Google Maps integration ([#297](https://github.com/ffMathy/hey-jarvis/issues/297)) ([32ae363](https://github.com/ffMathy/hey-jarvis/commit/32ae36385ffc8a853794e26bf71f4e06a7980ddc))
* **commute:** search at multiple route points and use geolib for distance calculation ([259d3e7](https://github.com/ffMathy/hey-jarvis/commit/259d3e7792ac71a9df71160b8acc1ce2266a4e97))


### Bug Fixes

* **commute:** improve null safety in distance comparison test ([48a1b96](https://github.com/ffMathy/hey-jarvis/commit/48a1b96c30cbd15d46748af7a35d7edfeb6f093c))
* **commute:** use proper PlaceResult type from Google Maps library ([3e8b86e](https://github.com/ffMathy/hey-jarvis/commit/3e8b86ea4e1aa99dd066403cbf2af2c127c5e146))

## [0.12.3](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.12.2...mcp-v0.12.3) (2025-11-23)


### Bug Fixes

* general stability improvements ([#295](https://github.com/ffMathy/hey-jarvis/issues/295)) ([0cec2f6](https://github.com/ffMathy/hey-jarvis/commit/0cec2f652c6244d68d407a36454bf35bee69d3e8))
* mcp tests now pass ([e0a9293](https://github.com/ffMathy/hey-jarvis/commit/e0a92930a7daf980b5274d2d566cc3f3ca13eddd))
* workflow scheduling fix ([6e1e5ed](https://github.com/ffMathy/hey-jarvis/commit/6e1e5ed8912b3ec39107d68c6846ebbd776295d0))

## [0.12.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.12.1...mcp-v0.12.2) (2025-11-23)


### Bug Fixes

* console log forwarding in Home Assistant addon using supervisord ([#289](https://github.com/ffMathy/hey-jarvis/issues/289)) ([bbaf18a](https://github.com/ffMathy/hey-jarvis/commit/bbaf18a1c588c95790127f0983b702be9192b58b))
* cooking fixes ([ff61f4b](https://github.com/ffMathy/hey-jarvis/commit/ff61f4b69784654a7af748567e125d8362a3ec3c))
* cooking fixes ([#294](https://github.com/ffMathy/hey-jarvis/issues/294)) ([24b1a50](https://github.com/ffMathy/hey-jarvis/commit/24b1a50584811d5466c7b300d87eeb5bf1c97320))
* don't allow tools for agent steps ([e9171a3](https://github.com/ffMathy/hey-jarvis/commit/e9171a31e4a605334c579102b6244ffb5fc00302))
* implement supervisord for console log forwarding in MCP addon ([d70020d](https://github.com/ffMathy/hey-jarvis/commit/d70020d756503d8393908ba43ca5c25fe51bde46))
* new tests and stability improvements ([#292](https://github.com/ffMathy/hey-jarvis/issues/292)) ([2abd311](https://github.com/ffMathy/hey-jarvis/commit/2abd311c2c4a2be3152d2a67281af9a7b3341916))

## [0.12.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.12.0...mcp-v0.12.1) (2025-11-23)


### Bug Fixes

* add p-map to ESM transformIgnorePatterns and fix server auto-start ([17d90b7](https://github.com/ffMathy/hey-jarvis/commit/17d90b76c5515e401caa77e3bc0be4da99b5ac8a))
* resolve ESM module issues in Jest and replace fkill ([1ae319d](https://github.com/ffMathy/hey-jarvis/commit/1ae319dc32c69173a4772cc733d3a6137b013b22))
* switch to Bun test, leverage Bun features, fix Docker timing race, and server auto-start ([#286](https://github.com/ffMathy/hey-jarvis/issues/286)) ([7f436fa](https://github.com/ffMathy/hey-jarvis/commit/7f436fa1481017f7dcd8a0b55b8cb029b78f04d5))

## [0.12.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.11.1...mcp-v0.12.0) (2025-11-22)


### Features

* add request logging middleware to MCP server ([79a42c0](https://github.com/ffMathy/hey-jarvis/commit/79a42c0dd869a71283e9e906d6566e9cab3c5854))
* add request logging middleware to MCP server ([#280](https://github.com/ffMathy/hey-jarvis/issues/280)) ([a1f5bf0](https://github.com/ffMathy/hey-jarvis/commit/a1f5bf02506c65fa88fafe325c4c4ba2ec4f59e6))


### Bug Fixes

* address code review feedback for request logging ([0e2a0aa](https://github.com/ffMathy/hey-jarvis/commit/0e2a0aa7f1265ce6509fdf1e3c80c93f1815167f))

## [0.11.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.11.0...mcp-v0.11.1) (2025-11-22)


### Bug Fixes

* **workflows:** wrap recipes array in object for meal plan validation ([26db98f](https://github.com/ffMathy/hey-jarvis/commit/26db98f924bf6cbf7e49de61a929f04c8ff0ce26))
* **workflows:** wrap recipes array in object for step input validation ([#278](https://github.com/ffMathy/hey-jarvis/issues/278)) ([b393089](https://github.com/ffMathy/hey-jarvis/commit/b39308950160c513f29220d4f14dac310aa148f5))

## [0.11.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.10.1...mcp-v0.11.0) (2025-11-22)


### Features

* send email on meal plan ([e9dd6e3](https://github.com/ffMathy/hey-jarvis/commit/e9dd6e34fd2d035e5b41ee84e3fb9ef949367b73))

## [0.10.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.10.0...mcp-v0.10.1) (2025-11-22)


### Bug Fixes

* workflow is now scheduled ([#274](https://github.com/ffMathy/hey-jarvis/issues/274)) ([78304e7](https://github.com/ffMathy/hey-jarvis/commit/78304e71a2177fcd88e73972d261f13a55ce2862))
* workflow name ([9f48fe7](https://github.com/ffMathy/hey-jarvis/commit/9f48fe710422cd49e9594a75989c9c69728de958))
* workflow scheduler fixed ([9bf07e7](https://github.com/ffMathy/hey-jarvis/commit/9bf07e79cd0ae7ee214ffeb9d2ce288c2b4e3304))

## [0.10.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.9.0...mcp-v0.10.0) (2025-11-22)


### Features

* proactive memory ([66aca12](https://github.com/ffMathy/hey-jarvis/commit/66aca12a7435ce6ea32a9772f840920f6c256480))
* proactive memory ([de41c44](https://github.com/ffMathy/hey-jarvis/commit/de41c448a000542120e84d3a32a97970979c8979))
* proactive memory ([be40bba](https://github.com/ffMathy/hey-jarvis/commit/be40bba6087c7d0cf871950c2229a7d176d6df39))
* synapse ([#273](https://github.com/ffMathy/hey-jarvis/issues/273)) ([594f170](https://github.com/ffMathy/hey-jarvis/commit/594f1708992ece6f9512339d9ada63a488c92888))


### Bug Fixes

* getting all devices works ([4afcd0b](https://github.com/ffMathy/hey-jarvis/commit/4afcd0b44e40d652d435d2d43658d31471f2d99c))
* getting all devices works ([eac5449](https://github.com/ffMathy/hey-jarvis/commit/eac5449164974c49681103083f311c8c831a355c))
* home assistant tools are working ([20e3ede](https://github.com/ffMathy/hey-jarvis/commit/20e3ededa9786b6b39af871bf49efc0dce3f9abb))
* home assistant tools are working ([e73a2bd](https://github.com/ffMathy/hey-jarvis/commit/e73a2bd028f479ac2f49975cdccc73699e975b2b))
* persistent storage across sessions ([d7d2140](https://github.com/ffMathy/hey-jarvis/commit/d7d2140915b8c3c2c3ded5d0a0226f0b796ea068))
* persistent storage across sessions ([37ef179](https://github.com/ffMathy/hey-jarvis/commit/37ef17921f1d27197d5ef915c5ecc11d13fc6a8c))
* store data in tmp directory by default ([7055373](https://github.com/ffMathy/hey-jarvis/commit/7055373fed205d166db38087773e08b79d62ee76))
* store data in tmp directory by default ([c422d60](https://github.com/ffMathy/hey-jarvis/commit/c422d60f7d1598af7c590e43a3485f42117036ff))

## [0.9.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.8.0...mcp-v0.9.0) (2025-11-22)


### Features

* support scheduled workflows ([8d9efc5](https://github.com/ffMathy/hey-jarvis/commit/8d9efc5ec0116efdc2b27630778b64cd238e5e6c))

## [0.8.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.7.0...mcp-v0.8.0) (2025-11-22)


### Features

* add support for refreshing oauth tokens ([7e692fd](https://github.com/ffMathy/hey-jarvis/commit/7e692fd4b04cb6c0f85cca2d65c7b5a5419b8f1d))
* improved token generation ([6234c52](https://github.com/ffMathy/hey-jarvis/commit/6234c5221d46f168cea005246a5b0ff2c974d15a))
* lots of new verticals and improvements ([dd5c04e](https://github.com/ffMathy/hey-jarvis/commit/dd5c04e67b88cd73a53c14510b122bf1dae5f195))


### Bug Fixes

* added missing environment variable references ([6b6cced](https://github.com/ffMathy/hey-jarvis/commit/6b6ccedf07c376799cb2d6adeac11531d5b0cc5b))
* better jwt integration ([d415819](https://github.com/ffMathy/hey-jarvis/commit/d415819c8fe7d7ccf1b1c6ad422ffb8002ca52fd))
* better logging ([7e898c8](https://github.com/ffMathy/hey-jarvis/commit/7e898c86d6f735a130f7ade9f995a17f42a61a21))
* better stability for some projects ([33f8cf2](https://github.com/ffMathy/hey-jarvis/commit/33f8cf29daea5354090264d9b04974eafb3233be))
* better targets ([45f9994](https://github.com/ffMathy/hey-jarvis/commit/45f999493d71a372423b9556e2aa2d31d6850b5a))
* better tests ([52407ff](https://github.com/ffMathy/hey-jarvis/commit/52407ffbdb8d711610ae907602c67fd835134938))
* improved logging ([dc8e125](https://github.com/ffMathy/hey-jarvis/commit/dc8e125e52906dae45962bad4f6483f397f2bb04))
* kill ports ([55c415e](https://github.com/ffMathy/hey-jarvis/commit/55c415ee47ba6531eeec748bcbd2083d651afb9d))
* much better tests ([4f8bb0d](https://github.com/ffMathy/hey-jarvis/commit/4f8bb0dda96ab53fd6f695380ec25d0034f8e318))
* mute logging ([ac6aaf7](https://github.com/ffMathy/hey-jarvis/commit/ac6aaf72af4928e0650ecad2876988e16bf011c7))
* new progress on verticals ([4a5323f](https://github.com/ffMathy/hey-jarvis/commit/4a5323fe875aba3d0bb0cbef495ff926fca495a1))
* test suite stability ([7532fd2](https://github.com/ffMathy/hey-jarvis/commit/7532fd286ce1f17cc8df8a9abfd0d364dff559e8))
* tests now use proper imports ([9f1f909](https://github.com/ffMathy/hey-jarvis/commit/9f1f909c0ab283c1adfb2501d069cd850fb97b9a))
* token issues ([e0fc2a9](https://github.com/ffMathy/hey-jarvis/commit/e0fc2a93126a0574f1d5880cd4d60d7310d7041a))


### Performance Improvements

* introduce force exit to tests ([5caf436](https://github.com/ffMathy/hey-jarvis/commit/5caf436d9a6dc05fc079bae0ae1f030ee5c2f3db))

## [0.7.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.6.0...mcp-v0.7.0) (2025-11-20)


### Features

* update dependencies and enhance ElevenLabs conversation strategy ([#261](https://github.com/ffMathy/hey-jarvis/issues/261)) ([59bb4b2](https://github.com/ffMathy/hey-jarvis/commit/59bb4b298723a96dc59bda67fd0c7aee1cce8a4b))

## [0.6.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.5.0...mcp-v0.6.0) (2025-11-20)


### Features

* much better coding agent ([#259](https://github.com/ffMathy/hey-jarvis/issues/259)) ([5477b1f](https://github.com/ffMathy/hey-jarvis/commit/5477b1f312cbf568952dc89dbf46c2291e7df25a))

## [0.5.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.4.4...mcp-v0.5.0) (2025-11-20)


### Features

* enhance 1Password authentication and terminal session managemen… ([#251](https://github.com/ffMathy/hey-jarvis/issues/251)) ([ec808be](https://github.com/ffMathy/hey-jarvis/commit/ec808be26efb82d0b4d491ea367f4f1f6eecacd8))

## [0.4.4](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.4.3...mcp-v0.4.4) (2025-11-20)


### Bug Fixes

* shopping list broken ([#249](https://github.com/ffMathy/hey-jarvis/issues/249)) ([43da7b6](https://github.com/ffMathy/hey-jarvis/commit/43da7b6c12d1eec9ef60f8570a239c7ab23983e0))

## [0.4.3](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.4.2...mcp-v0.4.3) (2025-11-20)


### Bug Fixes

* error reporting ([#247](https://github.com/ffMathy/hey-jarvis/issues/247)) ([0329160](https://github.com/ffMathy/hey-jarvis/commit/0329160cb6ce3ba700f1e424a65c8cc6a6503721))

## [0.4.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.4.1...mcp-v0.4.2) (2025-11-20)


### Bug Fixes

* **tools:** standardize tool IDs to camelCase and update execution pa… ([#245](https://github.com/ffMathy/hey-jarvis/issues/245)) ([bd3c930](https://github.com/ffMathy/hey-jarvis/commit/bd3c930db0834a430aee2a4a98494629480fd5ac))

## [0.4.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.4.0...mcp-v0.4.1) (2025-11-20)


### Bug Fixes

* **agent-config:** update silence end call timeout ([#238](https://github.com/ffMathy/hey-jarvis/issues/238)) ([2d2d4e9](https://github.com/ffMathy/hey-jarvis/commit/2d2d4e9d34379df48817cd4fb39fb11b3408855a))

## [0.4.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.3.0...mcp-v0.4.0) (2025-11-19)


### Features

* **error-handling:** add async error reporting processor with Mastra PIIDetector ([#234](https://github.com/ffMathy/hey-jarvis/issues/234)) ([28f7e31](https://github.com/ffMathy/hey-jarvis/commit/28f7e31af9edb6eff6554d1262210bf9909c9ee5))


### Bug Fixes

* **env:** update GitHub API token reference in op.env ([#236](https://github.com/ffMathy/hey-jarvis/issues/236)) ([d841ea7](https://github.com/ffMathy/hey-jarvis/commit/d841ea787ce385c027117c4c6e2b12157ee695ea))

## [0.3.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.2.0...mcp-v0.3.0) (2025-11-19)


### Features

* **home-assistant-addon:** allow JWT tokens without expiry claim ([#232](https://github.com/ffMathy/hey-jarvis/issues/232)) ([fea7c94](https://github.com/ffMathy/hey-jarvis/commit/fea7c94e0f0ade3829a1962c9a65f1c9770f6319))

## [0.2.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.1.2...mcp-v0.2.0) (2025-11-19)


### Features

* **home-assistant-addon:** add nginx-based JWT authentication for MCP server ([#230](https://github.com/ffMathy/hey-jarvis/issues/230)) ([4e35f06](https://github.com/ffMathy/hey-jarvis/commit/4e35f06aa08c264f8fdf83f9be2db5c2e1959bcd))

## [0.1.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.1.1...mcp-v0.1.2) (2025-11-18)


### Bug Fixes

* **mcp:** add error handling for server startup failures in run.sh ([#228](https://github.com/ffMathy/hey-jarvis/issues/228)) ([963f647](https://github.com/ffMathy/hey-jarvis/commit/963f64799d1a6169c9ba325227b8a41933a9a510))

## [0.1.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v0.1.0...mcp-v0.1.1) (2025-11-18)


### Bug Fixes

* **mcp:** use bunx for mastra CLI in Docker startup script ([#226](https://github.com/ffMathy/hey-jarvis/issues/226)) ([cc5a924](https://github.com/ffMathy/hey-jarvis/commit/cc5a92412361b194f32c73fa32f877260cfad370))

## 0.1.0 (2025-11-18)


### Features

* add shared functions to start MCP servers ([#222](https://github.com/ffMathy/hey-jarvis/issues/222)) ([8cfd97d](https://github.com/ffMathy/hey-jarvis/commit/8cfd97d1d83443d52af2ef232c69ebc45f8d82db))
* infer Zod types from Octokit, add auth, defaults, and fix tool descriptions ([fb6e61c](https://github.com/ffMathy/hey-jarvis/commit/fb6e61c1dee74326d67e0bbdfd5c12fcc62d3375))
* migrate from deprecated telemetry to AI Tracing and re-enable scorers ([734323e](https://github.com/ffMathy/hey-jarvis/commit/734323ef030ad5eb6a99aa4cd84c91a6499c691b))
* migrate from NPM to Bun for package management ([5455985](https://github.com/ffMathy/hey-jarvis/commit/54559850929c9dc36fbada4661dede0336cafa6d))
* **notification:** add proactive notification workflow with ElevenLabs integration ([c620f2e](https://github.com/ffMathy/hey-jarvis/commit/c620f2ec000c289bc0e8a207b47607cec9a44231))
* optimize Docker images with Alpine base and multi-stage builds ([c616e78](https://github.com/ffMathy/hey-jarvis/commit/c616e7895b3ac4123dade49c2f82f27bedab8fcc))


### Bug Fixes

* 1password reference ([6789255](https://github.com/ffMathy/hey-jarvis/commit/6789255072b00a07b2328f65bfce8d1c848ebbed))
* added node options ([47f2421](https://github.com/ffMathy/hey-jarvis/commit/47f242179c5555e84dd8a9d921cfb169a91357c6))
* always test via gemini ([60f5c38](https://github.com/ffMathy/hey-jarvis/commit/60f5c389228a2acd17f79b894b07e98eccc57a7c))
* better compile ([8d35b4b](https://github.com/ffMathy/hey-jarvis/commit/8d35b4b8b78337acb425c88a8eb3671c060e0e65))
* better paths ([c756779](https://github.com/ffMathy/hey-jarvis/commit/c7567799bfd4b8bc9ab9044c67471f5432562714))
* better tests ([d72459f](https://github.com/ffMathy/hey-jarvis/commit/d72459f73189f68e864dd093736fc4326a28c798))
* better tests ([3c389ef](https://github.com/ffMathy/hey-jarvis/commit/3c389ef3df7eb1f83eacc896a8795ab700690864))
* better tests ([716b97c](https://github.com/ffMathy/hey-jarvis/commit/716b97c6d28fd97b1ae0fa91561f801ac9af8f6e))
* comment out scorers temporarily ([339456d](https://github.com/ffMathy/hey-jarvis/commit/339456d351f67af873334dde00254e292147e098))
* dockerfile now works ([80db15b](https://github.com/ffMathy/hey-jarvis/commit/80db15b936a7bf21fae40ba3120b240893466c9c))
* jarvis tests around prompt ([a955c1e](https://github.com/ffMathy/hey-jarvis/commit/a955c1e0533b7e8a209f2114d5c7fa7cd547958e))
* linting ([a38893e](https://github.com/ffMathy/hey-jarvis/commit/a38893eb882255347b96a6123b910d67fbce7b18))
* make scorer initialization lazy to prevent build-time failures ([d8d0a60](https://github.com/ffMathy/hey-jarvis/commit/d8d0a60cf3831c71c6ae189dc6d3c02fcff391c0))
* **mcp:** correct Dockerfile path for run.sh script ([b82aa1f](https://github.com/ffMathy/hey-jarvis/commit/b82aa1fff72ed11c4cbb4845e7715a29f0866bd0))
* **mcp:** correct notification workflow branch syntax ([77c9145](https://github.com/ffMathy/hey-jarvis/commit/77c91459f1adc6cacae6c4f013da8010da0ce7be))
* **mcp:** replace DEFAULT_SCORERS with getDefaultScorers() function call ([d99614b](https://github.com/ffMathy/hey-jarvis/commit/d99614bb8beed0b42894bb9830e38c41accbc485))
* progress on stability and tests ([082660f](https://github.com/ffMathy/hey-jarvis/commit/082660f8b5bd0db869ef0d4ece56bc01eee5eb54))
* remove input and output processors to avoid issues ([#164](https://github.com/ffMathy/hey-jarvis/issues/164)) ([3e98fa1](https://github.com/ffMathy/hey-jarvis/commit/3e98fa1bd7258b95d0c44bfdb0ba37b435ca98fa))
* replace npx tsx with bun run for MCP server startup in container ([#189](https://github.com/ffMathy/hey-jarvis/issues/189)) ([847bb22](https://github.com/ffMathy/hey-jarvis/commit/847bb22f2f24f3b4a77213f131570498a021a2be))
* resolve Jest test failures by compiling TypeScript first with esbuild ([#162](https://github.com/ffMathy/hey-jarvis/issues/162)) ([d0ec7bf](https://github.com/ffMathy/hey-jarvis/commit/d0ec7bfd3a27014874585ed9f7bd9089cb98a839))
* serve now works ([24bc1f7](https://github.com/ffMathy/hey-jarvis/commit/24bc1f725492ff5034e62eb145de166b34832e18))
* support weather API ([0c4a3e0](https://github.com/ffMathy/hey-jarvis/commit/0c4a3e0c1f8b1700a017da8835ece1a7d418f9fc))
* test performance ([d8935de](https://github.com/ffMathy/hey-jarvis/commit/d8935de6f94754476dcf89849704513dcb048b64))
* tests improved ([75933a1](https://github.com/ffMathy/hey-jarvis/commit/75933a12e5e1d926d0251871c964dc727240525f))
* update tsconfig to be ESM based ([3e6fa9a](https://github.com/ffMathy/hey-jarvis/commit/3e6fa9add9a9da0c5bf15dacea2ebd72e0a98990))

## [4.0.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v4.0.0...mcp-v4.0.1) (2025-11-14)


### Bug Fixes

* replace npx tsx with bun run for MCP server startup in container ([#189](https://github.com/ffMathy/hey-jarvis/issues/189)) ([847bb22](https://github.com/ffMathy/hey-jarvis/commit/847bb22f2f24f3b4a77213f131570498a021a2be))

## [4.0.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v3.2.0...mcp-v4.0.0) (2025-11-13)


### Features

* infer Zod types from Octokit, add auth, defaults, and fix tool descriptions ([fb6e61c](https://github.com/ffMathy/hey-jarvis/commit/fb6e61c1dee74326d67e0bbdfd5c12fcc62d3375))
* migrate from deprecated telemetry to AI Tracing and re-enable scorers ([734323e](https://github.com/ffMathy/hey-jarvis/commit/734323ef030ad5eb6a99aa4cd84c91a6499c691b))
* migrate from NPM to Bun for package management ([5455985](https://github.com/ffMathy/hey-jarvis/commit/54559850929c9dc36fbada4661dede0336cafa6d))
* **notification:** add proactive notification workflow with ElevenLabs integration ([c620f2e](https://github.com/ffMathy/hey-jarvis/commit/c620f2ec000c289bc0e8a207b47607cec9a44231))
* optimize Docker images with Alpine base and multi-stage builds ([c616e78](https://github.com/ffMathy/hey-jarvis/commit/c616e7895b3ac4123dade49c2f82f27bedab8fcc))


### Bug Fixes

* 1password reference ([6789255](https://github.com/ffMathy/hey-jarvis/commit/6789255072b00a07b2328f65bfce8d1c848ebbed))
* added node options ([47f2421](https://github.com/ffMathy/hey-jarvis/commit/47f242179c5555e84dd8a9d921cfb169a91357c6))
* always test via gemini ([60f5c38](https://github.com/ffMathy/hey-jarvis/commit/60f5c389228a2acd17f79b894b07e98eccc57a7c))
* better compile ([8d35b4b](https://github.com/ffMathy/hey-jarvis/commit/8d35b4b8b78337acb425c88a8eb3671c060e0e65))
* better paths ([c756779](https://github.com/ffMathy/hey-jarvis/commit/c7567799bfd4b8bc9ab9044c67471f5432562714))
* better tests ([d72459f](https://github.com/ffMathy/hey-jarvis/commit/d72459f73189f68e864dd093736fc4326a28c798))
* better tests ([3c389ef](https://github.com/ffMathy/hey-jarvis/commit/3c389ef3df7eb1f83eacc896a8795ab700690864))
* better tests ([716b97c](https://github.com/ffMathy/hey-jarvis/commit/716b97c6d28fd97b1ae0fa91561f801ac9af8f6e))
* comment out scorers temporarily ([339456d](https://github.com/ffMathy/hey-jarvis/commit/339456d351f67af873334dde00254e292147e098))
* dockerfile now works ([80db15b](https://github.com/ffMathy/hey-jarvis/commit/80db15b936a7bf21fae40ba3120b240893466c9c))
* jarvis tests around prompt ([a955c1e](https://github.com/ffMathy/hey-jarvis/commit/a955c1e0533b7e8a209f2114d5c7fa7cd547958e))
* linting ([a38893e](https://github.com/ffMathy/hey-jarvis/commit/a38893eb882255347b96a6123b910d67fbce7b18))
* make scorer initialization lazy to prevent build-time failures ([d8d0a60](https://github.com/ffMathy/hey-jarvis/commit/d8d0a60cf3831c71c6ae189dc6d3c02fcff391c0))
* **mcp:** correct Dockerfile path for run.sh script ([b82aa1f](https://github.com/ffMathy/hey-jarvis/commit/b82aa1fff72ed11c4cbb4845e7715a29f0866bd0))
* **mcp:** correct notification workflow branch syntax ([77c9145](https://github.com/ffMathy/hey-jarvis/commit/77c91459f1adc6cacae6c4f013da8010da0ce7be))
* **mcp:** replace DEFAULT_SCORERS with getDefaultScorers() function call ([d99614b](https://github.com/ffMathy/hey-jarvis/commit/d99614bb8beed0b42894bb9830e38c41accbc485))
* progress on stability and tests ([082660f](https://github.com/ffMathy/hey-jarvis/commit/082660f8b5bd0db869ef0d4ece56bc01eee5eb54))
* remove input and output processors to avoid issues ([#164](https://github.com/ffMathy/hey-jarvis/issues/164)) ([3e98fa1](https://github.com/ffMathy/hey-jarvis/commit/3e98fa1bd7258b95d0c44bfdb0ba37b435ca98fa))
* resolve Jest test failures by compiling TypeScript first with esbuild ([#162](https://github.com/ffMathy/hey-jarvis/issues/162)) ([d0ec7bf](https://github.com/ffMathy/hey-jarvis/commit/d0ec7bfd3a27014874585ed9f7bd9089cb98a839))
* serve now works ([24bc1f7](https://github.com/ffMathy/hey-jarvis/commit/24bc1f725492ff5034e62eb145de166b34832e18))
* support weather API ([0c4a3e0](https://github.com/ffMathy/hey-jarvis/commit/0c4a3e0c1f8b1700a017da8835ece1a7d418f9fc))
* test performance ([d8935de](https://github.com/ffMathy/hey-jarvis/commit/d8935de6f94754476dcf89849704513dcb048b64))
* tests improved ([75933a1](https://github.com/ffMathy/hey-jarvis/commit/75933a12e5e1d926d0251871c964dc727240525f))
* update tsconfig to be ESM based ([3e6fa9a](https://github.com/ffMathy/hey-jarvis/commit/3e6fa9add9a9da0c5bf15dacea2ebd72e0a98990))

## [3.2.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v3.1.0...mcp-v3.2.0) (2025-11-08)


### Features

* migrate from deprecated telemetry to AI Tracing and re-enable scorers ([a27fe14](https://github.com/ffMathy/hey-jarvis/commit/a27fe14af5cb945143234ba6955843bc329b560b))


### Bug Fixes

* make scorer initialization lazy to prevent build-time failures ([825501c](https://github.com/ffMathy/hey-jarvis/commit/825501c10c44024242fd28e7db5877f946d46afe))

## [3.1.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v3.0.5...mcp-v3.1.0) (2025-11-07)


### Bug Fixes

* 1password reference ([753e907](https://github.com/ffMathy/hey-jarvis/commit/753e907dacc4a02227e4c9c73731ddb8ed8de38d))
* better paths ([b461d2b](https://github.com/ffMathy/hey-jarvis/commit/b461d2b1bbb08f01d1b3f8ac6ee09015667678a2))
* better tests ([6ecd247](https://github.com/ffMathy/hey-jarvis/commit/6ecd24790feae7bbd6d0970c0f19e7632fc1a607))
* better tests ([146846f](https://github.com/ffMathy/hey-jarvis/commit/146846fb34f820f30a02ff4d39020683eff1c36f))
* better tests ([c3f1b29](https://github.com/ffMathy/hey-jarvis/commit/c3f1b29aa4570e4b9c689e9ae12334058f6b91f2))
* **mcp:** correct Dockerfile path for run.sh script ([0e31be6](https://github.com/ffMathy/hey-jarvis/commit/0e31be6b59aaee116dc05fb0dfc6fd233d4005ac))
* playwright installation ([8f2197e](https://github.com/ffMathy/hey-jarvis/commit/8f2197e475226452b016bbe5d7ca168f29ea4c48))
* test performance ([ec3910d](https://github.com/ffMathy/hey-jarvis/commit/ec3910d7e3c2e89ccaaa10e9194dfcc48f8f795a))

## [3.0.5](https://github.com/ffMathy/hey-jarvis/compare/mcp-v3.0.4...mcp-v3.0.5) (2025-11-06)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [3.0.4](https://github.com/ffMathy/hey-jarvis/compare/mcp-v3.0.3...mcp-v3.0.4) (2025-11-06)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [3.0.3](https://github.com/ffMathy/hey-jarvis/compare/mcp-v3.0.2...mcp-v3.0.3) (2025-11-06)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [3.0.2](https://github.com/ffMathy/hey-jarvis/compare/mcp-v3.0.1...mcp-v3.0.2) (2025-11-06)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [3.0.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v3.0.0...mcp-v3.0.1) (2025-11-06)


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

## [3.0.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v2.0.0...mcp-v3.0.0) (2025-11-06)


### Features

* infer Zod types from Octokit, add auth, defaults, and fix tool descriptions ([951f343](https://github.com/ffMathy/hey-jarvis/commit/951f3434365c6b2a9790e03834859e72e510320f))


### Bug Fixes

* added node options ([31c990a](https://github.com/ffMathy/hey-jarvis/commit/31c990aa5660a82ce0266647ad2321b01cf9c259))
* always test via gemini ([e726be9](https://github.com/ffMathy/hey-jarvis/commit/e726be9071efdf41c858d1e6766d698bd49bc7ed))
* better compile ([703234d](https://github.com/ffMathy/hey-jarvis/commit/703234d880a82482c306805f7df2b7dae0c1388f))
* comment out scorers temporarily ([b239987](https://github.com/ffMathy/hey-jarvis/commit/b239987a932e363bebfff76bc25cf81a40cb6a23))
* dockerfile now works ([630fc68](https://github.com/ffMathy/hey-jarvis/commit/630fc689598fca2e4e1e135f39a93e330ab9e299))
* jarvis tests around prompt ([db1ff1e](https://github.com/ffMathy/hey-jarvis/commit/db1ff1e62ff18bd18535f11260e2aa3d7b7b48f4))
* linting ([ca38675](https://github.com/ffMathy/hey-jarvis/commit/ca38675952473e5be69d7583a881dcb147357d26))
* progress on stability and tests ([0692649](https://github.com/ffMathy/hey-jarvis/commit/069264952fd76864a39da98d55bf64d1c36b5eba))
* serve now works ([a906895](https://github.com/ffMathy/hey-jarvis/commit/a906895dfc5574a59add7ac7cfc16794beab524b))
* support weather API ([9d7ad5b](https://github.com/ffMathy/hey-jarvis/commit/9d7ad5b8cc6d5dc030076243ab07e54deba65fa0))
* tests improved ([fef11d4](https://github.com/ffMathy/hey-jarvis/commit/fef11d4953112c80728ab89012b6e1f50e3d5440))
* update tsconfig to be ESM based ([8f758e8](https://github.com/ffMathy/hey-jarvis/commit/8f758e80d77f801fe95dc30dcd661d90bbbb5e1d))

## [2.0.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.2.0...mcp-v2.0.0) (2025-11-06)


### Features

* infer Zod types from Octokit, add auth, defaults, and fix tool descriptions ([951f343](https://github.com/ffMathy/hey-jarvis/commit/951f3434365c6b2a9790e03834859e72e510320f))


### Bug Fixes

* added node options ([31c990a](https://github.com/ffMathy/hey-jarvis/commit/31c990aa5660a82ce0266647ad2321b01cf9c259))
* always test via gemini ([e726be9](https://github.com/ffMathy/hey-jarvis/commit/e726be9071efdf41c858d1e6766d698bd49bc7ed))
* better compile ([703234d](https://github.com/ffMathy/hey-jarvis/commit/703234d880a82482c306805f7df2b7dae0c1388f))
* comment out scorers temporarily ([b239987](https://github.com/ffMathy/hey-jarvis/commit/b239987a932e363bebfff76bc25cf81a40cb6a23))
* dockerfile now works ([630fc68](https://github.com/ffMathy/hey-jarvis/commit/630fc689598fca2e4e1e135f39a93e330ab9e299))
* jarvis tests around prompt ([db1ff1e](https://github.com/ffMathy/hey-jarvis/commit/db1ff1e62ff18bd18535f11260e2aa3d7b7b48f4))
* linting ([ca38675](https://github.com/ffMathy/hey-jarvis/commit/ca38675952473e5be69d7583a881dcb147357d26))
* progress on stability and tests ([0692649](https://github.com/ffMathy/hey-jarvis/commit/069264952fd76864a39da98d55bf64d1c36b5eba))
* serve now works ([a906895](https://github.com/ffMathy/hey-jarvis/commit/a906895dfc5574a59add7ac7cfc16794beab524b))
* support weather API ([9d7ad5b](https://github.com/ffMathy/hey-jarvis/commit/9d7ad5b8cc6d5dc030076243ab07e54deba65fa0))
* tests improved ([fef11d4](https://github.com/ffMathy/hey-jarvis/commit/fef11d4953112c80728ab89012b6e1f50e3d5440))
* update tsconfig to be ESM based ([8f758e8](https://github.com/ffMathy/hey-jarvis/commit/8f758e80d77f801fe95dc30dcd661d90bbbb5e1d))

## [1.2.0](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.1...mcp-v1.2.0) (2025-11-06)


### Features

* infer Zod types from Octokit, add auth, defaults, and fix tool descriptions ([951f343](https://github.com/ffMathy/hey-jarvis/commit/951f3434365c6b2a9790e03834859e72e510320f))

## [1.1.1](https://github.com/ffMathy/hey-jarvis/compare/mcp-v1.1.0...mcp-v1.1.1) (2025-11-05)


### Bug Fixes

* added node options ([31c990a](https://github.com/ffMathy/hey-jarvis/commit/31c990aa5660a82ce0266647ad2321b01cf9c259))
* always test via gemini ([e726be9](https://github.com/ffMathy/hey-jarvis/commit/e726be9071efdf41c858d1e6766d698bd49bc7ed))
* better compile ([703234d](https://github.com/ffMathy/hey-jarvis/commit/703234d880a82482c306805f7df2b7dae0c1388f))
* comment out scorers temporarily ([b239987](https://github.com/ffMathy/hey-jarvis/commit/b239987a932e363bebfff76bc25cf81a40cb6a23))
* dockerfile now works ([630fc68](https://github.com/ffMathy/hey-jarvis/commit/630fc689598fca2e4e1e135f39a93e330ab9e299))
* jarvis tests around prompt ([db1ff1e](https://github.com/ffMathy/hey-jarvis/commit/db1ff1e62ff18bd18535f11260e2aa3d7b7b48f4))
* linting ([ca38675](https://github.com/ffMathy/hey-jarvis/commit/ca38675952473e5be69d7583a881dcb147357d26))
* progress on stability and tests ([0692649](https://github.com/ffMathy/hey-jarvis/commit/069264952fd76864a39da98d55bf64d1c36b5eba))
* serve now works ([a906895](https://github.com/ffMathy/hey-jarvis/commit/a906895dfc5574a59add7ac7cfc16794beab524b))
* support weather API ([9d7ad5b](https://github.com/ffMathy/hey-jarvis/commit/9d7ad5b8cc6d5dc030076243ab07e54deba65fa0))
* tests improved ([fef11d4](https://github.com/ffMathy/hey-jarvis/commit/fef11d4953112c80728ab89012b6e1f50e3d5440))
* update tsconfig to be ESM based ([8f758e8](https://github.com/ffMathy/hey-jarvis/commit/8f758e80d77f801fe95dc30dcd661d90bbbb5e1d))

## [1.1.0](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v1.0.3...jarvis-mcp-v1.1.0) (2025-10-14)


### Miscellaneous Chores

* **jarvis-mcp:** Synchronize jarvis-mcp versions

## [1.0.3](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v1.0.2...jarvis-mcp-v1.0.3) (2025-10-14)


### Bug Fixes

* ARM64 runtime error in Home Assistant by replacing Fastembed with Gemini embeddings ([#61](https://github.com/ffMathy/hey-jarvis/issues/61)) ([e0fc3c0](https://github.com/ffMathy/hey-jarvis/commit/e0fc3c0255fe38ef817083f4792de0a612f3a60a))

## [1.0.2](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v1.0.1...jarvis-mcp-v1.0.2) (2025-10-14)


### Bug Fixes

* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([b1029ed](https://github.com/ffMathy/hey-jarvis/commit/b1029ed0d19222d5a98befe513ba474a9b518c13))

## [1.0.1](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v1.0.0...jarvis-mcp-v1.0.1) (2025-10-07)


### Bug Fixes

* top-level await error preventing Home Assistant addon from starting ([#54](https://github.com/ffMathy/hey-jarvis/issues/54)) ([a78b5b3](https://github.com/ffMathy/hey-jarvis/commit/a78b5b3d3c025d868882fbfd3dba03a45e96b279))

## [1.0.0](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.3.5...jarvis-mcp-v1.0.0) (2025-10-04)


### ⚠ BREAKING CHANGES

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51))

### Bug Fixes

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51)) ([0190cc9](https://github.com/ffMathy/hey-jarvis/commit/0190cc9332ff27a79d7dc34ca0f26539cb5a3b48))

## [0.3.5](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.3.4...jarvis-mcp-v0.3.5) (2025-10-04)


### Bug Fixes

* architecture building ([#49](https://github.com/ffMathy/hey-jarvis/issues/49)) ([151a490](https://github.com/ffMathy/hey-jarvis/commit/151a49053e44296eb0bf28df4e0723eda87e9e11))

## [0.3.4](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.3.3...jarvis-mcp-v0.3.4) (2025-10-02)


### Bug Fixes

* remove invalid package.json ([#47](https://github.com/ffMathy/hey-jarvis/issues/47)) ([0ee44c0](https://github.com/ffMathy/hey-jarvis/commit/0ee44c0d52cb562af03ffa74ebd70943a78ee620))

## [0.3.3](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.3.2...jarvis-mcp-v0.3.3) (2025-10-02)

## [0.3.2](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.3.1...jarvis-mcp-v0.3.2) (2025-10-02)


### Bug Fixes

* don't import instrumentation ([#42](https://github.com/ffMathy/hey-jarvis/issues/42)) ([619bfb7](https://github.com/ffMathy/hey-jarvis/commit/619bfb73c6f10eef24f92baa476e5355c6a48842))

## [0.3.1](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.3.0...jarvis-mcp-v0.3.1) (2025-10-02)


### Bug Fixes

* multi architecture builds ([#38](https://github.com/ffMathy/hey-jarvis/issues/38)) ([7d1237f](https://github.com/ffMathy/hey-jarvis/commit/7d1237fd23bf389a290ceab3160e74cf67786399))

## [0.3.0](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.2.3...jarvis-mcp-v0.3.0) (2025-10-02)


### Features

* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))

## [0.2.3](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.2.2...jarvis-mcp-v0.2.3) (2025-10-01)


### Bug Fixes

* better env parsing ([#33](https://github.com/ffMathy/hey-jarvis/issues/33)) ([3d5565f](https://github.com/ffMathy/hey-jarvis/commit/3d5565fc030af3669124c3394d091fb70001fcc9))

## [0.2.2](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.2.1...jarvis-mcp-v0.2.2) (2025-09-30)


### Bug Fixes

* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))

## [0.2.1](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.2.0...jarvis-mcp-v0.2.1) (2025-09-30)


### Bug Fixes

* only use 1Password when env is missing ([7e79df3](https://github.com/ffMathy/hey-jarvis/commit/7e79df353840222f401f87976e34cf03a450029a))

## [0.2.0](https://github.com/ffMathy/hey-jarvis/compare/jarvis-mcp-v0.1.0...jarvis-mcp-v0.2.0) (2025-09-30)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* add new project and deploy pipeline ([857dd8a](https://github.com/ffMathy/hey-jarvis/commit/857dd8a7290100f31984d7a94fd822f85f2a1987))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* initial n8n agent converted to mastra ([942c7d2](https://github.com/ffMathy/hey-jarvis/commit/942c7d23a7d6118c960fcbf5f343d1ffc9fa5de2))
* introduce mastra AI for jarvis-mcp ([d4dfca4](https://github.com/ffMathy/hey-jarvis/commit/d4dfca46d82ef3296273121b40930e8795354f46))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))
* n8n weather agent ([6b62e05](https://github.com/ffMathy/hey-jarvis/commit/6b62e05734179923efba6fbccfa21a9c395652f0))
* scorers added ([318e63f](https://github.com/ffMathy/hey-jarvis/commit/318e63f36ac422f99d7c456e632f72cc7dc2bd12))
* weather agent ([f82bc31](https://github.com/ffMathy/hey-jarvis/commit/f82bc31807a33dbd03a18babbe9bd56e25e9762a))
* weather agent in Mastra ([f61e5ba](https://github.com/ffMathy/hey-jarvis/commit/f61e5baa2b023084fc1d61ae59b683099c5ed928))


### Bug Fixes

* add missing package.json ([8114f0d](https://github.com/ffMathy/hey-jarvis/commit/8114f0d2a2aba5dbcf3d9cb87233182f6fbf2abc))
* added search functionality ([8a2b357](https://github.com/ffMathy/hey-jarvis/commit/8a2b3576ff9ccba7c02551f432bd8997e3943a7d))
* attempt at variable substitution ([7f3cbce](https://github.com/ffMathy/hey-jarvis/commit/7f3cbcebec69a3a322e2d1edf655e3252dd95b64))
* bilka auth now works ([fdc147b](https://github.com/ffMathy/hey-jarvis/commit/fdc147bdb2a4b22f1e5e316fef1c66d9a74413f0))
* compile issues ([77002e9](https://github.com/ffMathy/hey-jarvis/commit/77002e9fff50427ff43d16ecc2fb3bb72ac3c766))
* delete superfluous file ([70c0507](https://github.com/ffMathy/hey-jarvis/commit/70c0507b29a73057879983a12e72c066c2def1c5))
* don't include scorers for certain things ([1dbb9c7](https://github.com/ffMathy/hey-jarvis/commit/1dbb9c7b6f6dd38e02e5b43233ba04cb1848cfa3))
* don't mask environment variables ([b5e6149](https://github.com/ffMathy/hey-jarvis/commit/b5e61494745cd4a5d8915b8afa3658492444d018))
* increase amount of results fetched ([641823b](https://github.com/ffMathy/hey-jarvis/commit/641823b0801f79dc8f674a8581f7634a14d666a9))
* remove another changelog ([6b51ede](https://github.com/ffMathy/hey-jarvis/commit/6b51ede9f9b4979ff127379e67c90c27147ff02f))
* shopping list flow has been solved ([ef3ad26](https://github.com/ffMathy/hey-jarvis/commit/ef3ad2649f5f045294382e9460bf7a305c858eef))
* variable substitution via env option ([db9ed73](https://github.com/ffMathy/hey-jarvis/commit/db9ed734ce8289056b717df63a4fd33523595b5b))
