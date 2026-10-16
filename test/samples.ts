// Locates the sample document pair (default: docs/ in the repository; SAMPLES_DIR overrides it).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe } from 'vitest';

export const SAMPLES_DIR = resolve(process.env.SAMPLES_DIR ?? resolve(import.meta.dirname, '../docs'));

export const ORIGINAL_SAMPLE = resolve(SAMPLES_DIR, 'aramlo-part-2-2025-05-06.docx');
export const EDITED_SAMPLE = resolve(SAMPLES_DIR, 'aramlo-part-2-2025-05-06.edited-until-p257.docx');

export const samplesAvailable = existsSync(ORIGINAL_SAMPLE) && existsSync(EDITED_SAMPLE);

export function readSamples(): { original: Uint8Array; edited: Uint8Array } {
  return {
    original: new Uint8Array(readFileSync(ORIGINAL_SAMPLE)),
    edited: new Uint8Array(readFileSync(EDITED_SAMPLE)),
  };
}

/** A `describe` that is skipped when the sample documents are not present (e.g. in CI). */
export const describeWithSamples = describe.skipIf(!samplesAvailable);
