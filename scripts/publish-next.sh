#!/usr/bin/env zsh
# Mirror of .github/workflows/publish-next.yml — publish a prerelease to the `next` npm tag.
# Bumps patch so the prerelease sorts above the current stable release,
# e.g. 1.5.0 -> 1.5.1-next.20260714093000.g325093a
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Don't publish release-please's own release commits — those go out as `latest`.
HEAD_MSG=$(git log -1 --pretty=%s)
if [[ "$HEAD_MSG" == chore\(main\):\ release* ]]; then
  echo "Skipping: HEAD is a release-please commit ($HEAD_MSG)"
  exit 0
fi

SHA=$(git rev-parse HEAD)

npm ci
npm test

BASE=$(node -p "const v = require('./package.json').version.split('.'); v[2] = Number(v[2]) + 1; v.join('.')")
VERSION="${BASE}-next.$(date -u +%Y%m%d%H%M%S).g${SHA:0:7}"

# --no-git-tag-version keeps this a throwaway local bump (no commit/tag created).
# Unlike CI's fresh checkout, this mutates the working tree, so always restore it.
restore() { git checkout -- package.json package-lock.json 2>/dev/null || true; }
trap restore EXIT

npm version --no-git-tag-version "$VERSION"

# --provenance relies on OIDC that only exists in GitHub Actions.
PROVENANCE=()
[[ -n "${GITHUB_ACTIONS:-}" ]] && PROVENANCE=(--provenance)

npm publish "${PROVENANCE[@]}" --tag next
