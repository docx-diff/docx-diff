// A small rendered redline for model tests, shaped like the converter's output (classes and
// attributes as in the sample's HTML). Body Original paragraphs: a, c, d, e, t.
export const SMALL_HTML = `<html><body>
<p data-anchor="a" data-source-anchor-id="p:body:a">Kept <del class="rev-del" data-author="rev:r1">old</del><ins class="rev-ins" data-author="rev:r2">new</ins> text<a href="#fn-3" id="fn-ref-3" class="footnote-ref" data-footnote-id="3"><sup>1</sup></a></p>
<p data-anchor="b" data-source-anchor-id="p:body:b" class="rev-para-ins" data-author="rev:r3"><ins class="rev-ins" data-author="rev:r3">A wholly inserted paragraph</ins></p>
<h2 data-anchor="c" data-source-anchor-id="h:body:c"><span class="rev-format-change" title="Bold removed, Font changed" data-author="rev:r4">Heading</span><span class="rev-format-change" title="Font changed, Font size changed" data-author="rev:r4">!</span></h2>
<p data-anchor="d" data-source-anchor-id="p:body:d" class="rev-para-del" data-author="rev:r5"><del class="rev-del" data-author="rev:r5">Deleted paragraph</del><span class="rev-para-mark-del" title="Paragraph mark deleted">¶</span></p>
<p data-anchor="e" data-source-anchor-id="p:body:e"></p>
<p data-anchor="f" data-source-anchor-id="p:body:f" class="rev-para-ins"></p>
<p data-anchor="g" data-source-anchor-id="p:body:g"><ins class="rev-move-to" data-author="rev:r6" data-move-id="9">Moved here</ins><span class="rev-para-mark-del">¶</span></p>
<table><tr><td><p data-anchor="t" data-source-anchor-id="p:body:t">Cell <a href="#en-2" id="en-ref-2" class="endnote-ref"><sup>i</sup></a></p></td></tr></table>
<section class="footnotes"><hr /><ol><li id="fn-3" value="1" data-source-anchor-id="fn:fn:x"><p data-anchor="n" data-source-anchor-id="p:fn:n">Note <del class="rev-del" data-author="rev:r7">text</del><a href="#fn-ref-3" class="fn-backref">↩</a></p></li></ol></section>
<section class="endnotes"><hr /><ol><li id="en-2" value="1" data-source-anchor-id="en:en:y"><p data-anchor="m" data-source-anchor-id="p:en:m">Endnote</p></li></ol></section>
</body></html>`;
