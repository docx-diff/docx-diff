// Checks an exported .docx with Docxodus' package verification (FR-42), against the Original as
// the baseline, so that findings the Original already had don't fail it.
import { verifyDeliverable } from 'docxodus/core';
import { expect } from 'vitest';

export async function expectDeliverable(exported: Uint8Array, original: Uint8Array): Promise<void> {
  const result = await verifyDeliverable(exported, original);
  const findings = result.findings.filter((finding) => finding.disposition !== 'preExisting').slice(0, 5);
  expect(['passed', 'passedWithPreExistingFindings'], JSON.stringify(findings.map((f) => `${f.code}: ${f.message}`))).toContain(result.decision);
}

/**
 * Checks an export that keeps tracked changes (FR-38b). The verification reads tracked markup as
 * Word's All Markup view: a tracked deleted field has no instruction text (`w:delInstrText` isn't
 * one) and a moved note reference counts twice, so the engine's own redline has such findings too.
 * Findings of a code the redline also has are allowed.
 */
export async function expectTrackedDeliverable(exported: Uint8Array, original: Uint8Array, redline: Uint8Array): Promise<void> {
  const own = (result: Awaited<ReturnType<typeof verifyDeliverable>>) => result.findings.filter((finding) => finding.disposition !== 'preExisting');
  const inherent = new Set(own(await verifyDeliverable(redline, original)).map((finding) => finding.code));
  const findings = own(await verifyDeliverable(exported, original)).filter((finding) => !inherent.has(finding.code));
  expect(findings.slice(0, 5).map((f) => `${f.code}: ${f.message}`)).toEqual([]);
}
