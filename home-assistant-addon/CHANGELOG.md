# Changelog

## [1.3.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.3.0...home-assistant-addon-v1.3.1) (2026-01-11)


### Bug Fixes

* **home-assistant-addon:** consolidate to 2 ports, remove port 8113 ([0f04782](https://github.com/ffMathy/hey-jarvis/commit/0f04782c0af1b4afe96da772c7500ccd097a46be))
* **mcp:** consolidate to 2-port architecture and fix health checks ([#461](https://github.com/ffMathy/hey-jarvis/issues/461)) ([f77ac6b](https://github.com/ffMathy/hey-jarvis/commit/f77ac6be29069da5663486f5629364d67e0369d2))
* **mcp:** correct health check to use internal ports ([8c0137c](https://github.com/ffMathy/hey-jarvis/commit/8c0137cfd62479727b9d8e5d04299d343cf58032))

## [1.3.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.2.3...home-assistant-addon-v1.3.0) (2026-01-10)


### Features

* **home-assistant-addon:** add nginx proxy timeout and retry settings ([acf2c8f](https://github.com/ffMathy/hey-jarvis/commit/acf2c8f768e0a5763e08d8fe9b13a98045b78d67))


### Bug Fixes

* **home-assistant-addon:** add nginx proxy timeout and retry configuration ([#458](https://github.com/ffMathy/hey-jarvis/issues/458)) ([2c2ceab](https://github.com/ffMathy/hey-jarvis/commit/2c2ceab2573b1566b783acd7f5106ebd1f58f43e))

## [1.2.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.2.2...home-assistant-addon-v1.2.3) (2026-01-09)


### Bug Fixes

* **mcp:** resolve nginx circular proxy by using internal port 8112 ([d2a9eb3](https://github.com/ffMathy/hey-jarvis/commit/d2a9eb3cae9938ccf93350a13860906bcc6a4f3a))
* **mcp:** resolve nginx circular proxy configuration ([#456](https://github.com/ffMathy/hey-jarvis/issues/456)) ([f373c13](https://github.com/ffMathy/hey-jarvis/commit/f373c1390789b4e724c9985f9e3c37ad2d1fc183))

## [1.2.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.2.1...home-assistant-addon-v1.2.2) (2026-01-09)


### Bug Fixes

* **mcp,home-assistant-addon:** fix nginx connection refused to upstream services ([9ccfdfc](https://github.com/ffMathy/hey-jarvis/commit/9ccfdfc8d363c2f5fc7eaa2400cc81f60cba3a06))
* **mcp,home-assistant-addon:** resolve nginx IPv6 connection failures to upstream services ([#454](https://github.com/ffMathy/hey-jarvis/issues/454)) ([5c3f62d](https://github.com/ffMathy/hey-jarvis/commit/5c3f62d98234e36b2d56cff8590ddcc62041d2dd))

## [1.2.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.2.0...home-assistant-addon-v1.2.1) (2026-01-09)


### Bug Fixes

* **home-assistant-addon:** resolve port conflict between nginx and mastra-studio ([29a30fa](https://github.com/ffMathy/hey-jarvis/commit/29a30fa799ef116710dbad4314510e962855b621))
* **home-assistant-addon:** resolve port conflict between nginx and mastra-studio ([#453](https://github.com/ffMathy/hey-jarvis/issues/453)) ([77f156d](https://github.com/ffMathy/hey-jarvis/commit/77f156da4652dd134a5b549e408292a809e64407))

## [1.2.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.7...home-assistant-addon-v1.2.0) (2026-01-09)


### Bug Fixes

* change mastra-studio port from 8113 to 4111 ([e549b80](https://github.com/ffMathy/hey-jarvis/commit/e549b801e60b927daf8e57d73a2732e9f5f83709))
* correct port configuration for nginx and supervisord ([de50feb](https://github.com/ffMathy/hey-jarvis/commit/de50feb753529a071e01a41fe376371e58f328e7))
* nginx 500 error: correct port mapping for Mastra Studio ([#446](https://github.com/ffMathy/hey-jarvis/issues/446)) ([b02b0f9](https://github.com/ffMathy/hey-jarvis/commit/b02b0f9b12d8f789c9e974200fad48a576647918))
* remove duplicate text/html MIME type in nginx config ([c5cbce1](https://github.com/ffMathy/hey-jarvis/commit/c5cbce1053d42ac8e14e0af0af89b23a648dbb47))
* remove HTML rewriting as studio base is now handled elsewhere ([fafa282](https://github.com/ffMathy/hey-jarvis/commit/fafa282bb98f896f2b133428bee0506873a902df))
* restore sub_filter_types for clarity ([0eff17c](https://github.com/ffMathy/hey-jarvis/commit/0eff17c372f2e6a8d41f6c8ee52690c33160e819))

## [1.1.7](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.6...home-assistant-addon-v1.1.7) (2026-01-08)


### Bug Fixes

* better stability around ports ([753f7c1](https://github.com/ffMathy/hey-jarvis/commit/753f7c189fc2b678d66d421f4543d92b9ffae2a6))
* better stability around ports ([#442](https://github.com/ffMathy/hey-jarvis/issues/442)) ([37beddc](https://github.com/ffMathy/hey-jarvis/commit/37beddcb343e5b5eeb2516acfa129de8651f3879))

## [1.1.6](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.5...home-assistant-addon-v1.1.6) (2026-01-08)


### Bug Fixes

* **addon:** add nginx to production image for Home Assistant ingress ([#439](https://github.com/ffMathy/hey-jarvis/issues/439)) ([07912ad](https://github.com/ffMathy/hey-jarvis/commit/07912ad48bdb4b35938831f51d4b7385382c9908))
* **addon:** add nginx to production image for ingress support ([63464a0](https://github.com/ffMathy/hey-jarvis/commit/63464a01bd7f316408d5d7d3a78c2638e3fe9c9b))
* new ingress relay ([57c2e0a](https://github.com/ffMathy/hey-jarvis/commit/57c2e0a9c639e3b10b4d4678446baf48fa5f63b7))
* new ingress relay ([#441](https://github.com/ffMathy/hey-jarvis/issues/441)) ([27da5a9](https://github.com/ffMathy/hey-jarvis/commit/27da5a9a9f8c01d9736a810e09ca4fe1e3339ca6))

## [1.1.5](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.4...home-assistant-addon-v1.1.5) (2026-01-08)


### Bug Fixes

* **addon:** route ingress traffic through nginx for path rewriting ([#437](https://github.com/ffMathy/hey-jarvis/issues/437)) ([9836ad8](https://github.com/ffMathy/hey-jarvis/commit/9836ad814d77bc8f09ae6e74ec31e0dbe2ce176b))
* **addon:** update nginx and supervisord to handle ingress on port 4113 ([e0ae5c0](https://github.com/ffMathy/hey-jarvis/commit/e0ae5c0147ad5248a282ae7a23041530f9aecb89))

## [1.1.4](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.3...home-assistant-addon-v1.1.4) (2026-01-07)


### Bug Fixes

* add port 4113/tcp to config.json ([c580532](https://github.com/ffMathy/hey-jarvis/commit/c580532467c506ac657178b7e0d464d57ca308fd))
* add port 4113/tcp to config.json ([#435](https://github.com/ffMathy/hey-jarvis/issues/435)) ([ff7a462](https://github.com/ffMathy/hey-jarvis/commit/ff7a462f20dc02884d978926c9a1eb5edc817423))

## [1.1.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.2...home-assistant-addon-v1.1.3) (2026-01-07)


### Bug Fixes

* **home-assistant-addon:** install bash in Docker image to fix SIGTERM error ([0834a2c](https://github.com/ffMathy/hey-jarvis/commit/0834a2c222eb3891fb0ef7e47e751bbfa890897a))
* **home-assistant-addon:** install bash in final Docker stage ([#433](https://github.com/ffMathy/hey-jarvis/issues/433)) ([a6b5e98](https://github.com/ffMathy/hey-jarvis/commit/a6b5e98d6ca3521ccaddc8c5fedf8da713812a7d))

## [1.1.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.1...home-assistant-addon-v1.1.2) (2026-01-07)


### Bug Fixes

* docker build context in home-assistant-addon deploy script ([#431](https://github.com/ffMathy/hey-jarvis/issues/431)) ([f133e3a](https://github.com/ffMathy/hey-jarvis/commit/f133e3a3f580ee749ef3bfe39d8a9504ef4ffaa9))
* **home-assistant-addon:** correct Docker build context in deploy script ([3b3c035](https://github.com/ffMathy/hey-jarvis/commit/3b3c035e9ee6c0e8bf0a3f393c739fec89b3a30c))

## [1.1.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.1.0...home-assistant-addon-v1.1.1) (2026-01-06)


### Bug Fixes

* better base URL support ([9e6bfdf](https://github.com/ffMathy/hey-jarvis/commit/9e6bfdf7e19f4a56ff9d073f32236bae6c2dd31d))
* better project startup ([a41faaa](https://github.com/ffMathy/hey-jarvis/commit/a41faaac498b893d656b9a9d730471b81ab0e843))
* build issues with dockerfile ([569836f](https://github.com/ffMathy/hey-jarvis/commit/569836f45b0b0cc6553c36b2fce0863775099610))
* docker build ([f2467eb](https://github.com/ffMathy/hey-jarvis/commit/f2467eb4ae22e55a74ad2befd1e7db868c9d18e2))
* jarvis stability ([#427](https://github.com/ffMathy/hey-jarvis/issues/427)) ([35298b1](https://github.com/ffMathy/hey-jarvis/commit/35298b10d354015eeab9e7059dfa64ba54304460))
* updates to stability ([8215965](https://github.com/ffMathy/hey-jarvis/commit/8215965e8818c22d6a94cc4b0d399063d39c2612))

## [1.1.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.0.2...home-assistant-addon-v1.1.0) (2025-12-29)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [1.0.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.0.1...home-assistant-addon-v1.0.2) (2025-12-11)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [1.0.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v1.0.0...home-assistant-addon-v1.0.1) (2025-12-11)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [1.0.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.26.1...home-assistant-addon-v1.0.0) (2025-12-11)


### Bug Fixes

* better bundling ([a9973f2](https://github.com/ffMathy/hey-jarvis/commit/a9973f29c8e88d6d36df07e146c3a6905cea1d64))

## [0.26.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.26.0...home-assistant-addon-v0.26.1) (2025-12-07)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.26.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.25.1...home-assistant-addon-v0.26.0) (2025-12-07)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.25.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.25.0...home-assistant-addon-v0.25.1) (2025-12-06)


### Bug Fixes

* **home-assistant-addon:** replace apt-get with apk for Alpine Linux base ([d40cfe5](https://github.com/ffMathy/hey-jarvis/commit/d40cfe5a0456ed9ff3b3f9498b598755f0a514e4))
* **home-assistant-addon:** use apk instead of apt-get for Alpine base image ([#404](https://github.com/ffMathy/hey-jarvis/issues/404)) ([129ad13](https://github.com/ffMathy/hey-jarvis/commit/129ad1382246b07052ae0d1751226ffa732dd4c7))

## [0.25.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.24.0...home-assistant-addon-v0.25.0) (2025-12-06)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.24.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.23.0...home-assistant-addon-v0.24.0) (2025-12-05)


### Bug Fixes

* **mcp:** add min(1) validation to shopping list input schema and fix CI test failures ([#390](https://github.com/ffMathy/hey-jarvis/issues/390)) ([74f4afa](https://github.com/ffMathy/hey-jarvis/commit/74f4afa7278390fe5b57e5e71cbc9257d9e8567b))
* **mcp:** add min(1) validation to shopping list input schema to reject empty prompts ([84e9620](https://github.com/ffMathy/hey-jarvis/commit/84e962094198de88daac1ed40a7a3b4980bb24ca))

## [0.23.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.22.3...home-assistant-addon-v0.23.0) (2025-12-03)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.22.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.22.2...home-assistant-addon-v0.22.3) (2025-12-02)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.22.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.22.1...home-assistant-addon-v0.22.2) (2025-12-02)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.22.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.22.0...home-assistant-addon-v0.22.1) (2025-12-02)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.22.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.21.0...home-assistant-addon-v0.22.0) (2025-12-02)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.21.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.20.0...home-assistant-addon-v0.21.0) (2025-12-01)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.20.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.19.0...home-assistant-addon-v0.20.0) (2025-12-01)


### Features

* **phone,iot,notification:** add text messaging and user location tools ([#367](https://github.com/ffMathy/hey-jarvis/issues/367)) ([51fb660](https://github.com/ffMathy/hey-jarvis/commit/51fb660594d2fc7cdd1d263bd88b7897f379f6d7))

## [0.19.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.18.0...home-assistant-addon-v0.19.0) (2025-12-01)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.18.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.17.0...home-assistant-addon-v0.18.0) (2025-12-01)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.17.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.16.2...home-assistant-addon-v0.17.0) (2025-12-01)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.16.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.16.1...home-assistant-addon-v0.16.2) (2025-12-01)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.16.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.16.0...home-assistant-addon-v0.16.1) (2025-12-01)


### Bug Fixes

* **home-assistant-addon:** use apt-get instead of apk for Debian base image ([47e4a78](https://github.com/ffMathy/hey-jarvis/commit/47e4a7829eea0377ef31ba941be3d99cb352e50d))
* **home-assistant-addon:** use apt-get instead of apk for Debian base image ([#352](https://github.com/ffMathy/hey-jarvis/issues/352)) ([eddae4c](https://github.com/ffMathy/hey-jarvis/commit/eddae4cfd8551c479588698029f1679459979fae))

## [0.16.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.15.0...home-assistant-addon-v0.16.0) (2025-11-30)


### Bug Fixes

* warnings and errors from building and linting the project ([#350](https://github.com/ffMathy/hey-jarvis/issues/350)) ([594c658](https://github.com/ffMathy/hey-jarvis/commit/594c658cacf0937cdff05b2887ade91795317ea6))

## [0.15.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.14.0...home-assistant-addon-v0.15.0) (2025-11-29)


### Features

* add lint-staged to husky pre-commit and global lint dependencies ([4bb4777](https://github.com/ffMathy/hey-jarvis/commit/4bb4777aeb8e9db1e5537b25c81ebd3249e3eb0e))
* add lint-staged to husky pre-commit and global lint dependencies ([#343](https://github.com/ffMathy/hey-jarvis/issues/343)) ([83f5fe8](https://github.com/ffMathy/hey-jarvis/commit/83f5fe8c630ece3f2086baeb9e81e28ddcae2d98))
* configure Ollama models to store in /data/llm/models with backup exclusion ([#348](https://github.com/ffMathy/hey-jarvis/issues/348)) ([a486d19](https://github.com/ffMathy/hey-jarvis/commit/a486d194817683d4d50a990cb22baf4077b8c1fc))
* **mcp:** add LLM-evaluated tests for routing workflows DAG generation ([318cba4](https://github.com/ffMathy/hey-jarvis/commit/318cba435b427cc72264cbbf76a45161464f2031))
* **mcp:** configure Ollama models directory to /data/llm/models ([05a778e](https://github.com/ffMathy/hey-jarvis/commit/05a778e6515c3a2121f0acb26be61afc28f8fcc6))


### Bug Fixes

* revert unintentional formatting changes and remove cloudflared.deb ([aa47eaf](https://github.com/ffMathy/hey-jarvis/commit/aa47eafa733892a4663f76a9c888551d2d9591c6))

## [0.14.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.13.3...home-assistant-addon-v0.14.0) (2025-11-28)


### Features

* add github_api_token to Home Assistant addon config ([b91aaa7](https://github.com/ffMathy/hey-jarvis/commit/b91aaa7d2e5b5ebdac711063282815a8c8225f06))
* add github_api_token to Home Assistant addon config ([#330](https://github.com/ffMathy/hey-jarvis/issues/330)) ([8adb6f3](https://github.com/ffMathy/hey-jarvis/commit/8adb6f30e1ea9633da8f2474fb833cacf4e974db))
* human in the loop ([#313](https://github.com/ffMathy/hey-jarvis/issues/313)) ([c047d6c](https://github.com/ffMathy/hey-jarvis/commit/c047d6cff761256ae38b9a26a8df1563f1b14678))
* **mcp:** add async orchestration routing vertical ([#331](https://github.com/ffMathy/hey-jarvis/issues/331)) ([79d5c76](https://github.com/ffMathy/hey-jarvis/commit/79d5c76eea37b74a9fc195006f51d8885ac81c90))


### Bug Fixes

* skip certain tests ([4a3bf75](https://github.com/ffMathy/hey-jarvis/commit/4a3bf75d6e302f1f5cb265cda4e786789c4ba235))

## [0.13.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.13.2...home-assistant-addon-v0.13.3) (2025-11-24)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.13.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.13.1...home-assistant-addon-v0.13.2) (2025-11-24)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.13.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.13.0...home-assistant-addon-v0.13.1) (2025-11-24)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.13.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.12.3...home-assistant-addon-v0.13.0) (2025-11-24)


### Features

* add commute agent with Google Maps integration ([#297](https://github.com/ffMathy/hey-jarvis/issues/297)) ([32ae363](https://github.com/ffMathy/hey-jarvis/commit/32ae36385ffc8a853794e26bf71f4e06a7980ddc))
* **commute:** search at multiple route points and use geolib for distance calculation ([259d3e7](https://github.com/ffMathy/hey-jarvis/commit/259d3e7792ac71a9df71160b8acc1ce2266a4e97))

## [0.12.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.12.2...home-assistant-addon-v0.12.3) (2025-11-23)


### Bug Fixes

* don't open HTML reports in playwright ([29403db](https://github.com/ffMathy/hey-jarvis/commit/29403dba3d65ad34443dcdba5007ccf1e6784748))
* general stability improvements ([#295](https://github.com/ffMathy/hey-jarvis/issues/295)) ([0cec2f6](https://github.com/ffMathy/hey-jarvis/commit/0cec2f652c6244d68d407a36454bf35bee69d3e8))
* path broken for home assistant addon dockerfile ([f0a7b98](https://github.com/ffMathy/hey-jarvis/commit/f0a7b98ca3f396ef9c215a65b5c1537ac63ca13d))
* workflow scheduling fix ([6e1e5ed](https://github.com/ffMathy/hey-jarvis/commit/6e1e5ed8912b3ec39107d68c6846ebbd776295d0))

## [0.12.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.12.1...home-assistant-addon-v0.12.2) (2025-11-23)


### Bug Fixes

* console log forwarding in Home Assistant addon using supervisord ([#289](https://github.com/ffMathy/hey-jarvis/issues/289)) ([bbaf18a](https://github.com/ffMathy/hey-jarvis/commit/bbaf18a1c588c95790127f0983b702be9192b58b))
* implement supervisord for console log forwarding in MCP addon ([d70020d](https://github.com/ffMathy/hey-jarvis/commit/d70020d756503d8393908ba43ca5c25fe51bde46))

## [0.12.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.12.0...home-assistant-addon-v0.12.1) (2025-11-23)


### Bug Fixes

* add nginx ingress proxy readiness check to container startup ([3d9f030](https://github.com/ffMathy/hey-jarvis/commit/3d9f0303705b210f2d6c3a7b3041e67732be020a))
* switch to Bun test, leverage Bun features, fix Docker timing race, and server auto-start ([#286](https://github.com/ffMathy/hey-jarvis/issues/286)) ([7f436fa](https://github.com/ffMathy/hey-jarvis/commit/7f436fa1481017f7dcd8a0b55b8cb029b78f04d5))

## [0.12.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.11.1...home-assistant-addon-v0.12.0) (2025-11-22)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.11.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.11.0...home-assistant-addon-v0.11.1) (2025-11-22)


### Bug Fixes

* **workflows:** wrap recipes array in object for meal plan validation ([26db98f](https://github.com/ffMathy/hey-jarvis/commit/26db98f924bf6cbf7e49de61a929f04c8ff0ce26))
* **workflows:** wrap recipes array in object for step input validation ([#278](https://github.com/ffMathy/hey-jarvis/issues/278)) ([b393089](https://github.com/ffMathy/hey-jarvis/commit/b39308950160c513f29220d4f14dac310aa148f5))

## [0.11.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.10.1...home-assistant-addon-v0.11.0) (2025-11-22)


### Features

* send email on meal plan ([e9dd6e3](https://github.com/ffMathy/hey-jarvis/commit/e9dd6e34fd2d035e5b41ee84e3fb9ef949367b73))

## [0.10.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.10.0...home-assistant-addon-v0.10.1) (2025-11-22)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.10.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.9.0...home-assistant-addon-v0.10.0) (2025-11-22)


### Features

* proactive memory ([de41c44](https://github.com/ffMathy/hey-jarvis/commit/de41c448a000542120e84d3a32a97970979c8979))
* proactive memory ([be40bba](https://github.com/ffMathy/hey-jarvis/commit/be40bba6087c7d0cf871950c2229a7d176d6df39))


### Bug Fixes

* persistent storage across sessions ([d7d2140](https://github.com/ffMathy/hey-jarvis/commit/d7d2140915b8c3c2c3ded5d0a0226f0b796ea068))
* persistent storage across sessions ([37ef179](https://github.com/ffMathy/hey-jarvis/commit/37ef17921f1d27197d5ef915c5ecc11d13fc6a8c))

## [0.9.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.8.0...home-assistant-addon-v0.9.0) (2025-11-22)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.8.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.7.0...home-assistant-addon-v0.8.0) (2025-11-22)


### Features

* improved token generation ([6234c52](https://github.com/ffMathy/hey-jarvis/commit/6234c5221d46f168cea005246a5b0ff2c974d15a))
* lots of new verticals and improvements ([dd5c04e](https://github.com/ffMathy/hey-jarvis/commit/dd5c04e67b88cd73a53c14510b122bf1dae5f195))


### Bug Fixes

* better API key ([d5d8b07](https://github.com/ffMathy/hey-jarvis/commit/d5d8b07198f0f42bab1cad561fac01596d0fe6b6))
* better jwt integration ([d415819](https://github.com/ffMathy/hey-jarvis/commit/d415819c8fe7d7ccf1b1c6ad422ffb8002ca52fd))
* better stability for some projects ([33f8cf2](https://github.com/ffMathy/hey-jarvis/commit/33f8cf29daea5354090264d9b04974eafb3233be))
* better targets ([45f9994](https://github.com/ffMathy/hey-jarvis/commit/45f999493d71a372423b9556e2aa2d31d6850b5a))
* **home-assistant-addon:** add nginx to test container for ingress simulation ([106e1f0](https://github.com/ffMathy/hey-jarvis/commit/106e1f0843f5210fbddc9e816d78abec075c1711))
* **home-assistant-addon:** allow expected asset 404s in ingress test ([7bfb06e](https://github.com/ffMathy/hey-jarvis/commit/7bfb06eca7ca6d9bbae7cc512d2107dba886722f))
* **home-assistant-addon:** use centralized port config and add ingress port mapping ([c802938](https://github.com/ffMathy/hey-jarvis/commit/c802938210e5ee22f070658d7fcf21cdbcceb101))
* kill ports ([55c415e](https://github.com/ffMathy/hey-jarvis/commit/55c415ee47ba6531eeec748bcbd2083d651afb9d))
* new progress on verticals ([4a5323f](https://github.com/ffMathy/hey-jarvis/commit/4a5323fe875aba3d0bb0cbef495ff926fca495a1))
* wait both for UI and MCP server ([cdfd5b1](https://github.com/ffMathy/hey-jarvis/commit/cdfd5b16264f435652e34fd6f5f52980666cc285))

## [0.7.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.6.0...home-assistant-addon-v0.7.0) (2025-11-20)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.6.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.5.0...home-assistant-addon-v0.6.0) (2025-11-20)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.5.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.4.4...home-assistant-addon-v0.5.0) (2025-11-20)


### Features

* enhance 1Password authentication and terminal session managemen… ([#251](https://github.com/ffMathy/hey-jarvis/issues/251)) ([ec808be](https://github.com/ffMathy/hey-jarvis/commit/ec808be26efb82d0b4d491ea367f4f1f6eecacd8))

## [0.4.4](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.4.3...home-assistant-addon-v0.4.4) (2025-11-20)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.4.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.4.2...home-assistant-addon-v0.4.3) (2025-11-20)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.4.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.4.1...home-assistant-addon-v0.4.2) (2025-11-20)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.4.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.4.0...home-assistant-addon-v0.4.1) (2025-11-20)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.4.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.3.0...home-assistant-addon-v0.4.0) (2025-11-19)


### Bug Fixes

* **env:** update GitHub API token reference in op.env ([#236](https://github.com/ffMathy/hey-jarvis/issues/236)) ([d841ea7](https://github.com/ffMathy/hey-jarvis/commit/d841ea787ce385c027117c4c6e2b12157ee695ea))

## [0.3.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.2.0...home-assistant-addon-v0.3.0) (2025-11-19)


### Features

* **home-assistant-addon:** allow JWT tokens without expiry claim ([#232](https://github.com/ffMathy/hey-jarvis/issues/232)) ([fea7c94](https://github.com/ffMathy/hey-jarvis/commit/fea7c94e0f0ade3829a1962c9a65f1c9770f6319))

## [0.2.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.1.2...home-assistant-addon-v0.2.0) (2025-11-19)


### Features

* **home-assistant-addon:** add nginx-based JWT authentication for MCP server ([#230](https://github.com/ffMathy/hey-jarvis/issues/230)) ([4e35f06](https://github.com/ffMathy/hey-jarvis/commit/4e35f06aa08c264f8fdf83f9be2db5c2e1959bcd))

## [0.1.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.1.1...home-assistant-addon-v0.1.2) (2025-11-18)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

## [0.1.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v0.1.0...home-assistant-addon-v0.1.1) (2025-11-18)


### Bug Fixes

* **mcp:** use bunx for mastra CLI in Docker startup script ([#226](https://github.com/ffMathy/hey-jarvis/issues/226)) ([cc5a924](https://github.com/ffMathy/hey-jarvis/commit/cc5a92412361b194f32c73fa32f877260cfad370))

## 0.1.0 (2025-11-18)


### ⚠ BREAKING CHANGES

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51))

### Features

* add environment variable configuration support to Home Assistant addon ([#59](https://github.com/ffMathy/hey-jarvis/issues/59)) ([e025956](https://github.com/ffMathy/hey-jarvis/commit/e025956f1c36e93fb0e2f1f14f23c34462a2f23a))
* add new project and deploy pipeline ([857dd8a](https://github.com/ffMathy/hey-jarvis/commit/857dd8a7290100f31984d7a94fd822f85f2a1987))
* add shared functions to start MCP servers ([#222](https://github.com/ffMathy/hey-jarvis/issues/222)) ([8cfd97d](https://github.com/ffMathy/hey-jarvis/commit/8cfd97d1d83443d52af2ef232c69ebc45f8d82db))
* bump release to trigger new versions ([fb4b36f](https://github.com/ffMathy/hey-jarvis/commit/fb4b36feecd6acfa7b9fa1d48608c8a141aa26d1))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([307ac9e](https://github.com/ffMathy/hey-jarvis/commit/307ac9e008d438f1d07c37694bc5afb0dbf47f5e))
* **home-assistant-addon:** add catch-all proxy and improve e2e test assertions ([f2ba633](https://github.com/ffMathy/hey-jarvis/commit/f2ba633ef514f025be206ca045a3ad40b8ee3580))
* **home-assistant-addon:** add catch-all proxy and improve e2e test assertions ([1be148f](https://github.com/ffMathy/hey-jarvis/commit/1be148f8cd8f4fc34c1ae2f74aba61188bf1ffaa))
* **home-assistant-addon:** add nginx to e2e test for ingress simulation ([52e9062](https://github.com/ffMathy/hey-jarvis/commit/52e90629a4e5c734e3b5b3138819e4ee0189845c))
* **home-assistant-addon:** add nginx to e2e test for ingress simulation ([3d2b757](https://github.com/ffMathy/hey-jarvis/commit/3d2b757787f750f75fb1b277c4db1d2d4a592e7b))
* migrate from NPM to Bun for package management ([5455985](https://github.com/ffMathy/hey-jarvis/commit/54559850929c9dc36fbada4661dede0336cafa6d))
* optimize Docker images with Alpine base and multi-stage builds ([c616e78](https://github.com/ffMathy/hey-jarvis/commit/c616e7895b3ac4123dade49c2f82f27bedab8fcc))


### Bug Fixes

* 403 Docker build errors by using locally built base images ([#29](https://github.com/ffMathy/hey-jarvis/issues/29)) ([a5a94b3](https://github.com/ffMathy/hey-jarvis/commit/a5a94b31bb92510867ae14f73c0400f79ecb15ef))
* attempt at variable substitution ([7f3cbce](https://github.com/ffMathy/hey-jarvis/commit/7f3cbcebec69a3a322e2d1edf655e3252dd95b64))
* better deploy script ([#40](https://github.com/ffMathy/hey-jarvis/issues/40)) ([54838cf](https://github.com/ffMathy/hey-jarvis/commit/54838cfd67a7646a95a1c2c466c0c711895c8a5d))
* better paths ([c756779](https://github.com/ffMathy/hey-jarvis/commit/c7567799bfd4b8bc9ab9044c67471f5432562714))
* better tests ([716b97c](https://github.com/ffMathy/hey-jarvis/commit/716b97c6d28fd97b1ae0fa91561f801ac9af8f6e))
* better version bumping ([4330e52](https://github.com/ffMathy/hey-jarvis/commit/4330e5226be27eea7c4f9015033c96223354b4ec))
* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51)) ([5fea475](https://github.com/ffMathy/hey-jarvis/commit/5fea475ef50ab24b77397f2e5d05e1ef69054b8d))
* end-to-end Home Assistant tests ([5c90bad](https://github.com/ffMathy/hey-jarvis/commit/5c90bad29ec07823cd7e58ec4f24f8b627760a42))
* end-to-end Home Assistant tests ([4a04654](https://github.com/ffMathy/hey-jarvis/commit/4a04654353bccc1b41212dd310b6c269ad9b26c9))
* end-to-end Home Assistant tests ([4967eb0](https://github.com/ffMathy/hey-jarvis/commit/4967eb0266843871bff9b3adc2ad25ba2f8cb9e1))
* **home-assistant-addon:** address code review feedback for error handling ([11c7d85](https://github.com/ffMathy/hey-jarvis/commit/11c7d85a64fbff11d7d1f7d3ab259c49ce1323ff))
* **home-assistant-addon:** explicitly specify port for mastra dev command ([eb08426](https://github.com/ffMathy/hey-jarvis/commit/eb08426b3e1a089d830907a2d5b3b92dc805c224))
* **home-assistant-addon:** improve error handling for parallel server startup ([7fecdf8](https://github.com/ffMathy/hey-jarvis/commit/7fecdf897acd1ec77b8fe75c825d7eae76dd2953))
* **home-assistant-addon:** increase test timeout and improve error reporting ([50cb221](https://github.com/ffMathy/hey-jarvis/commit/50cb221b629f6d8050c90dbded56d7befb584eb3))
* **home-assistant-addon:** remove invalid --port flag from mastra dev command ([ad1d819](https://github.com/ffMathy/hey-jarvis/commit/ad1d81960924f797c150e86d8a6c6e3babdc1b17))
* **home-assistant-addon:** resolve docker entrypoint error and correct server path ([ee45197](https://github.com/ffMathy/hey-jarvis/commit/ee451975b1b8c858ce980d55564494247b6b01d8))
* **home-assistant-addon:** resolve static asset 404s under ingress proxy ([#191](https://github.com/ffMathy/hey-jarvis/issues/191)) ([d58603f](https://github.com/ffMathy/hey-jarvis/commit/d58603f6ede6e643cbcea5cd39d2abd83f2d78e3))
* **home-assistant-addon:** simplify test entrypoint with direct env vars ([bb5fc42](https://github.com/ffMathy/hey-jarvis/commit/bb5fc4294a52913066e00e3beb94bf42e23defad))
* **home-assistant-addon:** start both Mastra and MCP servers in parallel ([e40b47c](https://github.com/ffMathy/hey-jarvis/commit/e40b47c30fc907ebc5daa92c002149f0b4c8c724))
* missing lines ([036ff1a](https://github.com/ffMathy/hey-jarvis/commit/036ff1a24dca83efbc67ad72bd365275d7493eaa))
* multi architecture builds ([#38](https://github.com/ffMathy/hey-jarvis/issues/38)) ([d0ca5d9](https://github.com/ffMathy/hey-jarvis/commit/d0ca5d989390c84bd870c2a2d7a3fd66166f400f))
* new changelog format ([7e69f27](https://github.com/ffMathy/hey-jarvis/commit/7e69f27e53b61ff5c5412ded5792db178d96b439))
* proper architecture ([1443e60](https://github.com/ffMathy/hey-jarvis/commit/1443e6018d4f349496bf4369c6a9ced6eb8df868))
* proper env check ([38fbdff](https://github.com/ffMathy/hey-jarvis/commit/38fbdffff65caee985a04f9d03dd7fa542140eff))
* reference env from prefix ([11b1213](https://github.com/ffMathy/hey-jarvis/commit/11b12135ff6e20aa89830bb8ca91ef8bd701fbec))
* replace npx tsx with bun run for MCP server startup in container ([#189](https://github.com/ffMathy/hey-jarvis/issues/189)) ([847bb22](https://github.com/ffMathy/hey-jarvis/commit/847bb22f2f24f3b4a77213f131570498a021a2be))
* resolve build issue in dockerfile ([f42508b](https://github.com/ffMathy/hey-jarvis/commit/f42508b18bbdae2c819ff5626453177c17cdc107))
* resolve Jest test failures by compiling TypeScript first with esbuild ([#162](https://github.com/ffMathy/hey-jarvis/issues/162)) ([d0ec7bf](https://github.com/ffMathy/hey-jarvis/commit/d0ec7bfd3a27014874585ed9f7bd9089cb98a839))
* test performance ([d8935de](https://github.com/ffMathy/hey-jarvis/commit/d8935de6f94754476dcf89849704513dcb048b64))
* test url ([9cfd539](https://github.com/ffMathy/hey-jarvis/commit/9cfd53976cca147821d952ea9f649fc0c8b84720))
* test url ([9350533](https://github.com/ffMathy/hey-jarvis/commit/9350533800b953f1a14bbd4efe7a353e27b3f2db))
* tests now truly run via nx too ([cbe44fd](https://github.com/ffMathy/hey-jarvis/commit/cbe44fdbea93edb03f509b7261904db99cae62be))
* update architecture label in Dockerfile ([81e3f86](https://github.com/ffMathy/hey-jarvis/commit/81e3f86d1ebdc74614279bae5f9625efa51c7ad4))

## [4.0.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v4.0.0...home-assistant-addon-v4.0.1) (2025-11-14)


### Bug Fixes

* replace npx tsx with bun run for MCP server startup in container ([#189](https://github.com/ffMathy/hey-jarvis/issues/189)) ([847bb22](https://github.com/ffMathy/hey-jarvis/commit/847bb22f2f24f3b4a77213f131570498a021a2be))

## [4.0.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v3.2.0...home-assistant-addon-v4.0.0) (2025-11-13)


### ⚠ BREAKING CHANGES

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51))

### Features

* add environment variable configuration support to Home Assistant addon ([#59](https://github.com/ffMathy/hey-jarvis/issues/59)) ([e025956](https://github.com/ffMathy/hey-jarvis/commit/e025956f1c36e93fb0e2f1f14f23c34462a2f23a))
* add new project and deploy pipeline ([857dd8a](https://github.com/ffMathy/hey-jarvis/commit/857dd8a7290100f31984d7a94fd822f85f2a1987))
* bump release to trigger new versions ([fb4b36f](https://github.com/ffMathy/hey-jarvis/commit/fb4b36feecd6acfa7b9fa1d48608c8a141aa26d1))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([307ac9e](https://github.com/ffMathy/hey-jarvis/commit/307ac9e008d438f1d07c37694bc5afb0dbf47f5e))
* **home-assistant-addon:** add catch-all proxy and improve e2e test assertions ([f2ba633](https://github.com/ffMathy/hey-jarvis/commit/f2ba633ef514f025be206ca045a3ad40b8ee3580))
* **home-assistant-addon:** add catch-all proxy and improve e2e test assertions ([1be148f](https://github.com/ffMathy/hey-jarvis/commit/1be148f8cd8f4fc34c1ae2f74aba61188bf1ffaa))
* **home-assistant-addon:** add nginx to e2e test for ingress simulation ([52e9062](https://github.com/ffMathy/hey-jarvis/commit/52e90629a4e5c734e3b5b3138819e4ee0189845c))
* **home-assistant-addon:** add nginx to e2e test for ingress simulation ([3d2b757](https://github.com/ffMathy/hey-jarvis/commit/3d2b757787f750f75fb1b277c4db1d2d4a592e7b))
* migrate from NPM to Bun for package management ([5455985](https://github.com/ffMathy/hey-jarvis/commit/54559850929c9dc36fbada4661dede0336cafa6d))
* optimize Docker images with Alpine base and multi-stage builds ([c616e78](https://github.com/ffMathy/hey-jarvis/commit/c616e7895b3ac4123dade49c2f82f27bedab8fcc))


### Bug Fixes

* 403 Docker build errors by using locally built base images ([#29](https://github.com/ffMathy/hey-jarvis/issues/29)) ([a5a94b3](https://github.com/ffMathy/hey-jarvis/commit/a5a94b31bb92510867ae14f73c0400f79ecb15ef))
* attempt at variable substitution ([7f3cbce](https://github.com/ffMathy/hey-jarvis/commit/7f3cbcebec69a3a322e2d1edf655e3252dd95b64))
* better deploy script ([#40](https://github.com/ffMathy/hey-jarvis/issues/40)) ([54838cf](https://github.com/ffMathy/hey-jarvis/commit/54838cfd67a7646a95a1c2c466c0c711895c8a5d))
* better paths ([c756779](https://github.com/ffMathy/hey-jarvis/commit/c7567799bfd4b8bc9ab9044c67471f5432562714))
* better tests ([716b97c](https://github.com/ffMathy/hey-jarvis/commit/716b97c6d28fd97b1ae0fa91561f801ac9af8f6e))
* better version bumping ([4330e52](https://github.com/ffMathy/hey-jarvis/commit/4330e5226be27eea7c4f9015033c96223354b4ec))
* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51)) ([5fea475](https://github.com/ffMathy/hey-jarvis/commit/5fea475ef50ab24b77397f2e5d05e1ef69054b8d))
* end-to-end Home Assistant tests ([5c90bad](https://github.com/ffMathy/hey-jarvis/commit/5c90bad29ec07823cd7e58ec4f24f8b627760a42))
* end-to-end Home Assistant tests ([4a04654](https://github.com/ffMathy/hey-jarvis/commit/4a04654353bccc1b41212dd310b6c269ad9b26c9))
* end-to-end Home Assistant tests ([4967eb0](https://github.com/ffMathy/hey-jarvis/commit/4967eb0266843871bff9b3adc2ad25ba2f8cb9e1))
* **home-assistant-addon:** address code review feedback for error handling ([11c7d85](https://github.com/ffMathy/hey-jarvis/commit/11c7d85a64fbff11d7d1f7d3ab259c49ce1323ff))
* **home-assistant-addon:** explicitly specify port for mastra dev command ([eb08426](https://github.com/ffMathy/hey-jarvis/commit/eb08426b3e1a089d830907a2d5b3b92dc805c224))
* **home-assistant-addon:** improve error handling for parallel server startup ([7fecdf8](https://github.com/ffMathy/hey-jarvis/commit/7fecdf897acd1ec77b8fe75c825d7eae76dd2953))
* **home-assistant-addon:** increase test timeout and improve error reporting ([50cb221](https://github.com/ffMathy/hey-jarvis/commit/50cb221b629f6d8050c90dbded56d7befb584eb3))
* **home-assistant-addon:** remove invalid --port flag from mastra dev command ([ad1d819](https://github.com/ffMathy/hey-jarvis/commit/ad1d81960924f797c150e86d8a6c6e3babdc1b17))
* **home-assistant-addon:** resolve docker entrypoint error and correct server path ([ee45197](https://github.com/ffMathy/hey-jarvis/commit/ee451975b1b8c858ce980d55564494247b6b01d8))
* **home-assistant-addon:** simplify test entrypoint with direct env vars ([bb5fc42](https://github.com/ffMathy/hey-jarvis/commit/bb5fc4294a52913066e00e3beb94bf42e23defad))
* **home-assistant-addon:** start both Mastra and MCP servers in parallel ([e40b47c](https://github.com/ffMathy/hey-jarvis/commit/e40b47c30fc907ebc5daa92c002149f0b4c8c724))
* missing lines ([036ff1a](https://github.com/ffMathy/hey-jarvis/commit/036ff1a24dca83efbc67ad72bd365275d7493eaa))
* multi architecture builds ([#38](https://github.com/ffMathy/hey-jarvis/issues/38)) ([d0ca5d9](https://github.com/ffMathy/hey-jarvis/commit/d0ca5d989390c84bd870c2a2d7a3fd66166f400f))
* new changelog format ([7e69f27](https://github.com/ffMathy/hey-jarvis/commit/7e69f27e53b61ff5c5412ded5792db178d96b439))
* proper architecture ([1443e60](https://github.com/ffMathy/hey-jarvis/commit/1443e6018d4f349496bf4369c6a9ced6eb8df868))
* proper env check ([38fbdff](https://github.com/ffMathy/hey-jarvis/commit/38fbdffff65caee985a04f9d03dd7fa542140eff))
* reference env from prefix ([11b1213](https://github.com/ffMathy/hey-jarvis/commit/11b12135ff6e20aa89830bb8ca91ef8bd701fbec))
* resolve build issue in dockerfile ([f42508b](https://github.com/ffMathy/hey-jarvis/commit/f42508b18bbdae2c819ff5626453177c17cdc107))
* resolve Jest test failures by compiling TypeScript first with esbuild ([#162](https://github.com/ffMathy/hey-jarvis/issues/162)) ([d0ec7bf](https://github.com/ffMathy/hey-jarvis/commit/d0ec7bfd3a27014874585ed9f7bd9089cb98a839))
* test performance ([d8935de](https://github.com/ffMathy/hey-jarvis/commit/d8935de6f94754476dcf89849704513dcb048b64))
* test url ([9cfd539](https://github.com/ffMathy/hey-jarvis/commit/9cfd53976cca147821d952ea9f649fc0c8b84720))
* test url ([9350533](https://github.com/ffMathy/hey-jarvis/commit/9350533800b953f1a14bbd4efe7a353e27b3f2db))
* tests now truly run via nx too ([cbe44fd](https://github.com/ffMathy/hey-jarvis/commit/cbe44fdbea93edb03f509b7261904db99cae62be))
* update architecture label in Dockerfile ([81e3f86](https://github.com/ffMathy/hey-jarvis/commit/81e3f86d1ebdc74614279bae5f9625efa51c7ad4))

## [3.2.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-addon-v3.1.0...home-assistant-addon-v3.2.0) (2025-11-08)


### Miscellaneous Chores

* **home-assistant-addon:** Synchronize mcp versions

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
