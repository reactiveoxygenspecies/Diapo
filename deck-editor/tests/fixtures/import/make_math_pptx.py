"""Builds math.pptx next to this file: equations as PowerPoint saves them (Office Math in an
mc:AlternateContent, with a picture of each for older readers), for the OMML import.

  Slide 1: a display equation in its own text box (coloured, 32pt), an equation inside a
           sentence, and an equation the import cannot write as LaTeX (a surface integral),
           which keeps its picture.
  Slide 2: one equation per construct of CASES (the same cases tests/test_omml.py checks
           the LaTeX of), so a browser test can see MathJax draw every one.

CASES: (name, the inside of an m:oMath, the LaTeX omml_latex.py writes for it).
Run with: py -3 make_math_pptx.py"""
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "math.pptx")
sys.path.insert(0, HERE)
import make_pptx as base  # noqa: E402  the sample deck's master, layout and picture

M_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
A14 = 'xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"'
MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'


# -- OMML, written short ------------------------------------------------------------
def r(text, sty=None, scr=None, nor=False, rpr='<a:rPr lang="en-US" i="1"><a:latin typeface="Cambria Math"/></a:rPr>'):
    """A maths run, with PowerPoint's DrawingML run properties."""
    mpr = ""
    if sty or scr or nor:
        mpr = "<m:rPr>" + ("<m:nor/>" if nor else "") + (f'<m:scr m:val="{scr}"/>' if scr else "") + (f'<m:sty m:val="{sty}"/>' if sty else "") + "</m:rPr>"
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f"<m:r>{mpr}{rpr}<m:t>{text}</m:t></m:r>"


def pr(tag, **vals):
    """An m:<tag>Pr with m:<name> m:val="..." children."""
    inner = "".join(f'<m:{k} m:val="{v}"/>' for k, v in vals.items())
    return f"<m:{tag}Pr>{inner}<m:ctrlPr><a:rPr lang=\"en-US\" i=\"1\"><a:latin typeface=\"Cambria Math\"/></a:rPr></m:ctrlPr></m:{tag}Pr>"


def e(*xs, tag="e"):
    return f"<m:{tag}>{''.join(xs)}</m:{tag}>"


def frac(num, den, **p):
    return f"<m:f>{pr('f', **p)}{e(num, tag='num')}{e(den, tag='den')}</m:f>"


def ssub(b, s):
    return f"<m:sSub>{pr('sSub')}{e(b)}{e(s, tag='sub')}</m:sSub>"


def ssup(b, s):
    return f"<m:sSup>{pr('sSup')}{e(b)}{e(s, tag='sup')}</m:sSup>"


def nary(ch, sub, sup, body, **p):
    return f"<m:nary>{pr('nary', chr=ch, **p)}{e(sub, tag='sub')}{e(sup, tag='sup')}{e(body)}</m:nary>"


def d(*cells, **p):
    return f"<m:d>{pr('d', **p)}{''.join(e(c) for c in cells)}</m:d>"


def func(name, body):
    return f"<m:func>{pr('func')}{e(name, tag='fName')}{e(body)}</m:func>"


def acc(ch, body):
    return f"<m:acc>{pr('acc', chr=ch)}{e(body)}</m:acc>"


def group_chr(body, **p):
    return f"<m:groupChr>{pr('groupChr', **p)}{e(body)}</m:groupChr>"


def lim(where, body, under_or_over):
    """m:limLow (where='Low') or m:limUpp ('Upp')."""
    return f"<m:lim{where}>{pr('lim' + where)}{e(body)}{e(under_or_over, tag='lim')}</m:lim{where}>"


def matrix(rows, mpr=""):
    return "<m:m>" + (f"<m:mPr>{mpr}</m:mPr>" if mpr else "") + "".join("<m:mr>" + "".join(e(c) for c in row) + "</m:mr>" for row in rows) + "</m:m>"


def up(t):
    return r(t, sty="p", rpr='<a:rPr lang="en-US" i="0"><a:latin typeface="Cambria Math"/></a:rPr>')


