# Changelog

## [0.5.0](https://github.com/zeriontech/zerion-ai/compare/v0.4.2...v0.5.0) (2026-04-27)


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
