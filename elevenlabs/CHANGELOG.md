# Changelog

## [0.6.0](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.5.0...elevenlabs-v0.6.0) (2025-11-13)


### Features

* added latest jarvis prompt ([a035701](https://github.com/ffMathy/hey-jarvis/commit/a035701fee0448ee492c275b01de2a554f7ff43e))
* allow for deploy of jarvis in elevenlabs from prompt ([bd5e35a](https://github.com/ffMathy/hey-jarvis/commit/bd5e35aabee9157326cb351996bf29816cce8962))
* **elevenlabs:** enable parallel test execution with concurrency of 10 ([f9d08ed](https://github.com/ffMathy/hey-jarvis/commit/f9d08edd518d4f63c55301f884d45202ad915822))
* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([307ac9e](https://github.com/ffMathy/hey-jarvis/commit/307ac9e008d438f1d07c37694bc5afb0dbf47f5e))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))
* migrate from NPM to Bun for package management ([5455985](https://github.com/ffMathy/hey-jarvis/commit/54559850929c9dc36fbada4661dede0336cafa6d))
* new test suite and prompt ([#83](https://github.com/ffMathy/hey-jarvis/issues/83)) ([89f4d20](https://github.com/ffMathy/hey-jarvis/commit/89f4d202cce92873d9c24b55b8cc5b43a17749ee))
* optimize Docker images with Alpine base and multi-stage builds ([c616e78](https://github.com/ffMathy/hey-jarvis/commit/c616e7895b3ac4123dade49c2f82f27bedab8fcc))
* switch to scribe ([#178](https://github.com/ffMathy/hey-jarvis/issues/178)) ([73d7ecf](https://github.com/ffMathy/hey-jarvis/commit/73d7ecf2b333c78fe021997bdb5c11f1e4e29279))


### Bug Fixes

* add missing package json ([#45](https://github.com/ffMathy/hey-jarvis/issues/45)) ([86917a5](https://github.com/ffMathy/hey-jarvis/commit/86917a5fb459e322311a439853feebe63687813d))
* added node options ([47f2421](https://github.com/ffMathy/hey-jarvis/commit/47f242179c5555e84dd8a9d921cfb169a91357c6))
* always test via gemini ([60f5c38](https://github.com/ffMathy/hey-jarvis/commit/60f5c389228a2acd17f79b894b07e98eccc57a7c))
* better env parsing ([#33](https://github.com/ffMathy/hey-jarvis/issues/33)) ([d95aa63](https://github.com/ffMathy/hey-jarvis/commit/d95aa63cc21f986983454fc758c3c68a2248397b))
* better prompt without pause before "sir" ([a4e4fca](https://github.com/ffMathy/hey-jarvis/commit/a4e4fca1e0e3603de874b52aa35f46d0459ba9de))
* better tests ([944a16f](https://github.com/ffMathy/hey-jarvis/commit/944a16f1cf430fcf110739e0a0f102a6e0c30463))
* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([31783be](https://github.com/ffMathy/hey-jarvis/commit/31783bee891a4e9698795108a6730268e41299c0))
* build issues ([e7df175](https://github.com/ffMathy/hey-jarvis/commit/e7df17513237b204b6d2a81686fc620e4264132a))
* don't contradict prompt ([4f396a0](https://github.com/ffMathy/hey-jarvis/commit/4f396a0026b585712cba1e2ce067d8616f456f26))
* **elevenlabs:** remove deploy dependency from test target ([60ef5e6](https://github.com/ffMathy/hey-jarvis/commit/60ef5e6eac52823ee76ca728866109871c98265a))
* **elevenlabs:** revert test dependency and document deploy requirement ([6198a56](https://github.com/ffMathy/hey-jarvis/commit/6198a56ab1d7b6fe625d83220be8afaed90c7643))
* **elevenlabs:** set temperature to 0 for deterministic LLM outputs ([d3e8a6f](https://github.com/ffMathy/hey-jarvis/commit/d3e8a6fcd64552c967511af719c80ed8d6fb78c2))
* **elevenlabs:** use correct message content in conversation history ([36de031](https://github.com/ffMathy/hey-jarvis/commit/36de031a849e37ecb7ad4095699eb83b166c0490))
* general confidentiality ([2ce2b15](https://github.com/ffMathy/hey-jarvis/commit/2ce2b154d33e805a88f976f815152b8f79582ccd))
* jarvis tests around prompt ([a955c1e](https://github.com/ffMathy/hey-jarvis/commit/a955c1e0533b7e8a209f2114d5c7fa7cd547958e))
* more contradiction fixes ([c2c07c0](https://github.com/ffMathy/hey-jarvis/commit/c2c07c0816720c55646dd941cbe7a8a855b3c031))
* only use 1Password when env is missing ([63b13d7](https://github.com/ffMathy/hey-jarvis/commit/63b13d70700c943bc05da6acf65ac26d9cdbafb8))
* progress on full transcript ([74b1865](https://github.com/ffMathy/hey-jarvis/commit/74b186505eb07c9646b4c57c51ee31b550b4d781))
* progress on jest integration ([d89f017](https://github.com/ffMathy/hey-jarvis/commit/d89f017a216bb8cde57752c9b10b48c77395c7ed))
* progress on stability and tests ([082660f](https://github.com/ffMathy/hey-jarvis/commit/082660f8b5bd0db869ef0d4ece56bc01eee5eb54))
* refactor to use strategy pattern ([2a41a66](https://github.com/ffMathy/hey-jarvis/commit/2a41a66ec47ce1a4ffeb245cce933fc943e63bf4))
* reference env from prefix ([11b1213](https://github.com/ffMathy/hey-jarvis/commit/11b12135ff6e20aa89830bb8ca91ef8bd701fbec))
* **release-please:** correct pattern syntax and resolve blocking issues ([#185](https://github.com/ffMathy/hey-jarvis/issues/185)) ([cd1cef8](https://github.com/ffMathy/hey-jarvis/commit/cd1cef861687d9be48d09efffd883ac843d7be0e))
* remove input and output processors to avoid issues ([#164](https://github.com/ffMathy/hey-jarvis/issues/164)) ([3e98fa1](https://github.com/ffMathy/hey-jarvis/commit/3e98fa1bd7258b95d0c44bfdb0ba37b435ca98fa))
* remove invalid package.json ([#47](https://github.com/ffMathy/hey-jarvis/issues/47)) ([09f62e4](https://github.com/ffMathy/hey-jarvis/commit/09f62e4582ea24bc711273eef475ddc5fbb78569))
* resolve Jest test failures by compiling TypeScript first with esbuild ([#162](https://github.com/ffMathy/hey-jarvis/issues/162)) ([d0ec7bf](https://github.com/ffMathy/hey-jarvis/commit/d0ec7bfd3a27014874585ed9f7bd9089cb98a839))
* serve now works ([24bc1f7](https://github.com/ffMathy/hey-jarvis/commit/24bc1f725492ff5034e62eb145de166b34832e18))
* support weather API ([0c4a3e0](https://github.com/ffMathy/hey-jarvis/commit/0c4a3e0c1f8b1700a017da8835ece1a7d418f9fc))
* tests improved ([75933a1](https://github.com/ffMathy/hey-jarvis/commit/75933a12e5e1d926d0251871c964dc727240525f))
* tests pass ([923785b](https://github.com/ffMathy/hey-jarvis/commit/923785b5a15c391387643da18a516b1554beff76))
* update CI ([f392128](https://github.com/ffMathy/hey-jarvis/commit/f392128856254554409f2a446e4f0fea83d18d7b))
* update config ([0d10fad](https://github.com/ffMathy/hey-jarvis/commit/0d10fadac17bef5cbf0c0f7c8e6a4b6a51727d83))
* update elevenlabs Dockerfile and project.json for Bun compatibility ([979a20f](https://github.com/ffMathy/hey-jarvis/commit/979a20f562a6de658a23d4a68f9ea8911e44db86))


### Performance Improvements

* add parallelism ([3541485](https://github.com/ffMathy/hey-jarvis/commit/3541485c5ed86625dcf8a2c0b56c57de6fa5520b))

## [0.5.0](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.4.2...elevenlabs-v0.5.0) (2025-11-08)


### Features

* **elevenlabs:** enable parallel test execution with concurrency of 10 ([71b2d8c](https://github.com/ffMathy/hey-jarvis/commit/71b2d8c3f454a77f5160cc8c058b52a0a4555f17))


### Bug Fixes

* **elevenlabs:** set temperature to 0 for deterministic LLM outputs ([e4d3bde](https://github.com/ffMathy/hey-jarvis/commit/e4d3bde31307f056a174b66ab463c74f21953cc8))
* **elevenlabs:** use correct message content in conversation history ([18dd820](https://github.com/ffMathy/hey-jarvis/commit/18dd82016e525b8396c7f048919ed027cd734e4d))

## [0.4.2](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.4.1...elevenlabs-v0.4.2) (2025-11-07)


### Bug Fixes

* playwright installation ([8f2197e](https://github.com/ffMathy/hey-jarvis/commit/8f2197e475226452b016bbe5d7ca168f29ea4c48))
* update config ([80f1e9f](https://github.com/ffMathy/hey-jarvis/commit/80f1e9fccc4533d418aa571c860b522e874e4da9))

## [0.4.1](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.4.0...elevenlabs-v0.4.1) (2025-11-05)


### Bug Fixes

* added node options ([31c990a](https://github.com/ffMathy/hey-jarvis/commit/31c990aa5660a82ce0266647ad2321b01cf9c259))
* always test via gemini ([e726be9](https://github.com/ffMathy/hey-jarvis/commit/e726be9071efdf41c858d1e6766d698bd49bc7ed))
* better prompt without pause before "sir" ([53b7158](https://github.com/ffMathy/hey-jarvis/commit/53b71580a3ddb17c53b9b78062b0c4f1760bac54))
* better tests ([28c0ad1](https://github.com/ffMathy/hey-jarvis/commit/28c0ad1c9a8b1f95b5b491d37b2ba34edf47cbed))
* build issues ([7331da7](https://github.com/ffMathy/hey-jarvis/commit/7331da71f2d8c3b862cc8e0b948ae7ba76ebea38))
* don't contradict prompt ([1276d8a](https://github.com/ffMathy/hey-jarvis/commit/1276d8aaaa4452e1796d1ce8672383389542a932))
* jarvis tests around prompt ([db1ff1e](https://github.com/ffMathy/hey-jarvis/commit/db1ff1e62ff18bd18535f11260e2aa3d7b7b48f4))
* more contradiction fixes ([2b1ba15](https://github.com/ffMathy/hey-jarvis/commit/2b1ba15245d8c909840edf6ac88777bef84bf5e3))
* progress on full transcript ([299a5ba](https://github.com/ffMathy/hey-jarvis/commit/299a5ba43b2126556a053daf5b67e2a0244a8a1b))
* progress on jest integration ([ded72e3](https://github.com/ffMathy/hey-jarvis/commit/ded72e3d33d87ba0d6f94523549375c5979c6ec0))
* progress on stability and tests ([0692649](https://github.com/ffMathy/hey-jarvis/commit/069264952fd76864a39da98d55bf64d1c36b5eba))
* refactor to use strategy pattern ([dea5284](https://github.com/ffMathy/hey-jarvis/commit/dea52843e2ed7b398e1b073a5b24d0a598c70230))
* serve now works ([a906895](https://github.com/ffMathy/hey-jarvis/commit/a906895dfc5574a59add7ac7cfc16794beab524b))
* support weather API ([9d7ad5b](https://github.com/ffMathy/hey-jarvis/commit/9d7ad5b8cc6d5dc030076243ab07e54deba65fa0))
* tests improved ([fef11d4](https://github.com/ffMathy/hey-jarvis/commit/fef11d4953112c80728ab89012b6e1f50e3d5440))
* tests pass ([ea6d749](https://github.com/ffMathy/hey-jarvis/commit/ea6d749376f1e951290abfea4f142c84278b0d66))
* update CI ([f013777](https://github.com/ffMathy/hey-jarvis/commit/f0137773a26c035ffc755e6230fa6c71470645cb))


### Performance Improvements

* add parallelism ([c4bcbdb](https://github.com/ffMathy/hey-jarvis/commit/c4bcbdb619c55f2efce2ebf59935664ac32dfd5f))

## [0.4.0](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.3.3...elevenlabs-v0.4.0) (2025-10-20)


### Features

* new test suite and prompt ([#83](https://github.com/ffMathy/hey-jarvis/issues/83)) ([4663765](https://github.com/ffMathy/hey-jarvis/commit/46637654bb80d99dee9dee14d51d83b701fde01b))

## [0.3.3](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.3.2...elevenlabs-v0.3.3) (2025-10-14)


### Bug Fixes

* build issue ([#66](https://github.com/ffMathy/hey-jarvis/issues/66)) ([b1029ed](https://github.com/ffMathy/hey-jarvis/commit/b1029ed0d19222d5a98befe513ba474a9b518c13))

## [0.3.2](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.3.1...elevenlabs-v0.3.2) (2025-10-02)


### Bug Fixes

* remove invalid package.json ([#47](https://github.com/ffMathy/hey-jarvis/issues/47)) ([0ee44c0](https://github.com/ffMathy/hey-jarvis/commit/0ee44c0d52cb562af03ffa74ebd70943a78ee620))

## [0.3.1](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.3.0...elevenlabs-v0.3.1) (2025-10-02)


### Bug Fixes

* add missing package json ([#45](https://github.com/ffMathy/hey-jarvis/issues/45)) ([69d72a1](https://github.com/ffMathy/hey-jarvis/commit/69d72a1d5779a47da2eb6914bc0101a8b0f38941))

## [0.3.0](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.2.3...elevenlabs-v0.3.0) (2025-10-02)


### Features

* home assistant addon support ([#36](https://github.com/ffMathy/hey-jarvis/issues/36)) ([3c3d20d](https://github.com/ffMathy/hey-jarvis/commit/3c3d20d05cd038513db1b95a4fcdb9624b79f491))

## [0.2.3](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.2.2...elevenlabs-v0.2.3) (2025-10-01)


### Bug Fixes

* better env parsing ([#33](https://github.com/ffMathy/hey-jarvis/issues/33)) ([3d5565f](https://github.com/ffMathy/hey-jarvis/commit/3d5565fc030af3669124c3394d091fb70001fcc9))

## [0.2.2](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.2.1...elevenlabs-v0.2.2) (2025-09-30)


### Bug Fixes

* reference env from prefix ([edb2a75](https://github.com/ffMathy/hey-jarvis/commit/edb2a75fe2aa6c4e15b54c88d51e8a78698121b3))

## [0.2.1](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.2.0...elevenlabs-v0.2.1) (2025-09-30)


### Bug Fixes

* only use 1Password when env is missing ([7e79df3](https://github.com/ffMathy/hey-jarvis/commit/7e79df353840222f401f87976e34cf03a450029a))

## [0.2.0](https://github.com/ffMathy/hey-jarvis/compare/elevenlabs-v0.1.0...elevenlabs-v0.2.0) (2025-09-30)


### Features

* added latest jarvis prompt ([a035701](https://github.com/ffMathy/hey-jarvis/commit/a035701fee0448ee492c275b01de2a554f7ff43e))
* allow for deploy of jarvis in elevenlabs from prompt ([bd5e35a](https://github.com/ffMathy/hey-jarvis/commit/bd5e35aabee9157326cb351996bf29816cce8962))
* home assistant voice firmware ([d8f5426](https://github.com/ffMathy/hey-jarvis/commit/d8f54267dc497d6afd38bc8fbffe357f44d12520))


### Bug Fixes

* general confidentiality ([2ce2b15](https://github.com/ffMathy/hey-jarvis/commit/2ce2b154d33e805a88f976f815152b8f79582ccd))