QUADRATIC = (r("𝑥") + r("=") + frac(r("−𝑏±") + f"<m:rad>{pr('rad', degHide='1')}<m:deg/>{e(ssup(r('𝑏'), r('2')) + r('−4𝑎𝑐'))}</m:rad>", r("2𝑎")))

CASES = [
    ("italic letters", r("𝑥+𝑦=2"), "x+y=2"),
    ("upright word", up("max"), r"\mathrm{max}"),
    ("bold", r("v", sty="b"), r"\mathbf{v}"),
    ("bold italic", r("𝒗"), r"\boldsymbol{v}"),
    ("script", r("L", scr="script"), r"\mathcal{L}"),
    ("double-struck", r("ℝ") + r("N", scr="double-struck"), r"\mathbb{R}\mathbb{N}"),
    ("fraktur", r("𝔤"), r"\mathfrak{g}"),
    ("sans-serif and monospace", r("𝖠𝚡"), r"\mathsf{A}\mathtt{x}"),
    ("normal text", r("if ", nor=True) + r("𝑥>0"), r"\text{if }x>0"),
    ("Greek", r("𝛼+𝛽=𝛾") + up("Ω"), r"\alpha+\beta=\gamma\Omega"),
    ("bold Greek", r("𝝎") + r("𝚪"), r"\boldsymbol{\omega}\mathbf{\Gamma}"),
    ("symbols", r("∀𝑥∈𝐴⇒𝑥≤∞"), r"\forall x\in A\Rightarrow x\leq\infty"),
    ("more symbols", r("∂𝑓≈∇𝑔≠ℏ⋅ℓ"), r"\partial f\approx\nabla g\neq\hbar\cdot\ell"),
    ("TeX's own characters", r("50%") + r("{𝑎}#_"), r"50\%\{a\}\#\_"),
    ("fraction", frac(r("𝑎"), r("𝑏")), r"\frac{a}{b}"),
    ("linear fraction", frac(r("𝑎"), r("𝑏+𝑐"), type="lin"), r"a/{b+c}"),
    ("skewed fraction", frac(r("𝑎"), r("𝑏"), type="skw"), r"{}^{a}\!/\!{}_{b}"),
    ("fraction without bar", frac(r("𝑛"), r("𝑘"), type="noBar"), r"\genfrac{}{}{0pt}{}{n}{k}"),
    ("subscript", ssub(r("𝑥"), r("𝑖")), r"x_{i}"),
    ("superscript", ssup(r("𝑒"), r("−𝑥")), r"e^{-x}"),
    ("sub and superscript", f"<m:sSubSup>{pr('sSubSup')}{e(r('𝑥'))}{e(r('𝑖'), tag='sub')}{e(r('2'), tag='sup')}</m:sSubSup>", r"x_{i}^{2}"),
    ("prescripts", f"<m:sPre>{pr('sPre')}{e(r('6'), tag='sub')}{e(r('14'), tag='sup')}{e(up('C'))}</m:sPre>", r"{}_{6}^{14}\mathrm{C}"),
    ("prime", ssup(r("𝑓"), r("′")) + d(r("𝑥")), r"f'\left( x \right)"),
    ("square root", f"<m:rad>{pr('rad', degHide='1')}<m:deg/>{e(r('𝑥'))}</m:rad>", r"\sqrt{x}"),
    ("cube root", f"<m:rad>{pr('rad')}{e(r('3'), tag='deg')}{e(r('𝑥'))}</m:rad>", r"\sqrt[3]{x}"),
    ("sum", nary("∑", r("𝑖=1"), r("𝑛"), r("𝑖"), limLoc="undOvr"), r"\sum_{i=1}^{n} i"),
    ("integral", nary("∫", r("0"), r("1"), r("𝑓") + d(r("𝑥")) + r("𝑑𝑥"), limLoc="subSup"), r"\int_{0}^{1} f\left( x \right)dx"),
    ("integral with limits under", nary("∫", r("Ω"), "", r("𝑓"), limLoc="undOvr", supHide="1"), r"\int\limits_{\Omega} f"),
    ("double integral", nary("∬", "", "", r("𝑓"), subHide="1", supHide="1"), r"\iint f"),
    ("contour integral", nary("∮", r("𝐶"), "", r("𝐹"), supHide="1"), r"\oint_{C} F"),
    ("product beside", nary("∏", r("𝑘"), "", ssub(r("𝑎"), r("𝑘")), limLoc="subSup", supHide="1"), r"\prod\nolimits_{k} a_{k}"),
    ("union", nary("⋃", r("𝑖"), "", ssub(r("𝐴"), r("𝑖")), supHide="1"), r"\bigcup_{i} A_{i}"),
    ("parentheses", d(r("𝑎+𝑏")), r"\left( a+b \right)"),
    ("angle brackets with a bar", d(r("𝑎"), r("𝑏"), begChr="⟨", endChr="⟩"), r"\left\langle a \middle| b \right\rangle"),
    ("one-sided brace", d(r("𝑥"), begChr="{", endChr=""), r"\left\{ x \right."),
    ("fixed brackets", d(r("𝑥"), begChr="[", endChr="]", grow="0"), r"[x]"),
    ("absolute value", d(r("𝑥"), begChr="|", endChr="|"), r"\left| x \right|"),
    ("sine", func(up("sin"), r("𝑥")), r"\sin x"),
    ("limit", func(f"<m:limLow>{pr('limLow')}{e(up('lim'))}{e(r('𝑛→∞'), tag='lim')}</m:limLow>", ssub(r("𝑎"), r("𝑛"))), r"\lim_{n\rightarrow\infty} a_{n}"),
    ("other function", func(up("sinc"), r("𝑥")), r"\operatorname{sinc} x"),
    ("squared sine", func(ssup(up("sin"), r("2")), r("𝜃")), r"\sin^{2} \theta"),
    ("hat", acc("̂", r("𝑥")), r"\hat{x}"),
    ("wide hat", acc("̂", r("𝑥𝑦")), r"\widehat{xy}"),
    ("vector", acc("⃗", r("𝑣")), r"\vec{v}"),
    ("dots and tilde", acc("̇", r("𝑥")) + acc("̈", r("𝑥")) + acc("̃", r("𝑛")), r"\dot{x}\ddot{x}\tilde{n}"),
    ("overbar", f"<m:bar>{pr('bar', pos='top')}{e(r('𝑧'))}</m:bar>", r"\overline{z}"),
    ("underbar", f"<m:bar>{pr('bar')}{e(r('𝑧'))}</m:bar>", r"\underline{z}"),
    ("underbrace", group_chr(r("𝑎+𝑏")), r"\underbrace{a+b}"),
    ("underbrace with a label", lim("Low", group_chr(r("𝑎+⋯")), r("𝑛")), r"\underbrace{a+\cdots}_{n}"),
    ("overbrace with a label", lim("Upp", group_chr(r("𝑥"), chr="⏞", pos="top"), r("𝑘")), r"\overbrace{x}^{k}"),
    ("arrow with text over it", group_chr(up("Δ"), chr="→", vertJc="bot"), r"\xrightarrow{\Delta}"),
    ("text over an equals sign", lim("Upp", r("="), up("def")), r"\overset{\mathrm{def}}{=}"),
    ("operator with a limit under it", lim("Low", up("argmax"), r("𝑥")), r"\operatorname*{argmax}_{x}"),
    ("box", f"<m:box>{pr('box')}{e(r('𝑎=𝑏'))}</m:box>", r"a=b"),
    ("border box", f"<m:borderBox>{pr('borderBox')}{e(r('𝐸=𝑚') + ssup(r('𝑐'), r('2')))}</m:borderBox>", r"\boxed{E=mc^{2}}"),
    ("struck out", f"<m:borderBox>{pr('borderBox', hideTop='1', hideBot='1', hideLeft='1', hideRight='1', strikeBLTR='1')}{e(r('𝑥'))}</m:borderBox>", r"\cancel{x}"),
    ("two sides of a box", f"<m:borderBox>{pr('borderBox', hideTop='1', hideBot='1')}{e(r('𝑥'))}</m:borderBox>", r"\enclose{left,right}{x}"),
    ("matrix", matrix([[r("𝑎"), r("𝑏")], [r("𝑐"), r("𝑑")]]), r"\begin{matrix} a & b \\ c & d \end{matrix}"),
    ("matrix in parentheses", d(matrix([[r("1"), r("0")], [r("0"), r("1")]])), r"\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}"),
    ("matrix in brackets", d(matrix([[r("𝑥")], [r("𝑦")]]), begChr="[", endChr="]"), r"\begin{bmatrix} x \\ y \end{bmatrix}"),
    ("determinant", d(matrix([[r("𝑎"), r("𝑏")], [r("𝑐"), r("𝑑")]]), begChr="|", endChr="|"), r"\begin{vmatrix} a & b \\ c & d \end{vmatrix}"),
    ("matrix with a left column", d(matrix([[r("𝑎"), r("1")], [r("𝑏𝑐"), r("2")]], '<m:mcs><m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="left"/></m:mcPr></m:mc><m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>')),
     r"\left( \begin{array}{lc} a & 1 \\ bc & 2 \end{array} \right)"),
    ("aligned equations", f"<m:eqArr>{pr('eqArr')}{e(r('𝑥&=1'))}{e(r('𝑦&=2'))}</m:eqArr>", r"\begin{aligned} x&=1 \\ y&=2 \end{aligned}"),
    ("stacked equations", f"<m:eqArr>{pr('eqArr')}{e(r('𝑎'))}{e(r('𝑏𝑐'))}</m:eqArr>", r"\begin{gathered} a \\ bc \end{gathered}"),
    ("cases", d(f"<m:eqArr>{pr('eqArr')}{e(r('1&') + r('if ', nor=True) + r('𝑥>0'))}{e(r('0&') + r('otherwise', nor=True))}</m:eqArr>", begChr="{", endChr=""),
     r"\left\{ \begin{aligned} 1&\text{if }x>0 \\ 0&\text{otherwise} \end{aligned} \right."),
    ("phantom", r("𝑎") + f"<m:phant>{pr('phant', show='0')}{e(r('𝑏'))}</m:phant>" + r("𝑐"), r"a\phantom{b}c"),
    ("smash", f"<m:phant>{pr('phant', zeroAsc='1', zeroDesc='1')}{e(r('𝑦'))}</m:phant>", r"\smash{y}"),
    ("unknown element read through", "<m:somethingNew><m:e>" + r("𝑞") + "</m:e></m:somethingNew>", r"q"),
    ("quadratic formula", QUADRATIC, r"x=\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}"),
]

