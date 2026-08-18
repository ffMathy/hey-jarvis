# Changelog

## [0.11.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.10.0...home-assistant-voice-firmware-v0.11.0) (2026-08-18)


### Features

* **firmware:** compare the device's playback against ElevenLabs' own recording ([e6b8df0](https://github.com/ffMathy/hey-jarvis/commit/e6b8df003580838f6ed7a6b4a2001152e28c67a2))
* **firmware:** detect stuttering in Jarvis's replies via a recorded round trip ([ddea7b5](https://github.com/ffMathy/hey-jarvis/commit/ddea7b5df5e4d4147379b02b23011c035a05b3cd))
* **firmware:** proactive announcements that open a real conversation ([b47d281](https://github.com/ffMathy/hey-jarvis/commit/b47d281f25c758affec3cda7352f05163c8cbcfd))
* **firmware:** proactive announcements with a VAD-timed silence window ([#658](https://github.com/ffMathy/hey-jarvis/issues/658)) ([bd96991](https://github.com/ffMathy/hey-jarvis/commit/bd969917871505c47908db64d78349670c14c0a4))
* **firmware:** support USB flashing and add WSL toolchain setup ([cb85ef9](https://github.com/ffMathy/hey-jarvis/commit/cb85ef92ece7048896671ef48cad257e9ddfcc85))
* **firmware:** verify playback fidelity against ElevenLabs' own recording ([#625](https://github.com/ffMathy/hey-jarvis/issues/625)) ([a9f607f](https://github.com/ffMathy/hey-jarvis/commit/a9f607f07bd80531c1beb32ebb914bb4091f9890))
* scope credentials to a Jarvis vault, fix WSL toolchain and USB flashing ([#624](https://github.com/ffMathy/hey-jarvis/issues/624)) ([349cbcb](https://github.com/ffMathy/hey-jarvis/commit/349cbcb28d239777e5b0ebc1591b869b69b0d582))
* **secrets:** scope credentials to a dedicated Jarvis vault ([1ea6f3c](https://github.com/ffMathy/hey-jarvis/commit/1ea6f3c430d494f66c8be64a68ca99bc898cf06d))


### Bug Fixes

* **firmware:** avoid size_t underflow in PSRAM delta log ([baa67e1](https://github.com/ffMathy/hey-jarvis/commit/baa67e109e12128003a0b388f1521871eb53940f))
* **firmware:** bring the speaker up before the conversation, not on first audio ([eb0c3d3](https://github.com/ffMathy/hey-jarvis/commit/eb0c3d30c6d72ad720f0ff223ade4f2f5a04efdc))
* **firmware:** eliminate the audio dropouts in Jarvis's replies ([#656](https://github.com/ffMathy/hey-jarvis/issues/656)) ([e80300f](https://github.com/ffMathy/hey-jarvis/commit/e80300f94d44f1dd6b36a5f8fd6e9d8551c245b5))
* **firmware:** eliminate the last audio dropouts — 10/10 clean ([#657](https://github.com/ffMathy/hey-jarvis/issues/657)) ([70baccd](https://github.com/ffMathy/hey-jarvis/commit/70baccd213bc298d3e6030a45bb6da9a314fc234))
* **firmware:** extract audio frames without parsing them as JSON ([4873880](https://github.com/ffMathy/hey-jarvis/commit/4873880f938e0519a833801b7d099795dc7aa8d3))
* **firmware:** let the i2s peripheral drain before playing the reply ([f64845f](https://github.com/ffMathy/hey-jarvis/commit/f64845f6d1178a2634c5b3d7c934efd1494493e8))
* **firmware:** never record while playing, it corrupts the audio being played ([070f5c4](https://github.com/ffMathy/hey-jarvis/commit/070f5c41f1e733eebbb7715f3fcb02484d16b52a))
* **firmware:** prebuffer the opening of each reply, bounded by time ([9c42a67](https://github.com/ffMathy/hey-jarvis/commit/9c42a67b874c9bf4419b60cda76a3395bc0df497))
* **firmware:** raise the activation chime to match the reply volume ([882fc5c](https://github.com/ffMathy/hey-jarvis/commit/882fc5c75c0f6655e6c928734c4c62faf6a41897))
* **firmware:** start the speaker before writing the first audio chunk ([25b3387](https://github.com/ffMathy/hey-jarvis/commit/25b33870a071f7bec400473f8dc8935dfaa9fedd))
* **firmware:** start the wake word engine and clear not_ready at boot ([5375167](https://github.com/ffMathy/hey-jarvis/commit/53751671a544c9657868ed814e884e73f781479a))
* **firmware:** stop audio tags in the transcript reading as missing words ([7133019](https://github.com/ffMathy/hey-jarvis/commit/7133019b7e7610906a7b9553e326de60c2080a9a))
* **firmware:** stop discarding audio the speaker buffer could not take ([8ed1d0e](https://github.com/ffMathy/hey-jarvis/commit/8ed1d0e69ef975c34ae0fed79d682c4604a552b5))
* **firmware:** stop discarding audio the speaker buffer could not take ([#626](https://github.com/ffMathy/hey-jarvis/issues/626)) ([c4fb11f](https://github.com/ffMathy/hey-jarvis/commit/c4fb11f87c4a4c22b068b53077cde6f63701b2a1))
* **firmware:** stop the speaker when the conversation ends ([f1e4c25](https://github.com/ffMathy/hey-jarvis/commit/f1e4c254ace9850d5edc50b2aa7d79c443b676a5))
* **firmware:** stop tracing resolved secrets into the build log ([b41d1ae](https://github.com/ffMathy/hey-jarvis/commit/b41d1ae395c235249fcbe975f2e638b640cfe9b1))
* **firmware:** time the announcement window from VAD, not from ElevenLabs ([8dd0697](https://github.com/ffMathy/hey-jarvis/commit/8dd06972153d68a410ecca5caa8e55d4740d8b25))
* **firmware:** use a pro model for the comparison, and corroborate it deterministically ([30d5b3d](https://github.com/ffMathy/hey-jarvis/commit/30d5b3d653031f556ab6a0ec6cb776674cd3795d))
* **firmware:** wait for the activation chime on every conversation ([e6b847b](https://github.com/ffMathy/hey-jarvis/commit/e6b847bfb2c533408a6aedfaaa6b0c752270ae25))
* **firmware:** wait until the device is listening before speaking the command ([8a8174c](https://github.com/ffMathy/hey-jarvis/commit/8a8174ca46619faa59f1dd9c1cb3c8c7087065a0))


### Documentation

* **firmware:** document registering the voice device in home assistant ([5eb59c1](https://github.com/ffMathy/hey-jarvis/commit/5eb59c18079bde7f3918204d9ddd56e7b45b4ec8))
* **firmware:** record what the wake word test verified, and its limitation ([c0ae619](https://github.com/ffMathy/hey-jarvis/commit/c0ae61951b536eb223c3c4d9e8f426318d32cf89))

## [0.10.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.9.1...home-assistant-voice-firmware-v0.10.0) (2026-03-15)


### Features

* nx to turborepo, typescript over javascript ([#563](https://github.com/ffMathy/hey-jarvis/issues/563)) ([bd8015c](https://github.com/ffMathy/hey-jarvis/commit/bd8015c3912e3a39d5da7bca0a74d0a6295112dd))


### Bug Fixes

* replace contradictory Nx guidelines with Turborepo in AGENTS.md ([#566](https://github.com/ffMathy/hey-jarvis/issues/566)) ([5f08fee](https://github.com/ffMathy/hey-jarvis/commit/5f08feed67a9c744b7de4cf70c303460d59cad83))
* turborepo migration ([cc816d5](https://github.com/ffMathy/hey-jarvis/commit/cc816d5aafc8ca090f296b9daf851ac1b8f27c05))


### Documentation

* migrate AGENTS.md NX references to Turborepo ([#567](https://github.com/ffMathy/hey-jarvis/issues/567)) ([baa5d85](https://github.com/ffMathy/hey-jarvis/commit/baa5d85742ef3dfb8f3f8f100c2d1eeed91b7ea7))
* replace bunx nx commands with bunx turbo equivalents in AGENTS.md ([#565](https://github.com/ffMathy/hey-jarvis/issues/565)) ([1e6c61b](https://github.com/ffMathy/hey-jarvis/commit/1e6c61b9bb15bfc78d6dc384ee63e4741a017853))

## [0.9.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.9.0...home-assistant-voice-firmware-v0.9.1) (2026-02-25)


### Documentation

* better documentation ([34b180c](https://github.com/ffMathy/hey-jarvis/commit/34b180c5d6d8f0aa33a41e2034a5252aae18ae88))
* improve documentation ([#527](https://github.com/ffMathy/hey-jarvis/issues/527)) ([198cfd2](https://github.com/ffMathy/hey-jarvis/commit/198cfd2a06fd17dfb70e99f5b84ad851970d0c43))
* optimize AI documentation ([e2b83c2](https://github.com/ffMathy/hey-jarvis/commit/e2b83c25c34e2ccb8ce274cb11c1cef0ca58b3ef))
* optimize AI documentation ([#509](https://github.com/ffMathy/hey-jarvis/issues/509)) ([7637f29](https://github.com/ffMathy/hey-jarvis/commit/7637f295dfc586a485807521216689b794cd5dd1))

## [0.9.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.8.0...home-assistant-voice-firmware-v0.9.0) (2026-02-21)


### Features

* new improvements ([#504](https://github.com/ffMathy/hey-jarvis/issues/504)) ([4826bdb](https://github.com/ffMathy/hey-jarvis/commit/4826bdbfcc06470e5f1c68940b3539f1077283bd))


### Bug Fixes

* log catch-block errors and add env:local Turborepo tasks for 1Password secret resolution ([#505](https://github.com/ffMathy/hey-jarvis/issues/505)) ([a9aae83](https://github.com/ffMathy/hey-jarvis/commit/a9aae833a79748ec61d4c2aa64b7fb7cd7a1fad1))
* log errors in catch blocks and add env:local Turborepo tasks for all projects ([49453f0](https://github.com/ffMathy/hey-jarvis/commit/49453f0067dfb6bf7822ef77e8c9bbdec3ca15f5))
* much better environment interpolation ([c6f4aab](https://github.com/ffMathy/hey-jarvis/commit/c6f4aab1a923b6d86b724527ea95a25a7e439727))

## [0.8.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.7.2...home-assistant-voice-firmware-v0.8.0) (2026-02-20)


### Features

* better AI, better build ([c1ad34d](https://github.com/ffMathy/hey-jarvis/commit/c1ad34de97115d464839aceae0284e23db27feaa))


### Bug Fixes

* build errors fixed ([#485](https://github.com/ffMathy/hey-jarvis/issues/485)) ([ee88eec](https://github.com/ffMathy/hey-jarvis/commit/ee88eec013bdb1e3cb8fca65c4f1cda49f51a2c3))

## [0.7.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.7.1...home-assistant-voice-firmware-v0.7.2) (2026-01-12)


### Bug Fixes

* **wake-word:** add VAD model and full URLs for wake word models ([6ab1ee9](https://github.com/ffMathy/hey-jarvis/commit/6ab1ee9baf5a14b6f4be7fab064378e7148849b7))
* **wake-word:** add VAD model and full URLs for wake word models ([#465](https://github.com/ffMathy/hey-jarvis/issues/465)) ([b9c25a3](https://github.com/ffMathy/hey-jarvis/commit/b9c25a3c6d41fa7485d23a7961558af55fb77b02))


### Documentation

* **wake-word:** add comprehensive testing and troubleshooting guide ([cae8223](https://github.com/ffMathy/hey-jarvis/commit/cae8223ec4709bcc2248c171b44d1ad3f1f7e13c))
* **wake-word:** add wake word troubleshooting section to README ([5d149c8](https://github.com/ffMathy/hey-jarvis/commit/5d149c834591e14842694ba4cb27f70ad0160596))

## [0.7.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.7.0...home-assistant-voice-firmware-v0.7.1) (2026-01-08)


### Bug Fixes

* new ingress relay ([57c2e0a](https://github.com/ffMathy/hey-jarvis/commit/57c2e0a9c639e3b10b4d4678446baf48fa5f63b7))
* new ingress relay ([#441](https://github.com/ffMathy/hey-jarvis/issues/441)) ([27da5a9](https://github.com/ffMathy/hey-jarvis/commit/27da5a9a9f8c01d9736a810e09ca4fe1e3339ca6))

## [0.7.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.6.0...home-assistant-voice-firmware-v0.7.0) (2025-12-05)


### Features

* **devcontainer:** add ESPHome-friendly VS Code settings for syntax highlighting ([c667d40](https://github.com/ffMathy/hey-jarvis/commit/c667d403f504e1e3187313a7f7323116e9acf6c7))
* **devcontainer:** Add ESPHome-friendly VS Code settings for syntax highlighting ([#396](https://github.com/ffMathy/hey-jarvis/issues/396)) ([b3aee6e](https://github.com/ffMathy/hey-jarvis/commit/b3aee6e3dcddf068d91a03baa37f5b351ead2404))

## [0.6.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.5.0...home-assistant-voice-firmware-v0.6.0) (2025-11-29)


### Features

* add lint-staged to husky pre-commit and global lint dependencies ([4bb4777](https://github.com/ffMathy/hey-jarvis/commit/4bb4777aeb8e9db1e5537b25c81ebd3249e3eb0e))
* add lint-staged to husky pre-commit and global lint dependencies ([#343](https://github.com/ffMathy/hey-jarvis/issues/343)) ([83f5fe8](https://github.com/ffMathy/hey-jarvis/commit/83f5fe8c630ece3f2086baeb9e81e28ddcae2d98))
* **mcp:** add LLM-evaluated tests for routing workflows DAG generation ([318cba4](https://github.com/ffMathy/hey-jarvis/commit/318cba435b427cc72264cbbf76a45161464f2031))


### Bug Fixes

* revert unintentional formatting changes and remove cloudflared.deb ([aa47eaf](https://github.com/ffMathy/hey-jarvis/commit/aa47eafa733892a4663f76a9c888551d2d9591c6))


### Documentation

* consolidate shared guidelines into root AGENTS.md ([323c906](https://github.com/ffMathy/hey-jarvis/commit/323c906419c4fde60aa0ffcdb5b0c55317143ccc))
* consolidate shared guidelines into root AGENTS.md ([#345](https://github.com/ffMathy/hey-jarvis/issues/345)) ([5d5366c](https://github.com/ffMathy/hey-jarvis/commit/5d5366c1fe074d90c0a8dd7a5520c3932a361139))

## [0.5.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.4.2...home-assistant-voice-firmware-v0.5.0) (2025-11-28)


### Features

* human in the loop ([#313](https://github.com/ffMathy/hey-jarvis/issues/313)) ([c047d6c](https://github.com/ffMathy/hey-jarvis/commit/c047d6cff761256ae38b9a26a8df1563f1b14678))
* introduce human in the loop ([9f1b714](https://github.com/ffMathy/hey-jarvis/commit/9f1b714a3786be2fc2858eeafeb22d08792339de))
* **mcp:** add async orchestration routing vertical ([#331](https://github.com/ffMathy/hey-jarvis/issues/331)) ([79d5c76](https://github.com/ffMathy/hey-jarvis/commit/79d5c76eea37b74a9fc195006f51d8885ac81c90))


### Bug Fixes

* latest memory fixes ([7848a51](https://github.com/ffMathy/hey-jarvis/commit/7848a519b896185c16ced33feafefe47ef117615))
* more memory fixes ([f6e07a7](https://github.com/ffMathy/hey-jarvis/commit/f6e07a739a6090bcf6b08591af11a1873069266d))
* switch to new MCP setup and make windows versions of scripts ([740b855](https://github.com/ffMathy/hey-jarvis/commit/740b8554447f016dbda32296391ee6092fe369dd))
* various elevenlabs and home assistant firmware fixes ([#324](https://github.com/ffMathy/hey-jarvis/issues/324)) ([c197be0](https://github.com/ffMathy/hey-jarvis/commit/c197be0a3de502dfa5042288dc9a71a3547ba5a9))

## [0.4.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.4.1...home-assistant-voice-firmware-v0.4.2) (2025-11-22)


### Documentation

* Update CHANGELOG.md ([2acc76e](https://github.com/ffMathy/hey-jarvis/commit/2acc76e692aae840f51263f7c26a42a473297de4))
* Update CHANGELOG.md ([#281](https://github.com/ffMathy/hey-jarvis/issues/281)) ([aa2b74a](https://github.com/ffMathy/hey-jarvis/commit/aa2b74a599bf8ba9a9770aa5f25b9629ffc8eaa4))

## [0.4.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.4.0...home-assistant-voice-firmware-v0.4.1) (2025-11-22)


### Bug Fixes

* **workflows:** wrap recipes array in object for meal plan validation ([26db98f](https://github.com/ffMathy/hey-jarvis/commit/26db98f924bf6cbf7e49de61a929f04c8ff0ce26))
* **workflows:** wrap recipes array in object for step input validation ([#278](https://github.com/ffMathy/hey-jarvis/issues/278)) ([b393089](https://github.com/ffMathy/hey-jarvis/commit/b39308950160c513f29220d4f14dac310aa148f5))

## [0.4.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.3.0...home-assistant-voice-firmware-v0.4.0) (2025-11-22)


### Features

* allow for wifi flashing ([1a2507b](https://github.com/ffMathy/hey-jarvis/commit/1a2507b93ac31473419588f644fc115e72f7e185))


### Bug Fixes

* better stability for some projects ([33f8cf2](https://github.com/ffMathy/hey-jarvis/commit/33f8cf29daea5354090264d9b04974eafb3233be))
* new progress on verticals ([4a5323f](https://github.com/ffMathy/hey-jarvis/commit/4a5323fe875aba3d0bb0cbef495ff926fca495a1))

## [0.3.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.2.0...home-assistant-voice-firmware-v0.3.0) (2025-11-20)


### Features

* much better coding agent ([#259](https://github.com/ffMathy/hey-jarvis/issues/259)) ([5477b1f](https://github.com/ffMathy/hey-jarvis/commit/5477b1f312cbf568952dc89dbf46c2291e7df25a))

## [0.2.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.1.2...home-assistant-voice-firmware-v0.2.0) (2025-11-20)


### Features

* enhance 1Password authentication and terminal session managemen… ([#251](https://github.com/ffMathy/hey-jarvis/issues/251)) ([ec808be](https://github.com/ffMathy/hey-jarvis/commit/ec808be26efb82d0b4d491ea367f4f1f6eecacd8))

## [0.1.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.1.1...home-assistant-voice-firmware-v0.1.2) (2025-11-19)


### Bug Fixes

* **env:** update GitHub API token reference in op.env ([#236](https://github.com/ffMathy/hey-jarvis/issues/236)) ([d841ea7](https://github.com/ffMathy/hey-jarvis/commit/d841ea787ce385c027117c4c6e2b12157ee695ea))

## [0.1.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.1.0...home-assistant-voice-firmware-v0.1.1) (2025-11-18)


### Bug Fixes

* **mcp:** use bunx for mastra CLI in Docker startup script ([#226](https://github.com/ffMathy/hey-jarvis/issues/226)) ([cc5a924](https://github.com/ffMathy/hey-jarvis/commit/cc5a92412361b194f32c73fa32f877260cfad370))

## 0.1.0 (2025-11-18)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* add shared functions to start MCP servers ([#222](https://github.com/ffMathy/hey-jarvis/issues/222)) ([8cfd97d](https://github.com/ffMathy/hey-jarvis/commit/8cfd97d1d83443d52af2ef232c69ebc45f8d82db))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([307ac9e](https://github.com/ffMathy/hey-jarvis/commit/307ac9e008d438f1d07c37694bc5afb0dbf47f5e))
* home assistant voice building ([#187](https://github.com/ffMathy/hey-jarvis/issues/187)) ([9f17536](https://github.com/ffMathy/hey-jarvis/commit/9f17536aec616e71fee8a5654f3cf83a5113c7b8))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* introduce home assistant voice firmware ([af1ac84](https://github.com/ffMathy/hey-jarvis/commit/af1ac8451c9b23f25c0eac6433e99924442e1024))
* migrate from NPM to Bun for package management ([5455985](https://github.com/ffMathy/hey-jarvis/commit/54559850929c9dc36fbada4661dede0336cafa6d))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))
* **notification:** add proactive notification workflow with ElevenLabs integration ([c620f2e](https://github.com/ffMathy/hey-jarvis/commit/c620f2ec000c289bc0e8a207b47607cec9a44231))


### Bug Fixes

* broken build commands for turbo ([23f70c1](https://github.com/ffMathy/hey-jarvis/commit/23f70c1dc7b395f8c030f0c5d00da64afa877c7c))
* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([31783be](https://github.com/ffMathy/hey-jarvis/commit/31783bee891a4e9698795108a6730268e41299c0))
* progress on stability and tests ([082660f](https://github.com/ffMathy/hey-jarvis/commit/082660f8b5bd0db869ef0d4ece56bc01eee5eb54))
* reference env from prefix ([11b1213](https://github.com/ffMathy/hey-jarvis/commit/11b12135ff6e20aa89830bb8ca91ef8bd701fbec))
* **release-please:** correct pattern syntax and resolve blocking issues ([#185](https://github.com/ffMathy/hey-jarvis/issues/185)) ([cd1cef8](https://github.com/ffMathy/hey-jarvis/commit/cd1cef861687d9be48d09efffd883ac843d7be0e))


### Documentation

* add comprehensive documentation and improve notification tool ([7e00e4d](https://github.com/ffMathy/hey-jarvis/commit/7e00e4d342f2ab18efdd3b8624f534cc86c6375b))
* add Conventional Commits guidelines to all coding files ([95b1319](https://github.com/ffMathy/hey-jarvis/commit/95b131978f9d5e977a9c94789e3cc869aab3d20e))
* better documentation ([a165dd9](https://github.com/ffMathy/hey-jarvis/commit/a165dd95fea0425b6d9158d48f60519bf2465fbb))

## [0.8.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.7.0...home-assistant-voice-firmware-v0.8.0) (2025-11-13)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([307ac9e](https://github.com/ffMathy/hey-jarvis/commit/307ac9e008d438f1d07c37694bc5afb0dbf47f5e))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* introduce home assistant voice firmware ([af1ac84](https://github.com/ffMathy/hey-jarvis/commit/af1ac8451c9b23f25c0eac6433e99924442e1024))
* migrate from NPM to Bun for package management ([5455985](https://github.com/ffMathy/hey-jarvis/commit/54559850929c9dc36fbada4661dede0336cafa6d))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))
* **notification:** add proactive notification workflow with ElevenLabs integration ([c620f2e](https://github.com/ffMathy/hey-jarvis/commit/c620f2ec000c289bc0e8a207b47607cec9a44231))


### Bug Fixes

* broken build commands for turbo ([23f70c1](https://github.com/ffMathy/hey-jarvis/commit/23f70c1dc7b395f8c030f0c5d00da64afa877c7c))
* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([31783be](https://github.com/ffMathy/hey-jarvis/commit/31783bee891a4e9698795108a6730268e41299c0))
* progress on stability and tests ([082660f](https://github.com/ffMathy/hey-jarvis/commit/082660f8b5bd0db869ef0d4ece56bc01eee5eb54))
* reference env from prefix ([11b1213](https://github.com/ffMathy/hey-jarvis/commit/11b12135ff6e20aa89830bb8ca91ef8bd701fbec))
* **release-please:** correct pattern syntax and resolve blocking issues ([#185](https://github.com/ffMathy/hey-jarvis/issues/185)) ([cd1cef8](https://github.com/ffMathy/hey-jarvis/commit/cd1cef861687d9be48d09efffd883ac843d7be0e))


### Documentation

* add comprehensive documentation and improve notification tool ([7e00e4d](https://github.com/ffMathy/hey-jarvis/commit/7e00e4d342f2ab18efdd3b8624f534cc86c6375b))
* add Conventional Commits guidelines to all coding files ([95b1319](https://github.com/ffMathy/hey-jarvis/commit/95b131978f9d5e977a9c94789e3cc869aab3d20e))
* better documentation ([a165dd9](https://github.com/ffMathy/hey-jarvis/commit/a165dd95fea0425b6d9158d48f60519bf2465fbb))

## [0.7.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.6.0...home-assistant-voice-firmware-v0.7.0) (2025-11-08)


### Features

* **notification:** add proactive notification workflow with ElevenLabs integration ([9bc4bfd](https://github.com/ffMathy/hey-jarvis/commit/9bc4bfd4a9f1cf450c506219ea720c384f00d471))


### Documentation

* add comprehensive documentation and improve notification tool ([97fe5ce](https://github.com/ffMathy/hey-jarvis/commit/97fe5ce28db180dc799d0858bae8f61874aa69c9))

## [0.6.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.5.0...home-assistant-voice-firmware-v0.6.0) (2025-11-06)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* introduce home assistant voice firmware ([af1ac84](https://github.com/ffMathy/hey-jarvis/commit/af1ac8451c9b23f25c0eac6433e99924442e1024))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))


### Bug Fixes

* broken build commands for turbo ([23f70c1](https://github.com/ffMathy/hey-jarvis/commit/23f70c1dc7b395f8c030f0c5d00da64afa877c7c))
* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([b1029ed](https://github.com/ffMathy/hey-jarvis/commit/b1029ed0d19222d5a98befe513ba474a9b518c13))
* progress on stability and tests ([0692649](https://github.com/ffMathy/hey-jarvis/commit/069264952fd76864a39da98d55bf64d1c36b5eba))
* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))


### Documentation

* add Conventional Commits guidelines to all coding files ([e2871ee](https://github.com/ffMathy/hey-jarvis/commit/e2871ee3901c2b89921ca61898aced48922c3d55))
* better documentation ([a165dd9](https://github.com/ffMathy/hey-jarvis/commit/a165dd95fea0425b6d9158d48f60519bf2465fbb))

## [0.5.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.4.3...home-assistant-voice-firmware-v0.5.0) (2025-11-06)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* introduce home assistant voice firmware ([af1ac84](https://github.com/ffMathy/hey-jarvis/commit/af1ac8451c9b23f25c0eac6433e99924442e1024))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))


### Bug Fixes

* broken build commands for turbo ([23f70c1](https://github.com/ffMathy/hey-jarvis/commit/23f70c1dc7b395f8c030f0c5d00da64afa877c7c))
* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([b1029ed](https://github.com/ffMathy/hey-jarvis/commit/b1029ed0d19222d5a98befe513ba474a9b518c13))
* progress on stability and tests ([0692649](https://github.com/ffMathy/hey-jarvis/commit/069264952fd76864a39da98d55bf64d1c36b5eba))
* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))


### Documentation

* add Conventional Commits guidelines to all coding files ([e2871ee](https://github.com/ffMathy/hey-jarvis/commit/e2871ee3901c2b89921ca61898aced48922c3d55))
* better documentation ([a165dd9](https://github.com/ffMathy/hey-jarvis/commit/a165dd95fea0425b6d9158d48f60519bf2465fbb))

## [0.4.3](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.4.2...home-assistant-voice-firmware-v0.4.3) (2025-11-06)


### Documentation

* add Conventional Commits guidelines to all coding files ([e2871ee](https://github.com/ffMathy/hey-jarvis/commit/e2871ee3901c2b89921ca61898aced48922c3d55))

## [0.4.2](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.4.1...home-assistant-voice-firmware-v0.4.2) (2025-11-05)


### Bug Fixes

* progress on stability and tests ([0692649](https://github.com/ffMathy/hey-jarvis/commit/069264952fd76864a39da98d55bf64d1c36b5eba))

## [0.4.1](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.4.0...home-assistant-voice-firmware-v0.4.1) (2025-10-14)


### Bug Fixes

* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([b1029ed](https://github.com/ffMathy/hey-jarvis/commit/b1029ed0d19222d5a98befe513ba474a9b518c13))

## [0.4.0](https://github.com/ffMathy/hey-jarvis/compare/home-assistant-voice-firmware-v0.3.0...home-assistant-voice-firmware-v0.4.0) (2025-10-02)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* introduce home assistant voice firmware ([af1ac84](https://github.com/ffMathy/hey-jarvis/commit/af1ac8451c9b23f25c0eac6433e99924442e1024))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))


### Bug Fixes

* broken build commands for turbo ([23f70c1](https://github.com/ffMathy/hey-jarvis/commit/23f70c1dc7b395f8c030f0c5d00da64afa877c7c))
* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))


### Documentation

* better documentation ([a165dd9](https://github.com/ffMathy/hey-jarvis/commit/a165dd95fea0425b6d9158d48f60519bf2465fbb))

## [0.3.0](https://github.com/ffMathy/hey-jarvis/compare/v0.2.1...v0.3.0) (2025-10-02)


### Features

* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))

## [0.2.1](https://github.com/ffMathy/hey-jarvis/compare/v0.2.0...v0.2.1) (2025-09-30)


### Bug Fixes

* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))

## [0.2.0](https://github.com/ffMathy/hey-jarvis/compare/v0.1.0...v0.2.0) (2025-09-30)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* introduce home assistant voice firmware ([af1ac84](https://github.com/ffMathy/hey-jarvis/commit/af1ac8451c9b23f25c0eac6433e99924442e1024))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))


### Bug Fixes

* broken build commands for turbo ([23f70c1](https://github.com/ffMathy/hey-jarvis/commit/23f70c1dc7b395f8c030f0c5d00da64afa877c7c))


### Documentation

* better documentation ([a165dd9](https://github.com/ffMathy/hey-jarvis/commit/a165dd95fea0425b6d9158d48f60519bf2465fbb))
