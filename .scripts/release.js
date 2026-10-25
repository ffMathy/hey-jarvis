// Works out the release a push to `main` cuts: the next version, from the conventional commits since
// the last release tag, and the notes that go on its GitHub Release.
//
// Plain Node with no dependencies, because `release.yml` runs it straight on the runner, whose
// preinstalled `node` is all it needs — no `bun install`, and no action beyond `actions/checkout`.
//
//   node .scripts/release.js <commit> [output]
//
// prints the notes, and appends `version`, `tag` and `notes` (a file path) to `output` — the step's
// `$GITHUB_OUTPUT` — or appends nothing when there is nothing to release.

const { execFileSync } = require('node:child_process');
const { appendFileSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Kept from the Release Please days, so the tags it cut stay the history this continues from.
const TAG_PREFIX = 'root-v';

const REPOSITORY_URL = 'https://github.com/ffMathy/hey-jarvis';

// In the order the notes list them. Every type commitlint accepts has a section, and a commit that is
// not a conventional commit at all lands under "Other changes", so no merge goes unlisted.
const SECTIONS = [
  { type: 'feat', title: 'Features' },
  { type: 'fix', title: 'Bug Fixes' },
  { type: 'perf', title: 'Performance Improvements' },
  { type: 'refactor', title: 'Code Refactoring' },
  { type: 'docs', title: 'Documentation' },
  { type: 'revert', title: 'Reverts' },
  { type: 'build', title: 'Build System' },
  { type: 'ci', title: 'Continuous Integration' },
  { type: 'test', title: 'Tests' },
  { type: 'style', title: 'Styles' },
  { type: 'chore', title: 'Miscellaneous' },
];

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?: (?<subject>.+)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;

/**
 * Reads one commit. Only the subject line is parsed as a header: a squash merge's body is the pull
 * request description, and nothing in it — code samples included — can stop the commit releasing.
 */
function parseCommit(sha, message) {
  const [header] = message.split('\n', 1);
  const match = HEADER.exec(header.trim());
  if (!match) {
    return { sha, type: null, scope: null, subject: header.trim(), breaking: false };
  }
  const { type, scope, bang, subject } = match.groups;
  return { sha, type, scope: scope || null, subject, breaking: Boolean(bang) || BREAKING_FOOTER.test(message) };
}

/** `feat` raises the minor version, a breaking change the major, and every other commit the patch. */
function nextVersion(current, commits) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (commits.some((commit) => commit.breaking)) {
    return `${major + 1}.0.0`;
  }
  if (commits.some((commit) => commit.type === 'feat')) {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function renderEntry(commit) {
  const scope = commit.scope ? `**${commit.scope}:** ` : '';
  const link = `([${commit.sha.slice(0, 7)}](${REPOSITORY_URL}/commit/${commit.sha}))`;
  return `* ${scope}${commit.subject} ${link}`;
}

/** The notes in the shape Release Please wrote them, so the releases before and after read alike. */
function renderNotes({ version, previousTag, commits, date }) {
  const heading = previousTag
    ? `## [${version}](${REPOSITORY_URL}/compare/${previousTag}...${TAG_PREFIX}${version}) (${date})`
    : `## ${version} (${date})`;
  const blocks = [heading];

  const breaking = commits.filter((commit) => commit.breaking);
  if (breaking.length > 0) {
    blocks.push(['### ⚠ BREAKING CHANGES', ...breaking.map(renderEntry)].join('\n\n'));
  }

  const known = new Set(SECTIONS.map((section) => section.type));
  const sections = [
    ...SECTIONS.map(({ type, title }) => ({ title, entries: commits.filter((commit) => commit.type === type) })),
    { title: 'Other changes', entries: commits.filter((commit) => !known.has(commit.type)) },
  ];
  for (const { title, entries } of sections) {
    if (entries.length > 0) {
      blocks.push([`### ${title}`, entries.map(renderEntry).join('\n')].join('\n\n'));
    }
  }

  return `${blocks.join('\n\n')}\n`;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function latestTag(commit) {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', `${TAG_PREFIX}*`, commit).trim();
  } catch {
    return null;
  }
}

/** The commits `commit` adds since `previousTag`, oldest first, merges left out. */
function commitsSince(previousTag, commit) {
  const range = previousTag ? `${previousTag}..${commit}` : commit;
  return git('log', '--reverse', '--no-merges', '--format=%H%x1f%B%x1e', range)
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, message] = record.split('\x1f');
      return parseCommit(sha, message);
    });
}

function main() {
  const [commit = 'HEAD', output] = process.argv.slice(2);
  const previousTag = latestTag(commit);
  const commits = commitsSince(previousTag, commit);
  if (commits.length === 0) {
    console.log(`Nothing has landed since ${previousTag}; no release.`);
    return;
  }

  const current = previousTag ? previousTag.slice(TAG_PREFIX.length) : '0.0.0';
  const version = nextVersion(current, commits);
  const date = new Date().toISOString().slice(0, 10);
  const notes = renderNotes({ version, previousTag, commits, date });

  const notesPath = path.join(os.tmpdir(), 'release-notes.md');
  writeFileSync(notesPath, notes);
  console.log(notes);

  if (output) {
    appendFileSync(output, `version=${version}\ntag=${TAG_PREFIX}${version}\nnotes=${notesPath}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { TAG_PREFIX, parseCommit, nextVersion, renderNotes };
