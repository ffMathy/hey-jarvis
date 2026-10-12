#!/bin/bash
# Keeps one comment of ours on a pull request up to date instead of adding a new
# one each time: edits the comment carrying the marker if there is one, and posts
# it otherwise.
#
#   upsert-pr-comment.sh <pr> <marker> < body
#   upsert-pr-comment.sh <pr> <marker> --update-only < body
#
# `--update-only` leaves a pull request without the comment alone, for messages
# that only make sense as a follow-up to it.
#
# The marker goes into the comment as an HTML comment, so it is invisible on the
# page, and only comments by the workflow's own bot are considered, so nobody
# else's comment can be picked up and overwritten.
#
# Needs GH_TOKEN (pull-requests: write) and GITHUB_REPOSITORY, as a workflow has them.

set -euo pipefail

pr=$1
marker="<!-- $2 -->"
mode=${3:-}
body="$marker
$(cat)"

ids=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$pr/comments" \
	--jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"$marker\"))) | .id")
id=${ids%%$'\n'*}

if [ -n "$id" ]; then
	gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body" >/dev/null
	echo "Updated comment $id on #$pr."
elif [ "$mode" != --update-only ]; then
	gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" -f body="$body" >/dev/null
	echo "Commented on #$pr."
else
	echo "#$pr has no comment to update."
fi