SURFACE_INTEGRAL = nary("∯", r("𝑆"), "", r("𝐅⋅𝑑𝐒"), supHide="1")


# -- the slides ------------------------------------------------------------------------
def math_para(inner, jc="centerGroup"):
    return f'<a14:m><m:oMathPara {M_NS}><m:oMathParaPr><m:jc m:val="{jc}"/></m:oMathParaPr><m:oMath>{inner}</m:oMath></m:oMathPara></a14:m>'


def text_box(sid, x, y, w, h, paras, auto=True):
    body = '<a:bodyPr wrap="none" rtlCol="0"><a:spAutoFit/></a:bodyPr>' if auto else '<a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>'
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="TextBox {sid}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
            f'<p:txBody>{body}<a:lstStyle/>{paras}</p:txBody></p:sp>')


def picture_box(sid, x, y, w, h, rid="rId2"):
    """The Fallback: the same box filled with a picture of the equation, its text hidden."""
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="TextBox {sid}"/><p:cNvSpPr txBox="1"><a:spLocks noRot="1" noChangeAspect="1" noMove="1" noResize="1" noEditPoints="1" noAdjustHandles="1" noChangeArrowheads="1" noChangeShapeType="1" noTextEdit="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
            f'<a:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr>'
            '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:noFill/></a:rPr><a:t> </a:t></a:r></a:p></p:txBody></p:sp>')


