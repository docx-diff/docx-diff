# Reference prototype from the PRD review (2026-10-15), not production code.
# Applies the reject-rewrite rules of PRD section 7.3 to EVERY revision of a redline .docx.
# Then docxDiffAcceptRevisions(output) gave the Original text exactly and passed verifyDeliverable.
# Usage: python3 reject-all-prototype.py redline.docx rewritten.docx
# Note: reject_all() also contains dead code (an empty loop over w:del) left from the experiment.
import sys,zipfile,re
from lxml import etree
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
q=lambda n:'{%s}%s'%(W,n)
def rename(el,n): el.tag=q(n)
def swap_text(el,a,b):
    for t in el.iter(q(a)): t.tag=q(b)
def unwrap(el):
    p=el.getparent(); i=p.index(el)
    for c in list(el): p.insert(i,c); i+=1
    if el.tail: pass
    p.remove(el)
def reject_all(root):
    # paragraph-mark revisions (inside w:rPr of w:pPr)
    for rpr in root.iter(q('rPr')):
        if rpr.getparent() is not None and rpr.getparent().tag==q('pPr'):
            for m in list(rpr):
                if m.tag==q('ins'): rename(m,'del')
                elif m.tag==q('del'): rpr.remove(m)
    for tag,parent in (('rPrChange','rPr'),('pPrChange','pPr'),('sectPrChange','sectPr')):
        for ch in list(root.iter(q(tag))):
            par=ch.getparent(); old=ch.find(q(parent))
            keep=[c for c in par if c.tag in (q('rPr'),q('sectPr'),q('pPrChange')) and par.tag==q('pPr') and c.tag!=q('pPrChange')] if tag=='pPrChange' else []
            if tag=='sectPrChange':
                keep=[c for c in par if c.tag in (q('headerReference'),q('footerReference'))]
            for c in list(par): par.remove(c)
            if tag=='pPrChange':
                if old is not None:
                    for c in list(old): par.append(c)
                for c in keep: par.append(c)
            else:
                for c in keep: par.append(c)
                if old is not None:
                    for c in list(old): par.append(c)
    for el in list(root.iter(q('ins'))):
        if el.getparent().tag!=q('rPr'): rename(el,'del'); swap_text(el,'t','delText'); swap_text(el,'instrText','delInstrText')
    for el in list(root.iter(q('del'))):
        pass
    return root
def reject_content_dels(root, marker):
    # unwrap original w:del elements (those carrying marker attr)
    for el in list(root.iter(q('del'))):
        if el.get('_orig')=='1' and el.getparent().tag!=q('rPr'):
            swap_text(el,'delText','t'); swap_text(el,'delInstrText','instrText'); unwrap(el)
    for el in list(root.iter(q('moveFrom'))): swap_text(el,'delText','t'); unwrap(el)
    for el in list(root.iter(q('moveTo'))): rename(el,'del'); swap_text(el,'t','delText')
    for n in ('moveFromRangeStart','moveFromRangeEnd','moveToRangeStart','moveToRangeEnd'):
        for el in list(root.iter(q(n))): el.getparent().remove(el)
    for el in root.iter(): 
        if '_orig' in el.attrib: del el.attrib['_orig']
zin=zipfile.ZipFile(sys.argv[1]); zout=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    d=zin.read(it.filename)
    if it.filename in('word/document.xml','word/footnotes.xml','word/endnotes.xml'):
        root=etree.fromstring(d)
        for el in root.iter(q('del')):
            if el.getparent().tag!=q('rPr'): el.set('_orig','1')
        reject_all(root); reject_content_dels(root,None)
        d=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    zout.writestr(it,d)
zout.close()
