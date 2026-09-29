import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The wake-word models are committed, byte for byte what openWakeWord published.
 *
 * They are the one part of the app nobody can review in a diff, and the wake pipeline is only
 * verified against these exact graphs (the port was checked frame by frame against the Python
 * package running them). A re-export, a different release or a truncated copy would still load
 * and still produce numbers — just the wrong ones — so the only honest check is the hash.
 * These are the SHA-256 values of openWakeWord's v0.5.1 release assets, as listed in
 * public/models/LICENCE.txt.
 */
const MODELS_FOLDER = path.join(import.meta.dir, '../../public/models');

const PUBLISHED_SHA256: Record<string, string> = {
  'melspectrogram.onnx': 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f',
  'embedding_model.onnx': '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f',
  'hey_jarvis_v0.1.onnx': '94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb',
};

function sha256Of(file: string) {
  return new Bun.CryptoHasher('sha256').update(readFileSync(path.join(MODELS_FOLDER, file))).digest('hex');
}

describe('the committed wake-word models', () => {
  for (const [file, published] of Object.entries(PUBLISHED_SHA256)) {
    it(`${file} is openWakeWord's v0.5.1 file, unchanged`, () => {
      expect(sha256Of(file)).toBe(published);
    });
  }

  it('ship with their licence, which names the licence and the author', () => {
    const licence = readFileSync(path.join(MODELS_FOLDER, 'LICENCE.txt'), 'utf8');
    expect(licence).toContain('CC BY-NC-SA 4.0');
    expect(licence).toContain('David Scripka');
    for (const [file, published] of Object.entries(PUBLISHED_SHA256)) {
      expect(licence).toContain(`${published}  ${file}`);
    }
  });
});
