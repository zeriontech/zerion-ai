# Contributing

`zerion-ai` is maintained by the Zerion team.

## Scope

This repo is intentionally narrow:

- hosted Zerion MCP quickstarts
- one flagship skill: `wallet-analysis`
- a JSON-first CLI for OpenClaw-like environments
- minimal examples that stay easy to verify

Please prefer small, concrete improvements over broad abstractions.

## Development

```bash
npm test
node ./cli/zerion-cli.js --help
```

## Contribution Guidelines

- Keep examples copy-pasteable.
- Prefer official Zerion naming and documented behavior.
- Document real gaps instead of inventing interfaces.
- Preserve JSON-first CLI output for agent compatibility.

## Releasing to npm

This repo uses [release-please](https://github.com/googleapis/release-please) for automated versioning and publishing.

### Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes:

- `feat:` – new feature → minor version bump
- `fix:` – bug fix → patch version bump
- `feat!:` or `fix!:` – breaking change → major version bump
- `docs:`, `chore:`, `test:` – no release triggered

### Release flow

1. Merge `feat:` or `fix:` commits to `main`
2. release-please automatically opens/updates a release PR (`chore(main): release X.Y.Z`) with version bump, CHANGELOG, and manifest update
3. Merge the release PR when ready to ship
4. GitHub Release is created automatically → triggers `npm publish`

The release PR accumulates changes – multiple commits over days/weeks all appear in one release.

### Manual override

To force a specific version, add `Release-As: 2.0.0` in a commit message body.

### CI setup

- `NPM_TOKEN` repo secret is required for npm publish (use a granular access token)
- `.release-please-manifest.json` tracks the current version
- `.github/workflows/release-please.yml` handles both release PR creation and npm publish
- `.github/workflows/test.yml` runs tests on PRs and pushes to main

## Issues And Questions

For Zerion API questions, start with the public docs:

- https://developers.zerion.io/reference/getting-started
- https://developers.zerion.io/reference/building-with-ai
