import { useAgentVoice } from 'hologram/conversation';
import type { UseJarvisVoice } from './platform-contracts';

/**
 * The conversation's output audio in a browser: the SDK measures it with Web
 * Audio's `AnalyserNode`, which reads it well, so it is used as it comes.
 *
 * The whole of it lives in `hologram/conversation` now, because the watch needs exactly this and for
 * the same reason — no native audio tap, and an SDK that reads well enough without one. This file
 * remains only to be the `.web.ts` half of the platform split: Metro picks between it and
 * `jarvis-voice.ts`, which prefers the phone's tapped track. See `platform-contracts.ts`.
 */
export const useJarvisVoice: UseJarvisVoice = useAgentVoice;
