import { howLongAgo, photosWaiting } from '../vision/photos.js';
import { QUESTION_REMINDER_INTERVAL_MS } from './questions.js';

/**
 * Photos sir sent that nobody has looked at yet, brought up the way an open question is.
 *
 * A photo arrives in one conversation, and used to be looked at only if that same conversation went
 * on to ask about it: he could take one and say nothing, or hang up before saying what it was for,
 * and it sat in the store until it was let go of. Now a photo nobody has looked at is *waiting*
 * (`photosWaiting` in `vision/photos.ts`), and whatever request he makes next has it brought up in
 * its closing report, beside the questions earlier work is waiting on (see `takeQuestionsToBringUp`
 * in `questions.ts`) — so Jarvis asks what he would like done with it.
 *
 * His reply is not an answer to be handed back, as a question's is: "add everything on it to the
 * shopping list" is itself a request, so it is routed and planned like one. The planner is shown every
 * waiting photo (see `plannerPrompt`), and plans the vision agent looking at it and whatever acts on
 * what it shows. Once the vision agent has looked, the photo is no longer waiting. "Nothing, never
 * mind" is the one reply that is not work: the planner dismisses the photo (`dismissedPhotoIds`), and
 * it stops waiting just the same, without the request being reported as one nothing could handle.
 *
 * Routing depends on vision here, and never the other way round: the photo store knows nothing of
 * conversations, reminders or the voice agent.
 */

/**
 * How long a photo has to have waited, unlooked-at, before it is brought up.
 *
 * The conversation that sent a photo routes it within seconds — straight away if sir has said what
 * it is for, or as soon as he answers being asked — so without this, a request that happened to
 * finish in between would ask him about the photo he had only just shown.
 *
 * A grace, not a guarantee. Nothing here knows which conversation sent a photo, so if sir is asked
 * what it is for and asks for something else instead — a briefing that runs past the minute — that
 * request's report can bring the photo up again in the same conversation. That is the reminder doing
 * for a photo what it does for any question he moved on from, and the question is worded to read
 * that way.
 */
export const PHOTO_WAITING_GRACE_MS = 60_000;

/** What Jarvis asks about one waiting photo, as a closing report hands it to him. */
export interface PhotoToBringUp {
  /** The photo's id, such as `photo3`, which is what his reply names it by. */
  id: string;
  question: string;
}

/** When Jarvis last brought each waiting photo up in a reply, by photo id. */
const lastBroughtUpAtByPhotoId = new Map<string, number>();

/** What Jarvis is told to ask about a photo that has been waiting since `keptAt`. */
function questionAbout(photoId: string, keptAt: number, now: number): string {
  return `Sir sent you a photo ${howLongAgo(now - keptAt)} (${photoId}) that nobody has looked at yet: ask him what he would like done with it.`;
}

/**
 * The waiting photos Jarvis should bring up in his reply to sir, marked as brought up.
 *
 * Only those that have waited past {@link PHOTO_WAITING_GRACE_MS}, and not those brought up within
 * {@link QUESTION_REMINDER_INTERVAL_MS} — the same interval an open question is left alone for, so a
 * conversation hears about a photo once rather than after every request. A photo is kept for as long
 * as that interval (`KEEP_PHOTO_MS`), so in practice it is brought up once. If sir says he wants
 * nothing done with it, it stops waiting there and then; if he never answers, it is let go of with
 * the rest of the store.
 */
export function takePhotosToBringUp(now = Date.now()): PhotoToBringUp[] {
  const waiting = photosWaiting(now);

  // A photo that is no longer waiting — looked at, or let go of — has nothing left to remind anyone
  // of, so this map never holds more than the store does.
  const waitingIds = new Set(waiting.map((photo) => photo.photoId));
  for (const photoId of lastBroughtUpAtByPhotoId.keys()) {
    if (!waitingIds.has(photoId)) {
      lastBroughtUpAtByPhotoId.delete(photoId);
    }
  }

  const due = waiting.filter(
    (photo) =>
      now - photo.keptAt >= PHOTO_WAITING_GRACE_MS &&
      now - (lastBroughtUpAtByPhotoId.get(photo.photoId) ?? Number.NEGATIVE_INFINITY) >= QUESTION_REMINDER_INTERVAL_MS,
  );

  for (const photo of due) {
    lastBroughtUpAtByPhotoId.set(photo.photoId, now);
  }
  return due.map((photo) => ({ id: photo.photoId, question: questionAbout(photo.photoId, photo.keptAt, now) }));
}

/** Forgets when each photo was brought up. Used by tests. */
export function forgetWaitingPhotoReminders(): void {
  lastBroughtUpAtByPhotoId.clear();
}
