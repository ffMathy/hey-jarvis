# Changelog


### Miscellaneous Chores

* **mcp:** Synchronize mcp versions

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
