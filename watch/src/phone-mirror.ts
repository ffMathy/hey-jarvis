import { createSphereMirror, type JarvisVoice, MIRROR_STALE_MS, type MirrorFrame, type UserVoice } from 'hologram';
import { useEffect, useMemo, useState } from 'react';
import { whenThePhoneMirrors } from '../modules/jarvis-phone';

/** What the sphere is handed while it shows the phone's conversation. */
interface MirroredSphere {
  voice: JarvisVoice;
  user: UserVoice | undefined;
  thinking: boolean;
}

/**
 * Him as he is on the phone, while the phone holds the conversation this watch was summoned for.
 *
 * The phone sends a frame of its sphere a dozen times a second (`use-watch-mirror.ts` in `mobile/`),
 * and this hands the frames to the watch's sphere: his volume and spectrum through the readers it
 * polls, and whether he is talking, listening or thinking as the props it renders from. So he moves
 * on the wrist as he would if the conversation were here, and nothing on the screen says it is not.
 *
 * Only while `following`. When the phone says he has stopped, or goes quiet for
 * {@link MIRROR_STALE_MS}, he comes to rest.
 */
export function usePhoneMirror(following: boolean): MirroredSphere {
  const mirror = useMemo(() => createSphereMirror(Date.now), []);
  const [frame, setFrame] = useState<MirrorFrame>(() => mirror.current(Date.now()));

  useEffect(() => {
    if (!following) {
      mirror.receive([], Date.now());
      setFrame(mirror.current(Date.now()));
      return;
    }
    let stale: ReturnType<typeof setTimeout> | undefined;
    const stop = whenThePhoneMirrors((received) => {
      if (mirror.receive(received, Date.now())) {
        setFrame(mirror.current(Date.now()));
      }
      // A phone gone out of range says nothing, so silence is looked for too.
      clearTimeout(stale);
      stale = setTimeout(() => setFrame(mirror.current(Date.now())), MIRROR_STALE_MS + 1);
    });
    return () => {
      stop();
      clearTimeout(stale);
    };
  }, [following, mirror]);

  const voice = useMemo(
    () => ({ listening: frame.listening, speaking: frame.speaking, ...mirror.voice }),
    [frame.listening, frame.speaking, mirror],
  );
  return { voice, user: frame.hasUser ? mirror.user : undefined, thinking: frame.thinking };
}
