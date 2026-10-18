// A small comparison for UI tests of inline edits (src/ui/useEdits.test.tsx, DocumentPanel tests),
// built without the engine.
import type { CompareResult, RevisionListEntry } from '../src/engine/types';
import { analyzeComparison } from '../src/model/analyze';
import { prepareRenderedDocument } from '../src/ui/renderedDocument';
import type { Comparison } from '../src/ui/useComparison';

/**
 * Decorated-to-be redline HTML: a heading, a paragraph with two insertions around unchanged text
 * (`the [big] red [house]`), and a replacement with a typo in its inserted word.
 */
export const SMALL_COMPARISON_HTML = `<html><body><div data-section-index="0">
<h1 data-anchor="h" data-source-anchor-id="h:body:h"><span>The old monastery</span></h1>
<p data-anchor="p" data-source-anchor-id="p:body:p"><span>the </span><ins class="rev-ins" data-author="rev:r1"><span>big </span></ins><span style="color: #000000">red </span><ins class="rev-ins" data-author="rev:r2"><span>house</span></ins></p>
<p data-anchor="q" data-source-anchor-id="p:body:q"><span>The </span><ins class="rev-ins" data-author="rev:r3"><span>hosue</span></ins><del class="rev-del" data-author="rev:r4"><span>home</span></del><span> stood.</span></p>
</div></body></html>`;

function revision(id: string, type: 'insert' | 'delete', text: string, unid: string): RevisionListEntry {
  return {
    id,
    type,
    family: type === 'insert' ? 'content_insert' : 'content_delete',
    constituentKeys: [],
    text,
    partUri: '/word/document.xml',
    scope: 'body',
    affectedAnchors: [{ id: `p:body:${unid}`, kind: 'p', scope: 'body', unid }],
    resolutionStatus: 'supported',
  };
}

/** A comparison of `SMALL_COMPARISON_HTML`, prepared as `useComparison` prepares one (no engine). */
export function smallComparison(): Comparison {
  const result: CompareResult = {
    redline: new ArrayBuffer(0),
    revisions: [revision('r1', 'insert', 'big ', 'p'), revision('r2', 'insert', 'house', 'p'), revision('r3', 'insert', 'hosue', 'q'), revision('r4', 'delete', 'home', 'q')],
    html: SMALL_COMPARISON_HTML,
    uneditableBlocks: {},
    inputsHadRevisions: false,
    editedAuthor: null,
    headings: { original: [{ level: 1, text: 'The old monastery' }], edited: [{ level: 1, text: 'The old monastery' }] },
    timings: { normalize: 0, checkInputs: 0, headings: 0, author: 0, compare: 0, list: 0, tag: 0, render: 0, editable: 0 },
  };
  const { analysis, document, itemTexts } = prepareRenderedDocument(SMALL_COMPARISON_HTML, (parsed) => analyzeComparison(result, () => parsed));
  const file = new File([], 'x.docx');
  return { original: file, edited: file, originalName: 'o.docx', editedName: 'e.docx', result, analysis, document, itemTexts, timings: { worker: 0, prepare: 0 } };
}

