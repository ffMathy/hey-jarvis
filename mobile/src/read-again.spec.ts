import { describe, expect, it } from 'bun:test';
import { READ_ATTEMPTS, readTryingAgain } from './read-again';

/** Something kept in the keystore, the way `settings-storage.ts` and `jarvis-server.ts` answer. */
type Stored = { kind: 'address'; address: string } | { kind: 'nothing' } | { kind: 'unreadable' };

/** A read that answers each attempt in turn, and counts them. */
function readAnswering(...answers: Stored[]) {
  let attempts = 0;
  const read = async (): Promise<Stored> => {
    const answer = answers[Math.min(attempts, answers.length - 1)] ?? { kind: 'unreadable' };
    attempts += 1;
    return answer;
  };
  return { read, attempts: () => attempts };
}

const ADDRESS: Stored = { kind: 'address', address: 'https://jarvis.example.com' };
const UNREADABLE: Stored = { kind: 'unreadable' };

describe('reading something kept in the keystore', () => {
  it('answers with what was read the first time it can be read', async () => {
    const { read, attempts } = readAnswering(ADDRESS);

    expect(await readTryingAgain(read, () => true)).toEqual(ADDRESS);
    expect(attempts()).toBe(1);
  });

  it('takes nothing kept for an answer, rather than trying again', async () => {
    const { read, attempts } = readAnswering({ kind: 'nothing' });

    expect(await readTryingAgain(read, () => true)).toEqual({ kind: 'nothing' });
    expect(attempts()).toBe(1);
  });

  it('tries again when the reading failed, which a window still coming up does', async () => {
    const { read, attempts } = readAnswering(UNREADABLE, ADDRESS);

    expect(await readTryingAgain(read, () => true)).toEqual(ADDRESS);
    expect(attempts()).toBe(2);
  });

  it('gives up after a handful of failed reads, with no answer', async () => {
    const { read, attempts } = readAnswering(UNREADABLE);

    expect(await readTryingAgain(read, () => true)).toBeUndefined();
    expect(attempts()).toBe(READ_ATTEMPTS);
  });

  it('stops trying once nobody wants the answer', async () => {
    const { read, attempts } = readAnswering(UNREADABLE);
    let wanted = true;
    const reading = readTryingAgain(
      async () => {
        wanted = false;
        return read();
      },
      () => wanted,
    );

    expect(await reading).toBeUndefined();
    expect(attempts()).toBe(1);
  });
});
