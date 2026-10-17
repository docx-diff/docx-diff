export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** `<edited name without .docx>.reviewed.docx` (FR-43). */
export function reviewedFileName(editedName: string): string {
  return `${editedName.replace(/\.docx$/i, '')}.reviewed.docx`;
}

/** Hands the bytes to the browser as a file download. */
export function saveDocx(bytes: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_TYPE }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke later: some browsers read the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
