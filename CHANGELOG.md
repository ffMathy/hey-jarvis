# Changelog

## [1.3.0](https://github.com/ffMathy/hey-jarvis/compare/root-v1.2.1...root-v1.3.0) (2025-11-06)


### Features

* infer Zod types from Octokit, add auth, defaults, and fix tool descriptions ([951f343](https://github.com/ffMathy/hey-jarvis/commit/951f3434365c6b2a9790e03834859e72e510320f))

## [1.2.1](https://github.com/ffMathy/hey-jarvis/compare/root-v1.2.0...root-v1.2.1) (2025-11-05)


### Bug Fixes

* add missing environment variable ([92cf492](https://github.com/ffMathy/hey-jarvis/commit/92cf4922f7a50455076f0983214de893951e0aa1))
* added node options ([31c990a](https://github.com/ffMathy/hey-jarvis/commit/31c990aa5660a82ce0266647ad2321b01cf9c259))
* always test via gemini ([e726be9](https://github.com/ffMathy/hey-jarvis/commit/e726be9071efdf41c858d1e6766d698bd49bc7ed))
* better compile ([703234d](https://github.com/ffMathy/hey-jarvis/commit/703234d880a82482c306805f7df2b7dae0c1388f))
* better prompt without pause before "sir" ([53b7158](https://github.com/ffMathy/hey-jarvis/commit/53b71580a3ddb17c53b9b78062b0c4f1760bac54))
* better tests ([28c0ad1](https://github.com/ffMathy/hey-jarvis/commit/28c0ad1c9a8b1f95b5b491d37b2ba34edf47cbed))
* build issues ([7331da7](https://github.com/ffMathy/hey-jarvis/commit/7331da71f2d8c3b862cc8e0b948ae7ba76ebea38))
* comment out scorers temporarily ([b239987](https://github.com/ffMathy/hey-jarvis/commit/b239987a932e363bebfff76bc25cf81a40cb6a23))
* dependabot grouping and fixes ([0e83adf](https://github.com/ffMathy/hey-jarvis/commit/0e83adfed9cb5d79aadac3a985d77530d8ab5118))
* dockerfile now works ([630fc68](https://github.com/ffMathy/hey-jarvis/commit/630fc689598fca2e4e1e135f39a93e330ab9e299))
* don't contradict prompt ([1276d8a](https://github.com/ffMathy/hey-jarvis/commit/1276d8aaaa4452e1796d1ce8672383389542a932))
* jarvis tests around prompt ([db1ff1e](https://github.com/ffMathy/hey-jarvis/commit/db1ff1e62ff18bd18535f11260e2aa3d7b7b48f4))
* linting ([ca38675](https://github.com/ffMathy/hey-jarvis/commit/ca38675952473e5be69d7583a881dcb147357d26))
* more contradiction fixes ([2b1ba15](https://github.com/ffMathy/hey-jarvis/commit/2b1ba15245d8c909840edf6ac88777bef84bf5e3))
* progress on full transcript ([299a5ba](https://github.com/ffMathy/hey-jarvis/commit/299a5ba43b2126556a053daf5b67e2a0244a8a1b))
* progress on jest integration ([ded72e3](https://github.com/ffMathy/hey-jarvis/commit/ded72e3d33d87ba0d6f94523549375c5979c6ec0))
* progress on stability and tests ([0692649](https://github.com/ffMathy/hey-jarvis/commit/069264952fd76864a39da98d55bf64d1c36b5eba))
* refactor to use strategy pattern ([dea5284](https://github.com/ffMathy/hey-jarvis/commit/dea52843e2ed7b398e1b073a5b24d0a598c70230))
* remove root project JSON ([d4bc057](https://github.com/ffMathy/hey-jarvis/commit/d4bc05799ddd4ab9e9ba2f74105c944aa6dba498))
* remove usual grouping of dependencies ([01677c0](https://github.com/ffMathy/hey-jarvis/commit/01677c09d8791f22f5483175ee66a6223bcb192c))
* resolve build issue in dockerfile ([5f92e5a](https://github.com/ffMathy/hey-jarvis/commit/5f92e5a830540c43b523e863ca53a71be5664ea2))
* serve now works ([a906895](https://github.com/ffMathy/hey-jarvis/commit/a906895dfc5574a59add7ac7cfc16794beab524b))
* support weather API ([9d7ad5b](https://github.com/ffMathy/hey-jarvis/commit/9d7ad5b8cc6d5dc030076243ab07e54deba65fa0))
* target op ([042aca0](https://github.com/ffMathy/hey-jarvis/commit/042aca0e92c80170a7e493d586d11c1692dc9bd3))
* tests improved ([fef11d4](https://github.com/ffMathy/hey-jarvis/commit/fef11d4953112c80728ab89012b6e1f50e3d5440))
* tests pass ([ea6d749](https://github.com/ffMathy/hey-jarvis/commit/ea6d749376f1e951290abfea4f142c84278b0d66))
* update CI ([f013777](https://github.com/ffMathy/hey-jarvis/commit/f0137773a26c035ffc755e6230fa6c71470645cb))
* update groups to be more specific ([de044ec](https://github.com/ffMathy/hey-jarvis/commit/de044ece18d6801e6a757de0b43a3f209f003d69))
* update tsconfig to be ESM based ([8f758e8](https://github.com/ffMathy/hey-jarvis/commit/8f758e80d77f801fe95dc30dcd661d90bbbb5e1d))


### Performance Improvements

* add parallelism ([c4bcbdb](https://github.com/ffMathy/hey-jarvis/commit/c4bcbdb619c55f2efce2ebf59935664ac32dfd5f))

## [1.2.0](https://github.com/ffMathy/hey-jarvis/compare/root-v1.1.1...root-v1.2.0) (2025-10-20)


### Features

* new test suite and prompt ([#83](https://github.com/ffMathy/hey-jarvis/issues/83)) ([4663765](https://github.com/ffMathy/hey-jarvis/commit/46637654bb80d99dee9dee14d51d83b701fde01b))

## [1.1.1](https://github.com/ffMathy/hey-jarvis/compare/root-v1.1.0...root-v1.1.1) (2025-10-14)


### Bug Fixes

* don't log in to registry on build ([#76](https://github.com/ffMathy/hey-jarvis/issues/76)) ([65f17cc](https://github.com/ffMathy/hey-jarvis/commit/65f17ccb7a6db37c6acb0dfcc4afd0c468dec7a5))

## [1.1.0](https://github.com/ffMathy/hey-jarvis/compare/root-v1.0.3...root-v1.1.0) (2025-10-14)


### Features

* add environment variable configuration support to Home Assistant addon ([#59](https://github.com/ffMathy/hey-jarvis/issues/59)) ([a7fae30](https://github.com/ffMathy/hey-jarvis/commit/a7fae30e99beebc43ff145c4e679d69844f4ed45))

## [1.0.3](https://github.com/ffMathy/hey-jarvis/compare/root-v1.0.2...root-v1.0.3) (2025-10-14)


### Bug Fixes

* ARM64 runtime error in Home Assistant by replacing Fastembed with Gemini embeddings ([#61](https://github.com/ffMathy/hey-jarvis/issues/61)) ([e0fc3c0](https://github.com/ffMathy/hey-jarvis/commit/e0fc3c0255fe38ef817083f4792de0a612f3a60a))
* switch to read permissions ([#72](https://github.com/ffMathy/hey-jarvis/issues/72)) ([5ab5ccb](https://github.com/ffMathy/hey-jarvis/commit/5ab5ccb6db5abf436fbeb35a473554c9456b6aa3))

## [1.0.2](https://github.com/ffMathy/hey-jarvis/compare/root-v1.0.1...root-v1.0.2) (2025-10-14)


### Bug Fixes

* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([b1029ed](https://github.com/ffMathy/hey-jarvis/commit/b1029ed0d19222d5a98befe513ba474a9b518c13))
* pass environment variables properly ([7b0bdd6](https://github.com/ffMathy/hey-jarvis/commit/7b0bdd6795d65032a9e600cff13574a5d6f56586))

## [1.0.1](https://github.com/ffMathy/hey-jarvis/compare/root-v1.0.0...root-v1.0.1) (2025-10-07)


### Bug Fixes

* top-level await error preventing Home Assistant addon from starting ([#54](https://github.com/ffMathy/hey-jarvis/issues/54)) ([a78b5b3](https://github.com/ffMathy/hey-jarvis/commit/a78b5b3d3c025d868882fbfd3dba03a45e96b279))

## [1.0.0](https://github.com/ffMathy/hey-jarvis/compare/root-v0.4.2...root-v1.0.0) (2025-10-04)


### ⚠ BREAKING CHANGES

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51))

### Bug Fixes

* change version detection ([#51](https://github.com/ffMathy/hey-jarvis/issues/51)) ([0190cc9](https://github.com/ffMathy/hey-jarvis/commit/0190cc9332ff27a79d7dc34ca0f26539cb5a3b48))

## [0.4.2](https://github.com/ffMathy/hey-jarvis/compare/root-v0.4.1...root-v0.4.2) (2025-10-04)


### Bug Fixes

* architecture building ([#49](https://github.com/ffMathy/hey-jarvis/issues/49)) ([151a490](https://github.com/ffMathy/hey-jarvis/commit/151a49053e44296eb0bf28df4e0723eda87e9e11))

## [0.4.1](https://github.com/ffMathy/hey-jarvis/compare/root-v0.4.0...root-v0.4.1) (2025-10-02)


### Bug Fixes

* remove invalid package.json ([#47](https://github.com/ffMathy/hey-jarvis/issues/47)) ([0ee44c0](https://github.com/ffMathy/hey-jarvis/commit/0ee44c0d52cb562af03ffa74ebd70943a78ee620))

## [0.4.0](https://github.com/ffMathy/hey-jarvis/compare/root-v0.3.3...root-v0.4.0) (2025-10-02)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* add docker-in-docker ([66aaafc](https://github.com/ffMathy/hey-jarvis/commit/66aaafc6cdd5d5fbf7d593131117c14816036898))
* add new project and deploy pipeline ([857dd8a](https://github.com/ffMathy/hey-jarvis/commit/857dd8a7290100f31984d7a94fd822f85f2a1987))
* added latest jarvis prompt ([a035701](https://github.com/ffMathy/hey-jarvis/commit/a035701fee0448ee492c275b01de2a554f7ff43e))
* allow for deploy of jarvis in elevenlabs from prompt ([bd5e35a](https://github.com/ffMathy/hey-jarvis/commit/bd5e35aabee9157326cb351996bf29816cce8962))
* bump release to trigger new versions ([124c40a](https://github.com/ffMathy/hey-jarvis/commit/124c40aea32cecdc100bba92be17ef5d75f0f192))
* devcontainer introduced ([e92340f](https://github.com/ffMathy/hey-jarvis/commit/e92340fa489abe4f38649639e01b8deba41c74cc))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* include version in release PR titles ([c779407](https://github.com/ffMathy/hey-jarvis/commit/c77940723c79fbd5eef797f49f145c5852b92145))
* initial n8n agent converted to mastra ([942c7d2](https://github.com/ffMathy/hey-jarvis/commit/942c7d23a7d6118c960fcbf5f343d1ffc9fa5de2))
* introduce home assistant voice firmware ([af1ac84](https://github.com/ffMathy/hey-jarvis/commit/af1ac8451c9b23f25c0eac6433e99924442e1024))
* introduce mastra AI for jarvis-mcp ([d4dfca4](https://github.com/ffMathy/hey-jarvis/commit/d4dfca46d82ef3296273121b40930e8795354f46))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))
* n8n weather agent ([6b62e05](https://github.com/ffMathy/hey-jarvis/commit/6b62e05734179923efba6fbccfa21a9c395652f0))
* NX support for DevX ([03fbc56](https://github.com/ffMathy/hey-jarvis/commit/03fbc56575fc5ddc3b8b41cefcc15feb5ab1fb39))
* scorers added ([318e63f](https://github.com/ffMathy/hey-jarvis/commit/318e63f36ac422f99d7c456e632f72cc7dc2bd12))
* update release-please config with initial versions to reset state ([df008d1](https://github.com/ffMathy/hey-jarvis/commit/df008d107802211400e04d815f7e0696adb81a8c))
* weather agent ([f82bc31](https://github.com/ffMathy/hey-jarvis/commit/f82bc31807a33dbd03a18babbe9bd56e25e9762a))
* weather agent in Mastra ([f61e5ba](https://github.com/ffMathy/hey-jarvis/commit/f61e5baa2b023084fc1d61ae59b683099c5ed928))


### Bug Fixes

* 403 Docker build errors by using locally built base images ([#29](https://github.com/ffMathy/hey-jarvis/issues/29)) ([2af6a45](https://github.com/ffMathy/hey-jarvis/commit/2af6a45188878cfc16291454b07ff564f1a0c032))
* add git status to agents ([da32732](https://github.com/ffMathy/hey-jarvis/commit/da32732750a19616f550d992e4c662f6ae8d47a4))
* add github CLI ([b4da3a2](https://github.com/ffMathy/hey-jarvis/commit/b4da3a22f272e913ce8976731f51246c87d8fe67))
* add missing environment variables to DevContainer ([4cc0b15](https://github.com/ffMathy/hey-jarvis/commit/4cc0b152e4f5fe5807548180fdb746ea1d90add7))
* add missing package json ([#45](https://github.com/ffMathy/hey-jarvis/issues/45)) ([69d72a1](https://github.com/ffMathy/hey-jarvis/commit/69d72a1d5779a47da2eb6914bc0101a8b0f38941))
* add missing package.json ([8114f0d](https://github.com/ffMathy/hey-jarvis/commit/8114f0d2a2aba5dbcf3d9cb87233182f6fbf2abc))
* added search functionality ([8a2b357](https://github.com/ffMathy/hey-jarvis/commit/8a2b3576ff9ccba7c02551f432bd8997e3943a7d))
* attempt at variable substitution ([7f3cbce](https://github.com/ffMathy/hey-jarvis/commit/7f3cbcebec69a3a322e2d1edf655e3252dd95b64))
* bad formatting ([2a81426](https://github.com/ffMathy/hey-jarvis/commit/2a814264aacfd6e437e33047fec46b6c521dcc11))
* better deploy script ([#40](https://github.com/ffMathy/hey-jarvis/issues/40)) ([ae7a673](https://github.com/ffMathy/hey-jarvis/commit/ae7a67396bd900f0a4b9e44182d2fe8ea7836703))
* better env parsing ([#33](https://github.com/ffMathy/hey-jarvis/issues/33)) ([3d5565f](https://github.com/ffMathy/hey-jarvis/commit/3d5565fc030af3669124c3394d091fb70001fcc9))
* better simplicity ([34b9984](https://github.com/ffMathy/hey-jarvis/commit/34b9984d8c457a0aeb903dc6bc27e043cbfdd289))
* better version bumping ([296dced](https://github.com/ffMathy/hey-jarvis/commit/296dceda7add657fe42f73e3b8e091c2ba0399b9))
* bilka auth now works ([fdc147b](https://github.com/ffMathy/hey-jarvis/commit/fdc147bdb2a4b22f1e5e316fef1c66d9a74413f0))
* broken build commands for nx ([23f70c1](https://github.com/ffMathy/hey-jarvis/commit/23f70c1dc7b395f8c030f0c5d00da64afa877c7c))
* changelog path ([9f67a90](https://github.com/ffMathy/hey-jarvis/commit/9f67a90c28412164786256ce920b261f460a260c))
* compile issues ([77002e9](https://github.com/ffMathy/hey-jarvis/commit/77002e9fff50427ff43d16ecc2fb3bb72ac3c766))
* created missing tag ([46903c7](https://github.com/ffMathy/hey-jarvis/commit/46903c73b2aec7091f4dd7e95b1eb366cae03e23))
* delete changelog ([01b7687](https://github.com/ffMathy/hey-jarvis/commit/01b76870c7b0818df6519caa7952a678430d5da8))
* delete superfluous file ([70c0507](https://github.com/ffMathy/hey-jarvis/commit/70c0507b29a73057879983a12e72c066c2def1c5))
* don't bootstrap SHA ([8eda6a7](https://github.com/ffMathy/hey-jarvis/commit/8eda6a72b067fb87874d0c564d01abc0500fa9e3))
* don't import instrumentation ([#42](https://github.com/ffMathy/hey-jarvis/issues/42)) ([619bfb7](https://github.com/ffMathy/hey-jarvis/commit/619bfb73c6f10eef24f92baa476e5355c6a48842))
* don't include scorers for certain things ([1dbb9c7](https://github.com/ffMathy/hey-jarvis/commit/1dbb9c7b6f6dd38e02e5b43233ba04cb1848cfa3))
* don't mask environment variables ([b5e6149](https://github.com/ffMathy/hey-jarvis/commit/b5e61494745cd4a5d8915b8afa3658492444d018))
* general confidentiality ([2ce2b15](https://github.com/ffMathy/hey-jarvis/commit/2ce2b154d33e805a88f976f815152b8f79582ccd))
* include env variables in build.yml ([#31](https://github.com/ffMathy/hey-jarvis/issues/31)) ([467dca4](https://github.com/ffMathy/hey-jarvis/commit/467dca48ca5166379b74758bd9e4d7abc22a30c4))
* increase amount of results fetched ([641823b](https://github.com/ffMathy/hey-jarvis/commit/641823b0801f79dc8f674a8581f7634a14d666a9))
* multi architecture builds ([#38](https://github.com/ffMathy/hey-jarvis/issues/38)) ([7d1237f](https://github.com/ffMathy/hey-jarvis/commit/7d1237fd23bf389a290ceab3160e74cf67786399))
* new changelog format ([0052c34](https://github.com/ffMathy/hey-jarvis/commit/0052c34e8b7d5e672ed00e8a3a43fe8b9ede5219))
* only use 1Password when env is missing ([7e79df3](https://github.com/ffMathy/hey-jarvis/commit/7e79df353840222f401f87976e34cf03a450029a))
* proper path for bumping ([aa46821](https://github.com/ffMathy/hey-jarvis/commit/aa46821d2307106e1332c9467fb9237cdddac39e))
* reference all variables via prefix ([4a1eb29](https://github.com/ffMathy/hey-jarvis/commit/4a1eb29e0005243729cd75edc0100fb74242f27a))
* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))
* release-please patch to understand dependencies ([#44](https://github.com/ffMathy/hey-jarvis/issues/44)) ([15ea7b8](https://github.com/ffMathy/hey-jarvis/commit/15ea7b801da6629c5510093684d50fe9fad7c644))
* remove another changelog ([6b51ede](https://github.com/ffMathy/hey-jarvis/commit/6b51ede9f9b4979ff127379e67c90c27147ff02f))
* reset changelogs ([d141d97](https://github.com/ffMathy/hey-jarvis/commit/d141d9706d07f27787b3561515b701fc961a5b46))
* set target branch to main again ([97b7ada](https://github.com/ffMathy/hey-jarvis/commit/97b7ada667a3b0c32b8dcb1ad909bd5092124349))
* shopping list flow has been solved ([ef3ad26](https://github.com/ffMathy/hey-jarvis/commit/ef3ad2649f5f045294382e9460bf7a305c858eef))
* switch to "develop" ([fd18528](https://github.com/ffMathy/hey-jarvis/commit/fd185281843254993444b413a234229ba5c8d777))
* variable substitution via env option ([db9ed73](https://github.com/ffMathy/hey-jarvis/commit/db9ed734ce8289056b717df63a4fd33523595b5b))

## [0.3.3](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.3.2...hey-jarvis-v0.3.3) (2025-10-02)


### Bug Fixes

* don't import instrumentation ([#42](https://github.com/ffMathy/hey-jarvis/issues/42)) ([619bfb7](https://github.com/ffMathy/hey-jarvis/commit/619bfb73c6f10eef24f92baa476e5355c6a48842))

## [0.3.2](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.3.1...hey-jarvis-v0.3.2) (2025-10-02)


### Bug Fixes

* better deploy script ([#40](https://github.com/ffMathy/hey-jarvis/issues/40)) ([ae7a673](https://github.com/ffMathy/hey-jarvis/commit/ae7a67396bd900f0a4b9e44182d2fe8ea7836703))

## [0.3.1](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.3.0...hey-jarvis-v0.3.1) (2025-10-02)


### Bug Fixes

* multi architecture builds ([#38](https://github.com/ffMathy/hey-jarvis/issues/38)) ([7d1237f](https://github.com/ffMathy/hey-jarvis/commit/7d1237fd23bf389a290ceab3160e74cf67786399))

## [0.3.0](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.2.6...hey-jarvis-v0.3.0) (2025-10-02)


### Features

* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))

## [0.2.6](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.2.5...hey-jarvis-v0.2.6) (2025-10-01)


### Bug Fixes

* better env parsing ([#33](https://github.com/ffMathy/hey-jarvis/issues/33)) ([3d5565f](https://github.com/ffMathy/hey-jarvis/commit/3d5565fc030af3669124c3394d091fb70001fcc9))

## [0.2.5](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.2.4...hey-jarvis-v0.2.5) (2025-10-01)


### Bug Fixes

* include env variables in build.yml ([#31](https://github.com/ffMathy/hey-jarvis/issues/31)) ([467dca4](https://github.com/ffMathy/hey-jarvis/commit/467dca48ca5166379b74758bd9e4d7abc22a30c4))

## [0.2.4](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.2.3...hey-jarvis-v0.2.4) (2025-10-01)


### Bug Fixes

* 403 Docker build errors by using locally built base images ([#29](https://github.com/ffMathy/hey-jarvis/issues/29)) ([2af6a45](https://github.com/ffMathy/hey-jarvis/commit/2af6a45188878cfc16291454b07ff564f1a0c032))

## [0.2.3](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.2.2...hey-jarvis-v0.2.3) (2025-09-30)


### Bug Fixes

* reference all variables via prefix ([4a1eb29](https://github.com/ffMathy/hey-jarvis/commit/4a1eb29e0005243729cd75edc0100fb74242f27a))
* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))

## [0.2.2](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.2.1...hey-jarvis-v0.2.2) (2025-09-30)


### Bug Fixes

* only use 1Password when env is missing ([7e79df3](https://github.com/ffMathy/hey-jarvis/commit/7e79df353840222f401f87976e34cf03a450029a))

## [0.2.1](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.2.0...hey-jarvis-v0.2.1) (2025-09-30)


### Bug Fixes

* add git status to agents ([da32732](https://github.com/ffMathy/hey-jarvis/commit/da32732750a19616f550d992e4c662f6ae8d47a4))

## [0.2.0](https://github.com/ffMathy/hey-jarvis/compare/hey-jarvis-v0.1.0...hey-jarvis-v0.2.0) (2025-09-30)


### Features

* add code workspace ([#8](https://github.com/ffMathy/hey-jarvis/issues/8)) ([3d64bd4](https://github.com/ffMathy/hey-jarvis/commit/3d64bd4e77a814441497b69c571e1965d347ebf0))
* add docker-in-docker ([66aaafc](https://github.com/ffMathy/hey-jarvis/commit/66aaafc6cdd5d5fbf7d593131117c14816036898))
* add new project and deploy pipeline ([857dd8a](https://github.com/ffMathy/hey-jarvis/commit/857dd8a7290100f31984d7a94fd822f85f2a1987))
* added latest jarvis prompt ([a035701](https://github.com/ffMathy/hey-jarvis/commit/a035701fee0448ee492c275b01de2a554f7ff43e))
* allow for deploy of jarvis in elevenlabs from prompt ([bd5e35a](https://github.com/ffMathy/hey-jarvis/commit/bd5e35aabee9157326cb351996bf29816cce8962))
* bump release to trigger new versions ([124c40a](https://github.com/ffMathy/hey-jarvis/commit/124c40aea32cecdc100bba92be17ef5d75f0f192))
* devcontainer introduced ([e92340f](https://github.com/ffMathy/hey-jarvis/commit/e92340fa489abe4f38649639e01b8deba41c74cc))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* include version in release PR titles ([c779407](https://github.com/ffMathy/hey-jarvis/commit/c77940723c79fbd5eef797f49f145c5852b92145))
* initial n8n agent converted to mastra ([942c7d2](https://github.com/ffMathy/hey-jarvis/commit/942c7d23a7d6118c960fcbf5f343d1ffc9fa5de2))
* introduce home assistant voice firmware ([af1ac84](https://github.com/ffMathy/hey-jarvis/commit/af1ac8451c9b23f25c0eac6433e99924442e1024))
* introduce mastra AI for jarvis-mcp ([d4dfca4](https://github.com/ffMathy/hey-jarvis/commit/d4dfca46d82ef3296273121b40930e8795354f46))
* migration phase 1 ([#7](https://github.com/ffMathy/hey-jarvis/issues/7)) ([b47b2cd](https://github.com/ffMathy/hey-jarvis/commit/b47b2cd9a248a426c4c1ab7bbd6932444ba0f4db))
* n8n weather agent ([6b62e05](https://github.com/ffMathy/hey-jarvis/commit/6b62e05734179923efba6fbccfa21a9c395652f0))
* NX support for DevX ([03fbc56](https://github.com/ffMathy/hey-jarvis/commit/03fbc56575fc5ddc3b8b41cefcc15feb5ab1fb39))
* scorers added ([318e63f](https://github.com/ffMathy/hey-jarvis/commit/318e63f36ac422f99d7c456e632f72cc7dc2bd12))
* update release-please config with initial versions to reset state ([df008d1](https://github.com/ffMathy/hey-jarvis/commit/df008d107802211400e04d815f7e0696adb81a8c))
* weather agent ([f82bc31](https://github.com/ffMathy/hey-jarvis/commit/f82bc31807a33dbd03a18babbe9bd56e25e9762a))
* weather agent in Mastra ([f61e5ba](https://github.com/ffMathy/hey-jarvis/commit/f61e5baa2b023084fc1d61ae59b683099c5ed928))


### Bug Fixes

* add github CLI ([b4da3a2](https://github.com/ffMathy/hey-jarvis/commit/b4da3a22f272e913ce8976731f51246c87d8fe67))
* add missing environment variables to DevContainer ([4cc0b15](https://github.com/ffMathy/hey-jarvis/commit/4cc0b152e4f5fe5807548180fdb746ea1d90add7))
* add missing package.json ([8114f0d](https://github.com/ffMathy/hey-jarvis/commit/8114f0d2a2aba5dbcf3d9cb87233182f6fbf2abc))
* added search functionality ([8a2b357](https://github.com/ffMathy/hey-jarvis/commit/8a2b3576ff9ccba7c02551f432bd8997e3943a7d))
* attempt at variable substitution ([7f3cbce](https://github.com/ffMathy/hey-jarvis/commit/7f3cbcebec69a3a322e2d1edf655e3252dd95b64))
* bad formatting ([2a81426](https://github.com/ffMathy/hey-jarvis/commit/2a814264aacfd6e437e33047fec46b6c521dcc11))
* better simplicity ([34b9984](https://github.com/ffMathy/hey-jarvis/commit/34b9984d8c457a0aeb903dc6bc27e043cbfdd289))
* better version bumping ([296dced](https://github.com/ffMathy/hey-jarvis/commit/296dceda7add657fe42f73e3b8e091c2ba0399b9))
* bilka auth now works ([fdc147b](https://github.com/ffMathy/hey-jarvis/commit/fdc147bdb2a4b22f1e5e316fef1c66d9a74413f0))
* broken build commands for nx ([23f70c1](https://github.com/ffMathy/hey-jarvis/commit/23f70c1dc7b395f8c030f0c5d00da64afa877c7c))
* changelog path ([9f67a90](https://github.com/ffMathy/hey-jarvis/commit/9f67a90c28412164786256ce920b261f460a260c))
* compile issues ([77002e9](https://github.com/ffMathy/hey-jarvis/commit/77002e9fff50427ff43d16ecc2fb3bb72ac3c766))
* created missing tag ([46903c7](https://github.com/ffMathy/hey-jarvis/commit/46903c73b2aec7091f4dd7e95b1eb366cae03e23))
* delete changelog ([01b7687](https://github.com/ffMathy/hey-jarvis/commit/01b76870c7b0818df6519caa7952a678430d5da8))
* delete superfluous file ([70c0507](https://github.com/ffMathy/hey-jarvis/commit/70c0507b29a73057879983a12e72c066c2def1c5))
* don't bootstrap SHA ([8eda6a7](https://github.com/ffMathy/hey-jarvis/commit/8eda6a72b067fb87874d0c564d01abc0500fa9e3))
* don't include scorers for certain things ([1dbb9c7](https://github.com/ffMathy/hey-jarvis/commit/1dbb9c7b6f6dd38e02e5b43233ba04cb1848cfa3))
* don't mask environment variables ([b5e6149](https://github.com/ffMathy/hey-jarvis/commit/b5e61494745cd4a5d8915b8afa3658492444d018))
* general confidentiality ([2ce2b15](https://github.com/ffMathy/hey-jarvis/commit/2ce2b154d33e805a88f976f815152b8f79582ccd))
* increase amount of results fetched ([641823b](https://github.com/ffMathy/hey-jarvis/commit/641823b0801f79dc8f674a8581f7634a14d666a9))
* new changelog format ([0052c34](https://github.com/ffMathy/hey-jarvis/commit/0052c34e8b7d5e672ed00e8a3a43fe8b9ede5219))
* proper path for bumping ([aa46821](https://github.com/ffMathy/hey-jarvis/commit/aa46821d2307106e1332c9467fb9237cdddac39e))
* remove another changelog ([6b51ede](https://github.com/ffMathy/hey-jarvis/commit/6b51ede9f9b4979ff127379e67c90c27147ff02f))
* reset changelogs ([d141d97](https://github.com/ffMathy/hey-jarvis/commit/d141d9706d07f27787b3561515b701fc961a5b46))
* set target branch to main again ([97b7ada](https://github.com/ffMathy/hey-jarvis/commit/97b7ada667a3b0c32b8dcb1ad909bd5092124349))
* shopping list flow has been solved ([ef3ad26](https://github.com/ffMathy/hey-jarvis/commit/ef3ad2649f5f045294382e9460bf7a305c858eef))
* switch to "develop" ([fd18528](https://github.com/ffMathy/hey-jarvis/commit/fd185281843254993444b413a234229ba5c8d777))
* variable substitution via env option ([db9ed73](https://github.com/ffMathy/hey-jarvis/commit/db9ed734ce8289056b717df63a4fd33523595b5b))
