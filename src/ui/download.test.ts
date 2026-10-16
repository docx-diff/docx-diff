import { describe, expect, it } from 'vitest';
import { reviewedFileName } from './download';

describe('reviewedFileName', () => {
  it('replaces the .docx extension with .reviewed.docx', () => {
    expect(reviewedFileName('chapter.edited.docx')).toBe('chapter.edited.reviewed.docx');
    expect(reviewedFileName('CHAPTER.DOCX')).toBe('CHAPTER.reviewed.docx');
  });
});
