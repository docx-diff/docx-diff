import { describe, expect, it } from 'vitest';
import { authorInitials } from './comments';
import { presentDecision } from './trackedRevisions';

describe('presentDecision', () => {
  it('keeps the content of an insertion or a move by accepting it, of a deletion by rejecting it', () => {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    expect(presentDecision({ constituentKeys: [`kind=Content:${ns}:ins:1`, `kind=ParaMark:${ns}:ins:2`] })).toBe('accept');
    expect(presentDecision({ constituentKeys: [`kind=Content:${ns}:del:1`, `kind=ParaMark:${ns}:del:2`] })).toBe('reject');
    expect(presentDecision({ constituentKeys: [`kind=Content:${ns}:moveFrom:1:name=m`, `kind=Content:${ns}:moveTo:2:name=m`] })).toBe('accept');
  });
});

describe('authorInitials', () => {
  it('takes the first letter of each word, at most three', () => {
    expect(authorInitials('ann bee')).toBe('AB');
    expect(authorInitials('  Ádám Béla Csaba Dénes ')).toBe('ÁBC');
    expect(authorInitials('')).toBe('R');
  });
});
