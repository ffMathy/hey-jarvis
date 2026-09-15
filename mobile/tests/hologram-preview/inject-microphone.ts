/**
 * Plays a recording into an Android emulator's microphone.
 *
 * The emulator's gRPC controller has `injectAudio`, a client-streaming call that
 * feeds the virtual microphone. No gRPC tooling is needed for one call: this
 * speaks HTTP/2 through `node:http2` and encodes the two small protobuf messages
 * by hand (see `emulator/lib/emulator_controller.proto` in the Android SDK). The
 * emulator must have been started with `-grpc <port>`, which also turns off its
 * token check, and without `-no-audio`.
 *
 * The audio is sent a little ahead of real time, well inside the 300 ms the
 * emulator buffers, so what the app hears keeps the recording's own timing.
 *
 * Usage: bun inject-microphone.ts <16 kHz mono 16-bit PCM file> <port> [--loop]
 */
import { readFileSync } from 'node:fs';
import { connect } from 'node:http2';

const SAMPLE_RATE = 16000;
/** 20 ms a message. */
const SAMPLES_PER_MESSAGE = 320;
/** How far ahead of real time to keep the emulator's buffer filled. */
const LEAD_MS = 100;
const TICK_MS = 20;

/** A protobuf varint. */
function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return bytes;
}

/** `AudioFormat { samplingRate: 16000, channels: Mono (0, the default), format: AUD_FMT_S16 (1) }`. */
const AUDIO_FORMAT = Buffer.from([0x08, ...varint(SAMPLE_RATE), 0x18, 0x01]);

/** One gRPC message holding an `AudioPacket`. Only the first needs the format; the emulator ignores it after that. */
function audioPacketMessage(audio: Buffer, withFormat: boolean): Buffer {
  const packet = Buffer.concat([
    ...(withFormat ? [Buffer.from([0x0a, ...varint(AUDIO_FORMAT.length)]), AUDIO_FORMAT] : []),
    Buffer.from([0x1a, ...varint(audio.length)]),
    audio,
  ]);
  const header = Buffer.alloc(5);
  header.writeUInt32BE(packet.length, 1);
  return Buffer.concat([header, packet]);
}

const [file, portText, loopFlag] = process.argv.slice(2);
if (!file || !portText) {
  throw new Error('Usage: bun inject-microphone.ts <16 kHz mono 16-bit PCM file> <port> [--loop]');
}
const loop = loopFlag === '--loop';
const pcm = readFileSync(file);
const bytesPerMessage = SAMPLES_PER_MESSAGE * 2;

const session = connect(`http://127.0.0.1:${portText}`);
const call = session.request({
  ':method': 'POST',
  ':path': '/android.emulation.control.EmulatorController/injectAudio',
  'content-type': 'application/grpc',
  te: 'trailers',
});

let failed = false;
const fail = (message: string) => {
  failed = true;
  console.error(message);
};
/** gRPC reports a refusal in the headers of an immediate failure, or in the trailers of a normal one. */
const checkStatus = (headers: Record<string, string | string[] | undefined>) => {
  const status = headers['grpc-status'];
  if (status !== undefined && status !== '0') {
    fail(`The emulator refused the audio: gRPC status ${status} ${headers['grpc-message'] ?? ''}`);
  }
};
session.on('error', (error) => fail(`Could not reach the emulator on port ${portText}: ${error.message}`));
call.on('error', (error) => fail(`The injection failed: ${error.message}`));
call.on('response', checkStatus);
call.on('trailers', checkStatus);
call.on('data', () => {});
call.on('close', () => {
  session.close();
  process.exit(failed ? 1 : 0);
});

let sentBytes = 0;
const startedAt = Date.now();
const timer = setInterval(() => {
  const dueBytes = Math.floor(((Date.now() - startedAt + LEAD_MS) / 1000) * SAMPLE_RATE) * 2;
  while (sentBytes < dueBytes && (loop || sentBytes < pcm.length)) {
    const offset = sentBytes % pcm.length;
    const chunk = Buffer.from(pcm.subarray(offset, Math.min(offset + bytesPerMessage, pcm.length)));
    call.write(audioPacketMessage(chunk, sentBytes === 0));
    sentBytes += chunk.length;
  }
  if (!loop && sentBytes >= pcm.length) {
    clearInterval(timer);
    call.end();
  }
}, TICK_MS);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    call.end();
  });
}
