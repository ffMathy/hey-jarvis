import { SPECTRUM_BIN_COUNT, voiceRangeBins } from 'hologram';
import { useEffect, useMemo, useState } from 'react';
import type { JarvisVoice, UseSampleVoice } from './platform-contracts';

/**
 * The analyser the ElevenLabs web SDK reads Jarvis's voice with — an `fftSize` of
 * 2048 and smoothing of 0.8, with the default decibel range — so sample mode in a
 * browser looks the way a conversation in one does.
 */
const ANALYSER_OPTIONS: AnalyserOptions = {
  fftSize: 2048,
  smoothingTimeConstant: 0.8,
  minDecibels: -100,
  maxDecibels: -30,
};

const NOT_LISTENING: JarvisVoice = {
  listening: false,
  speaking: false,
  getVolume: () => 0,
  getSpectrum: () => new Uint8Array(0),
};

interface OpenMicrophone {
  analyser: AnalyserNode;
  close: () => void;
}

/**
 * Opens the microphone into an analyser, or says why it could not. Nothing is
 * connected to the speakers, so the user does not hear themselves.
 */
async function openMicrophone(): Promise<OpenMicrophone | string> {
  if (!navigator.mediaDevices) {
    return 'The microphone is only available to a page on a secure (https) address.';
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return 'The hologram needs the microphone to hear you.';
  }

  const context = new AudioContext();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = new AnalyserNode(context, ANALYSER_OPTIONS);
  source.connect(analyser);

  return {
    analyser,
    close: () => {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      source.disconnect();
      void context.close();
    },
  };
}

/**
 * The two readings, taken from an analyser the way the ElevenLabs web SDK takes
 * them from Jarvis's: the spectrum resampled onto 100–8000 Hz, and the volume as
 * that spectrum's mean — not an RMS, as on Android — so that in a browser the
 * user's voice and Jarvis's move the hologram on the same scale.
 */
function voiceOf(analyser: AnalyserNode): JarvisVoice {
  const rawSpectrum = new Uint8Array(analyser.frequencyBinCount);
  const spectrum = new Uint8Array(SPECTRUM_BIN_COUNT);
  const bins = voiceRangeBins(analyser.context.sampleRate / analyser.fftSize, analyser.frequencyBinCount);

  const readSpectrum = () => {
    analyser.getByteFrequencyData(rawSpectrum);
    for (let value = 0; value < spectrum.length; value++) {
      spectrum[value] = rawSpectrum[bins[value] ?? 0] ?? 0;
    }
    return spectrum;
  };

  return {
    listening: true,
    speaking: true,
    getVolume: () => {
      let sum = 0;
      for (const value of readSpectrum()) {
        sum += value;
      }
      return sum / spectrum.length / 255;
    },
    getSpectrum: readSpectrum,
  };
}

/**
 * The user's own voice in a browser, for sample mode: the microphone through Web
 * Audio's `AnalyserNode`, read into the same two numbers as everywhere else.
 */
export const useSampleVoice: UseSampleVoice = (listening) => {
  const [analyser, setAnalyser] = useState<AnalyserNode | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!listening) {
      return;
    }
    let isCurrent = true;
    let close: (() => void) | undefined;

    void openMicrophone().then((result) => {
      if (typeof result === 'string') {
        if (isCurrent) {
          setProblem(result);
        }
        return;
      }
      if (!isCurrent) {
        result.close();
        return;
      }
      close = result.close;
      setAnalyser(result.analyser);
    });

    return () => {
      isCurrent = false;
      close?.();
      setAnalyser(undefined);
    };
  }, [listening]);

  const voice = useMemo(() => (analyser ? voiceOf(analyser) : NOT_LISTENING), [analyser]);

  return { voice, problem };
};
