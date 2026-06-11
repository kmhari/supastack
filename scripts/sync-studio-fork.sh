#!/usr/bin/env bash
# sync-studio-fork.sh — keep the supastack Studio fork current with upstream.
#
#   1. fetch upstream (supabase/supabase) + fork (kmhari/supabase)
#   2. fast-forward the fork's `master` to upstream/master (push, no local checkout)
#   3. rebase the `supastack-studio` patch branch onto the new master
#   4. push the patch branch with --force-with-lease
#
# The patch branch carries the supastack Studio patches (e.g. email-only sign-in);
# fork master MUST stay a pure mirror of upstream — the push fast-forward enforces it.
#
# Usage:
#   scripts/sync-studio-fork.sh <checkout-dir>      # any clone touching either repo
#   SUPABASE_FORK_DIR=… scripts/sync-studio-fork.sh
#
# The checkout may have origin = fork (VM layout) or origin = upstream (dev-machine
# layout); missing remotes are added by URL. Tree must be clean. On rebase conflict
# the script aborts the rebase, restores the original branch, and prints next steps.
#
# After a successful sync, rebuild the platform Studio image from the new head:
#   docker build <checkout-dir> -f infra/studio-platform/Dockerfile \
#     -t supastack/studio-platform:<new-short-sha>

set -euo pipefail

FORK_REPO="kmhari/supabase"
UPSTREAM_REPO="supabase/supabase"
MAIN_BRANCH="master"
PATCH_BRANCH="supastack-studio"

DIR="${1:-${SUPABASE_FORK_DIR:-}}"
if [ -z "$DIR" ]; then
  echo "usage: $0 <checkout-dir of $FORK_REPO or $UPSTREAM_REPO> (or set SUPABASE_FORK_DIR)" >&2
  exit 2
fi
cd "$DIR"
git rev-parse --is-inside-work-tree >/dev/null

if [ -n "$(git status --porcelain)" ]; then
  echo "FATAL: working tree in $DIR is not clean — commit/stash first" >&2
  exit 2
fi

# Find a remote by repo slug (tolerates https/ssh and .git suffix); add it if absent.
find_or_add_remote() { # <slug> <fallback-name>
  local slug="$1" fallback="$2" name
  name=$(git remote -v | awk -v s="$slug" '$2 ~ s"(\\.git)?$" && $3=="(fetch)" {print $1; exit}')
  if [ -z "$name" ]; then
    git remote add "$fallback" "https://github.com/$slug.git"
    name="$fallback"
  fi
  echo "$name"
}

FORK=$(find_or_add_remote "$FORK_REPO" "fork")
UPSTREAM=$(find_or_add_remote "$UPSTREAM_REPO" "upstream")
echo "== remotes: fork=$FORK ($FORK_REPO)  upstream=$UPSTREAM ($UPSTREAM_REPO)"

echo "== fetching"
git fetch --prune "$UPSTREAM" "$MAIN_BRANCH"
git fetch --prune "$FORK" "$MAIN_BRANCH" "$PATCH_BRANCH"

old_main=$(git rev-parse --short "$FORK/$MAIN_BRANCH")
new_main=$(git rev-parse --short "$UPSTREAM/$MAIN_BRANCH")
pulled=$(git rev-list --count "$FORK/$MAIN_BRANCH..$UPSTREAM/$MAIN_BRANCH")
carried=$(git rev-list --count "$UPSTREAM/$MAIN_BRANCH..$FORK/$PATCH_BRANCH" 2>/dev/null || echo '?')

if [ "$pulled" -eq 0 ]; then
  echo "== fork $MAIN_BRANCH already up to date with upstream ($new_main)"
else
  echo "== updating fork $MAIN_BRANCH: $old_main -> $new_main ($pulled upstream commits)"
  # Plain push refuses non-fast-forward — exactly the guard we want (fork master
  # must never diverge; patches belong on $PATCH_BRANCH).
  git push "$FORK" "$UPSTREAM/$MAIN_BRANCH:refs/heads/$MAIN_BRANCH"
fi

echo "== rebasing $PATCH_BRANCH onto $new_main"
orig_ref=$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)

# Local patch branch: create from the fork if absent; refuse if it diverged from
# what's on GitHub (don't silently discard local-only patch work).
if git rev-parse --verify --quiet "$PATCH_BRANCH" >/dev/null; then
  local_sha=$(git rev-parse "$PATCH_BRANCH")
  remote_sha=$(git rev-parse "$FORK/$PATCH_BRANCH")
  if [ "$local_sha" != "$remote_sha" ] && ! git merge-base --is-ancestor "$local_sha" "$remote_sha"; then
    echo "FATAL: local $PATCH_BRANCH ($local_sha) has commits not on $FORK/$PATCH_BRANCH — reconcile first" >&2
    exit 2
  fi
  git checkout -q "$PATCH_BRANCH"
  git reset -q --hard "$FORK/$PATCH_BRANCH"
else
  git checkout -q -b "$PATCH_BRANCH" "$FORK/$PATCH_BRANCH"
fi

if ! git rebase "$UPSTREAM/$MAIN_BRANCH"; then
  git rebase --abort
  git checkout -q "$orig_ref"
  cat >&2 <<EOF
REBASE CONFLICT: the supastack patches no longer apply cleanly onto upstream.
Resolve manually:
  cd $DIR
  git checkout $PATCH_BRANCH
  git rebase $UPSTREAM/$MAIN_BRANCH      # fix conflicts, git rebase --continue
  git push --force-with-lease $FORK $PATCH_BRANCH
EOF
  exit 1
fi

git push --force-with-lease "$FORK" "$PATCH_BRANCH"
new_sha=$(git rev-parse --short HEAD)

# Leave the checkout on the freshly rebased branch only if it started there.
case "$orig_ref" in
  "$PATCH_BRANCH") ;;
  *) git checkout -q "$orig_ref" ;;
esac

cat <<EOF
== done
   fork $MAIN_BRANCH:   $old_main -> $new_main ($pulled upstream commits)
   $PATCH_BRANCH: rebased ($carried patch commit(s) carried) -> $new_sha

Next: rebuild + redeploy the platform Studio image from the new head:
   docker build $DIR -f infra/studio-platform/Dockerfile -t supastack/studio-platform:$new_sha
EOF
