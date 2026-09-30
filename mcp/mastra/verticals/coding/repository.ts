import type { AffectedEntity } from '../../utils/affected-entities.js';

/** The GitHub account a coding request is about when it names none. */
export const DEFAULT_OWNER = 'ffMathy';

/**
 * The repository a coding request is about when it names none: Jarvis's own.
 *
 * "Add a tool that…", "fix the bug where…" — asked of Jarvis, a change with no repository named is
 * a change to Jarvis, so it is filed and implemented here rather than asked about.
 */
export const DEFAULT_REPOSITORY = 'hey-jarvis';

/**
 * A repository as sir's headset records it: by its full name, with the repository's own name to
 * show.
 *
 * The full name is lower-cased because GitHub reads owner and repository names in any case, and the
 * headset matches by id -- `ffMathy/hey-jarvis` and `ffmathy/hey-jarvis` are one repository.
 */
export function describeRepository(owner: string | undefined, repository: string | undefined): AffectedEntity {
  const name = repository || DEFAULT_REPOSITORY;
  return { id: `${owner || DEFAULT_OWNER}/${name}`.toLowerCase(), name };
}
