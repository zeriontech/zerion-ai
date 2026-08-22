# Changelog

## [1.9.1](https://github.com/zeriontech/zerion-ai/compare/v1.9.0...v1.9.1) (2026-08-22)


### Bug Fixes

* **cli:** mask private key and mnemonic input on wallet import (WLT-2075) ([#112](https://github.com/zeriontech/zerion-ai/issues/112)) ([e8fa093](https://github.com/zeriontech/zerion-ai/commit/e8fa0934ac7327c9eb8ded67e6e713bbb8549002))
* **cli:** portfolio DeFi totals and Solana read paths (WLT-2076) ([#114](https://github.com/zeriontech/zerion-ai/issues/114)) ([18972f6](https://github.com/zeriontech/zerion-ai/commit/18972f6c90ff69441d86b1b60222b39414f43396))

## [1.9.0](https://github.com/zeriontech/zerion-ai/compare/v1.8.0...v1.9.0) (2026-08-11)


### Features

* **cli:** add zerion-cli alias ([5718e1e](https://github.com/zeriontech/zerion-ai/commit/5718e1e156028fc0fdd28d148f1b1498dda94363))
* **skills:** handoff docs updates ([#109](https://github.com/zeriontech/zerion-ai/issues/109)) ([c27cccc](https://github.com/zeriontech/zerion-ai/commit/c27cccca8432fbff57ac342e50c4db3141641aee))


### Bug Fixes

* **cli:** unblock --mpp and gate the x402 "Paid" line on settlement (WLT-2024) ([#108](https://github.com/zeriontech/zerion-ai/issues/108)) ([c8c7258](https://github.com/zeriontech/zerion-ai/commit/c8c72580ce60bae6cf54a31a512d08e0713d4587))
* **wallet:** update validate chains logic in read requests ([2b576c0](https://github.com/zeriontech/zerion-ai/commit/2b576c05f5b46ef5b5d9bcbc5fac25a4001fbab8))

## [1.8.0](https://github.com/zeriontech/zerion-ai/compare/v1.7.0...v1.8.0) (2026-08-06)


### Features

* **skills:** Add Yellow Settlement Room Skill ([#103](https://github.com/zeriontech/zerion-ai/issues/103)) ([b55a35c](https://github.com/zeriontech/zerion-ai/commit/b55a35cae01c55642d339d1a03fe3097337d3bb4))


### Bug Fixes

* **skills:** add install collodown for deps ([51be271](https://github.com/zeriontech/zerion-ai/commit/51be271d020015623e8cd97fcc909333543c0bcf))
* **wallet:** improve gas estimation logic ([e022388](https://github.com/zeriontech/zerion-ai/commit/e022388547dda267c21a2e870857558bb2d6170d))

## [1.7.0](https://github.com/zeriontech/zerion-ai/compare/v1.6.0...v1.7.0) (2026-08-03)


### Features

* **wallet:** add proper warning for handoff token mismatch ([4ab6cff](https://github.com/zeriontech/zerion-ai/commit/4ab6cff843af598dc3894c528094921d7900e6ea))
* **wallet:** support multiple transactions in one signing flow ([#100](https://github.com/zeriontech/zerion-ai/issues/100)) ([fdddcef](https://github.com/zeriontech/zerion-ai/commit/fdddcefadc0e14f67580820e1b401a74f47c71d0))

## [1.6.0](https://github.com/zeriontech/zerion-ai/compare/v1.5.0...v1.6.0) (2026-07-23)


### Features

* **wallet:** oauth login flow via dashboard.zerion.io ([c1a1cf4](https://github.com/zeriontech/zerion-ai/commit/c1a1cf47d7a31520cb9fedf4522c816522fbfb1f))
* **wallet:** web app handoff for signing ([#96](https://github.com/zeriontech/zerion-ai/issues/96)) ([316fe1c](https://github.com/zeriontech/zerion-ai/commit/316fe1ca507b7469442918a247943db7153094d6))


### Bug Fixes

* fix next tag release tests guard ([#99](https://github.com/zeriontech/zerion-ai/issues/99)) ([a55957e](https://github.com/zeriontech/zerion-ai/commit/a55957e056191eae29117286d12a5526d0e39bc2))
* **skills:** restore moonpay partner docs emptied by skill consolidation ([#91](https://github.com/zeriontech/zerion-ai/issues/91)) ([325093a](https://github.com/zeriontech/zerion-ai/commit/325093a0b79c32219a452d3a96648c16a922dfa6))

## [1.5.0](https://github.com/zeriontech/zerion-ai/compare/v1.4.0...v1.5.0) (2026-06-03)


### Features

* **skills:** consolidate 30 skills into single zerion skill + fix init.js ([#86](https://github.com/zeriontech/zerion-ai/issues/86)) ([257ebe0](https://github.com/zeriontech/zerion-ai/commit/257ebe0230fae1690e8a449062269512bc456bab))
* **wallet:** add `wallet export-key` to export raw private keys ([5bb9951](https://github.com/zeriontech/zerion-ai/commit/5bb9951095ba4d09a259f6231c25159bd3e8e95e))

## [1.4.0](https://github.com/zeriontech/zerion-ai/compare/v1.3.0...v1.4.0) (2026-05-26)


### Features

* add zerion-0x partner skill for 0x API v2 swap integration ([#74](https://github.com/zeriontech/zerion-ai/issues/74)) ([e89f01a](https://github.com/zeriontech/zerion-ai/commit/e89f01a3ca9327a8bb097d511fc9bd12818f8733))

## [1.3.0](https://github.com/zeriontech/zerion-ai/compare/v1.2.0...v1.3.0) (2026-05-15)


### Features

* add zerion-bankr partner skill ([#72](https://github.com/zeriontech/zerion-ai/issues/72)) ([54ccf67](https://github.com/zeriontech/zerion-ai/commit/54ccf67e8581084246b90be237b768b1b7bea754))
* add zerion-lifi-earn skill ([#69](https://github.com/zeriontech/zerion-ai/issues/69)) ([8a310d4](https://github.com/zeriontech/zerion-ai/commit/8a310d44ed2c0b5825f20ab1d18bc9a6a508aa13))
* add zerion-uniswap-lp and zerion-uniswap-x402 partner skills ([#65](https://github.com/zeriontech/zerion-ai/issues/65)) ([175cc6a](https://github.com/zeriontech/zerion-ai/commit/175cc6a56fcc472b767a0a778aa6634c2bb335e7))
* **positions:** add --defi flag with grouped DeFi view ([#77](https://github.com/zeriontech/zerion-ai/issues/77)) ([97da693](https://github.com/zeriontech/zerion-ai/commit/97da693adf837839c53ee8bc522b15d051b7cc56))


### Bug Fixes

* **zerion-uniswap-x402:** use canonical 5-arg zerion bridge signature ([#75](https://github.com/zeriontech/zerion-ai/issues/75)) ([bb3c946](https://github.com/zeriontech/zerion-ai/commit/bb3c946f93d121e89d5ca29b710741006f50a643))

## [1.2.0](https://github.com/zeriontech/zerion-ai/compare/v1.1.0...v1.2.0) (2026-05-12)


### Features

* add zerion-umbra-privateTxn skill for Umbra private payments ([#40](https://github.com/zeriontech/zerion-ai/issues/40)) ([a0518ca](https://github.com/zeriontech/zerion-ai/commit/a0518ca5f92d7da50beb7fb9801efd82d8ac30e4))
* **cli:** add --passphrase-file flag for agent create-token ([#67](https://github.com/zeriontech/zerion-ai/issues/67)) ([078cc34](https://github.com/zeriontech/zerion-ai/commit/078cc34927a63dc4dd44838a8923e52d29b9c06f))

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
