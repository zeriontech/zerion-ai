# Changelog

## [1.1.0](https://github.com/zeriontech/zerion-ai/compare/v1.0.1...v1.1.0) (2026-05-08)


### Features

* add Monad skills and examples ([#56](https://github.com/zeriontech/zerion-ai/issues/56)) ([562a8ab](https://github.com/zeriontech/zerion-ai/commit/562a8aba59bab4781bbb6114cbe2875b92e17634))
* add zerion-partner-skill-creator skill ([#51](https://github.com/zeriontech/zerion-ai/issues/51)) ([9c4b38c](https://github.com/zeriontech/zerion-ai/commit/9c4b38c409d141214d38f264e2d8e1123d9bebdf))
* **cli:** bridge provider selection, fee attribution, expanded chains list ([#58](https://github.com/zeriontech/zerion-ai/issues/58)) ([50da002](https://github.com/zeriontech/zerion-ai/commit/50da002ae8b4c3e64e91bd6c1347406c961209f3))
* sendai ideas skills ([#39](https://github.com/zeriontech/zerion-ai/issues/39)) ([b2f5dea](https://github.com/zeriontech/zerion-ai/commit/b2f5dea3ba3833f70646c9ed65e5d07451aca35e))


### Bug Fixes

* **cli:** make `zerion init` skills step interactive by default ([#49](https://github.com/zeriontech/zerion-ai/issues/49)) ([e3634bd](https://github.com/zeriontech/zerion-ai/commit/e3634bd7b27fa29532857afc8d58a6edc128243a))

## [1.0.1](https://github.com/zeriontech/zerion-ai/compare/v1.0.0...v1.0.1) (2026-05-05)


### Features

* add MoonPay partner skills (onramp, iron DCA, prediction markets) ([#32](https://github.com/zeriontech/zerion-ai/issues/32)) ([2775753](https://github.com/zeriontech/zerion-ai/commit/2775753efae5d2304fb297aac5cee0ec78e625ce))
* **cli:** migrate to /swap/quotes/, add Solana swap+bridge+send ([#47](https://github.com/zeriontech/zerion-ai/issues/47)) ([0fac91e](https://github.com/zeriontech/zerion-ai/commit/0fac91ec23f3ce807ac58dae6a860ab179caecf7))
* handle retries on 429 error ([#44](https://github.com/zeriontech/zerion-ai/issues/44)) ([7d481f2](https://github.com/zeriontech/zerion-ai/commit/7d481f229d89edd3796903c79eec560fbd655119))
* unify CLI + agent skills, un-flatten to cli/ ([#28](https://github.com/zeriontech/zerion-ai/issues/28)) ([d21f5b7](https://github.com/zeriontech/zerion-ai/commit/d21f5b7f148d5d8cae62b5c759209d3d1b2b767d))


### Bug Fixes

* **cli:** rerank search results and fetch chains live from API ([#38](https://github.com/zeriontech/zerion-ai/issues/38)) ([0d668a0](https://github.com/zeriontech/zerion-ai/commit/0d668a04f24ad9e81eda73f8663e776c2d23dcd9))


### Miscellaneous Chores

* release 1.0.1 ([#29](https://github.com/zeriontech/zerion-ai/issues/29)) ([4efcbeb](https://github.com/zeriontech/zerion-ai/commit/4efcbebf326b81e20350160fe924dc74a8df194c))

## [1.0.0](https://github.com/zeriontech/zerion-ai/compare/v0.4.2...v1.0.0) (2026-04-27)


### Features

* add MPP pay-per-call support + Solana x402 ([376d30b](https://github.com/zeriontech/zerion-ai/commit/376d30b2cb9fff41b84d55a49e842229468b1f08))
* add MPP pay-per-call support via --mpp flag ([70ed3aa](https://github.com/zeriontech/zerion-ai/commit/70ed3aa718b6bc9ab57ddca959b046c4cbbdfb59))
* add Solana x402 support via @x402/svm ([1741984](https://github.com/zeriontech/zerion-ai/commit/17419846eb689d12304df32680febbff45af37e8))
* add wallet sign-message and sign-typed-data commands ([07b39be](https://github.com/zeriontech/zerion-ai/commit/07b39beaf139fa0257f14acbf2ca53d39f630c95))
* add zerion init + refresh README onboarding (release 1.0.0) ([caa9241](https://github.com/zeriontech/zerion-ai/commit/caa9241e477225f3629347c51923230fe5bb6ac3))
* **cli:** zerion setup skills/mcp + handoff doc ([#20](https://github.com/zeriontech/zerion-ai/issues/20)) ([2848d04](https://github.com/zeriontech/zerion-ai/commit/2848d04bc2e1203c33d73d154b4fdd669b02e27f))
* offer to set up agent token inline when missing ([4b5a79d](https://github.com/zeriontech/zerion-ai/commit/4b5a79dc8015b309b75d5d8a068f1cb159e55881))
* sign-message + sign-typed-data with inline agent-token setup ([ae3aa54](https://github.com/zeriontech/zerion-ai/commit/ae3aa54dd38c9d2b70e58474124725e831e617c1))


### Bug Fixes

* bind inline-created agent token to caller's wallet, not default ([275e2f7](https://github.com/zeriontech/zerion-ai/commit/275e2f7e47a7d4e12a160c9aa1a978d13c08995b))
* chains is not an integration test, and not pay-per-call ([b0c3e6a](https://github.com/zeriontech/zerion-ai/commit/b0c3e6ac40132116cb5ad0b87ffef459adea8811))
* confirm() returns defaultYes instead of user's actual answer ([35e0c58](https://github.com/zeriontech/zerion-ai/commit/35e0c58c2daf3e4df040737a909f8000503bf571))
* keep trading commands on API key path ([3721ce0](https://github.com/zeriontech/zerion-ai/commit/3721ce0d30195b2400162caab9a6c26b2797f5a3))
* **test:** extract JSON from stderr to tolerate Node warnings ([a37463b](https://github.com/zeriontech/zerion-ai/commit/a37463bb009e09846744e8847b9427b77bbe1b05))
* validate EVM key format before MPP init ([2f2b397](https://github.com/zeriontech/zerion-ai/commit/2f2b3976c804117bfc22e264a516266c4d06e158))


### Miscellaneous Chores

* bump to 1.0.0 for the cli-only restructure ([1882629](https://github.com/zeriontech/zerion-ai/commit/1882629e76d705d45abfcd79961c490071546342))
