// Who made a document's changes (FR-38c), to pre-fill the export's author: the author of most of
// its own tracked changes, else the document properties' last author (`cp:lastModifiedBy`), else
// its creator (`dc:creator`). The Edited is usually a copy of the Original, so its creator is the
// Original's author, and comes last.
import { strFromU8, unzipSync } from 'fflate';
import { parseXml } from './ooxml';

const CORE_PART = 'docProps/core.xml';
const DOCUMENT_PART = 'word/document.xml';
const CP_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC_NS = 'http://purl.org/dc/elements/1.1/';

/** A tracked change's opening tag with its author (any namespace prefix). */
const TRACKED_AUTHOR = /<(?:\w+:)?(?:ins|del|moveFrom|moveTo)\s[^>]*?\b(?:\w+:)?author="([^"]*)"/g;

/** The document's author, or `null` when it names none. */
export function documentAuthor(bytes: Uint8Array): string | null {
  const files = unzipSync(bytes, { filter: (file) => file.name === CORE_PART || file.name === DOCUMENT_PART });
  const counts = new Map<string, number>();
  for (const match of files[DOCUMENT_PART] ? strFromU8(files[DOCUMENT_PART]).matchAll(TRACKED_AUTHOR) : []) {
    const author = decodeEntities(match[1]!).trim();
    if (author) counts.set(author, (counts.get(author) ?? 0) + 1);
  }
  const tracked = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (tracked) return tracked[0];

  if (!files[CORE_PART]) return null;
  let core;
  try {
    core = parseXml(files[CORE_PART]);
  } catch {
    return null;
  }
  for (const [namespace, name] of [
    [CP_NS, 'lastModifiedBy'],
    [DC_NS, 'creator'],
  ] as const) {
    const text = core.getElementsByTagNameNS(namespace, name).item(0)?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

function decodeEntities(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (entity, name: string) => {
    const named: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
    if (name[0] !== '#') return named[name.toLowerCase()] ?? entity;
    return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  });
}