def alternate(sid, x, y, w, h, paras, auto=True):
    return (f'<mc:AlternateContent {MC}><mc:Choice {A14} Requires="a14">{text_box(sid, x, y, w, h, paras, auto)}</mc:Choice>'
            f'<mc:Fallback>{picture_box(sid, x, y, w, h)}</mc:Fallback></mc:AlternateContent>')


def coloured(inner, sz=3200, colour="1F4E79"):
    """The maths of `inner` with every run sized and coloured, as PowerPoint writes them."""
    return inner.replace('<a:rPr lang="en-US" i="1">', f'<a:rPr lang="en-US" sz="{sz}" i="1"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill>')


TITLE = ('<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
         '<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>'
         '<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp>')

SENTENCE = ('<a:p><a:r><a:rPr lang="en-US" sz="2400" dirty="0"/><a:t>The energy </a:t></a:r>'
            f'<a14:m><m:oMath {M_NS}>' + r("𝐸=𝑚", rpr='<a:rPr lang="en-US" sz="2400" i="1"><a:latin typeface="Cambria Math"/></a:rPr>')
            + ssup(r("𝑐", rpr='<a:rPr lang="en-US" sz="2400" i="1"><a:latin typeface="Cambria Math"/></a:rPr>'), r("2", rpr='<a:rPr lang="en-US" sz="2400" i="1"><a:latin typeface="Cambria Math"/></a:rPr>'))
            + '</m:oMath></a14:m><a:r><a:rPr lang="en-US" sz="2400" dirty="0"/><a:t> of a body at rest.</a:t></a:r></a:p>')


