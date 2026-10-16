// Checks an exported .docx with Docxodus' package verification (FR-42), against the Original as
// the baseline, so that findings the Original already had don't fail it.
import { verifyDeliverable } from 'docxodus/core';
import { expect } from 'vitest';

export async function expectDeliverable(exported: Uint8Array, original: Uint8Array): Promise<void> {
  const result = await verifyDeliverable(exported, original);
  const findings = result.findings.filter((finding) => finding.disposition !== 'preExisting').slice(0, 5);
  expect(['passed', 'passedWithPreExistingFindings'], JSON.stringify(findings.map((f) => `${f.code}: ${f.message}`))).toContain(result.decision);
}
