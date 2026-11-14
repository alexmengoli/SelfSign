#!/usr/bin/env sh

set -eu

if [ "$#" -lt 1 ] || [ -z "$1" ]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

npm version "$1" --workspaces --include-workspace-root --no-git-tag-version