def slide(body):
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld {base.P} {base.A} {base.R} {MC} {A14} {M_NS}><p:cSld><p:spTree>'
            '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
            f'{body}</p:spTree></p:cSld></p:sld>')


SLIDE1 = slide(TITLE.format("Equations from PowerPoint")
               + alternate(3, 1524000, 2286000, 4572000, 914400, "<a:p>" + coloured(math_para(QUADRATIC)) + '<a:endParaRPr lang="en-US" dirty="0"/></a:p>')
               + alternate(4, 1524000, 3810000, 9144000, 584775, SENTENCE, auto=False)
               + alternate(5, 7620000, 2286000, 2286000, 914400, "<a:p>" + math_para(SURFACE_INTEGRAL) + "</a:p>"))


def gallery():
    cols, w, h = 5, 2438400, 228600 * 3
    out = [TITLE.format("Every construct")]
    for i, (_, inner, _) in enumerate(CASES):
        x, y = (i % cols) * w, 1371600 + (i // cols) * h // 2
        out.append(alternate(10 + i, x, y, w, h, "<a:p>" + coloured(math_para(inner), sz=1200, colour="000000") + "</a:p>"))
    return slide("".join(out))


SLIDE_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>"""


def build(out=OUT, slides=None):
    """Write the .pptx; `slides` (two slide XMLs) replaces the two above (tests/test_omml.py)."""
    slides = slides or [SLIDE1, gallery()]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", base.CONTENT_TYPES.replace('<Override PartName="/ppt/notesSlides/notesSlide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>\n', ""))
        z.writestr("_rels/.rels", base.ROOT_RELS)
        z.writestr("ppt/presentation.xml", base.PRESENTATION)
        z.writestr("ppt/_rels/presentation.xml.rels", base.PRESENTATION_RELS)
        z.writestr("ppt/slideMasters/slideMaster1.xml", base.MASTER)
        z.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", base.MASTER_RELS)
        z.writestr("ppt/slideLayouts/slideLayout1.xml", base.LAYOUT)
        z.writestr("ppt/slideLayouts/_rels/slideLayout1.xml.rels", base.LAYOUT_RELS)
        z.writestr("ppt/slides/slide1.xml", slides[0])
        z.writestr("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS)
        z.writestr("ppt/slides/slide2.xml", slides[1])
        z.writestr("ppt/slides/_rels/slide2.xml.rels", SLIDE_RELS)
        z.writestr("ppt/media/image1.png", base.PNG)
    return out


if __name__ == "__main__":
    print("wrote", build())
