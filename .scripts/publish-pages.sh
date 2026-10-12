#!/bin/bash
# Writes one part of the GitHub Pages site on the `gh-pages` branch, and leaves the
# rest of the site as it is.
#
#   publish-pages.sh "" <site-dir>          the released site, at the root
#   publish-pages.sh pr/<n> <site-dir>      pull request <n>'s preview
#   publish-pages.sh pr/<n>                 takes that preview down again
#
# The release owns everything at the root except `pr/`, and each pull request owns
# its own folder under it, so the runs that write them never touch each other's
# files. They can still race for the branch, so a push only lands on the commit it
# was built from (`--force-with-lease`) and is rebuilt from the new one when it lost.
#
# The branch is always one commit: every preview carries a copy of the wasm and the
# models, and a history of them would grow the repository by that on every push.
#
# Needs GH_TOKEN (contents: write) and GITHUB_REPOSITORY, as a workflow has them.

set -euo pipefail

target=$1
site=${2:-}
branch=gh-pages

if [ -n "$target" ] && ! [[ "$target" =~ ^pr/[0-9]+$ ]]; then
	echo "Refusing to publish to '$target': only the root or pr/<number> are ours to write." >&2
	exit 1
fi
if [ -n "$site" ]; then
	site=$(cd "$site" && pwd)
elif [ -z "$target" ]; then
	echo "Refusing to empty the whole site: the root needs a site to publish." >&2
	exit 1
fi

remote="https://github.com/${GITHUB_REPOSITORY}.git"
auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
git_remote() {
	git -c "http.https://github.com/.extraheader=$auth" "$@"
}

publish_once() {
	local work lease new_tree commit
	work=$(mktemp -d)
	cd "$work"
	git init -q
	git config user.name 'github-actions[bot]'
	git config user.email '41898299+github-actions[bot]@users.noreply.github.com'

	# An empty lease means "the branch must not exist yet", which is right for the first run.
	lease=''
	if git_remote ls-remote --exit-code --heads "$remote" "$branch" >/dev/null; then
		git_remote fetch -q --depth=1 "$remote" "refs/heads/$branch"
		lease=$(git rev-parse FETCH_HEAD)
		git read-tree --reset -u FETCH_HEAD
	fi

	if [ -z "$target" ]; then
		find . -mindepth 1 -maxdepth 1 ! -name .git ! -name pr -exec rm -rf {} +
		cp -r "$site/." .
	else
		rm -rf "$target"
		if [ -n "$site" ]; then
			mkdir -p "$target"
			cp -r "$site/." "$target/"
		fi
	fi
	# Without it Pages runs the branch through Jekyll, which drops every path starting
	# with an underscore — and the phone app's whole bundle is under `_expo/`.
	touch .nojekyll

	git add -A
	new_tree=$(git write-tree)
	if [ -n "$lease" ] && [ "$new_tree" = "$(git rev-parse "$lease^{tree}")" ]; then
		echo "The site already holds exactly this; nothing to publish."
		return 0
	fi

	commit=$(git commit-tree "$new_tree" -m "Publish ${target:-the released site}")
	git_remote push -q --force-with-lease="refs/heads/$branch:$lease" "$remote" "$commit:refs/heads/$branch"
}

for attempt in 1 2 3 4 5; do
	# Not `if (publish_once)`: bash ignores `set -e` inside a condition, so a step that
	# failed there would carry on and push whatever half a site it had.
	set +e
	(
		set -e
		publish_once
	)
	status=$?
	set -e
	if [ "$status" -eq 0 ]; then
		exit 0
	fi
	echo "Attempt $attempt lost the race for $branch; rebuilding on what is there now." >&2
	sleep $((attempt * 2))
done

echo "Could not publish to $branch after 5 attempts." >&2
exit 1
