"""Unit tests for omml_latex (PowerPoint's Office Math as LaTeX) and for how pptx_import
brings equations in: a display equation as a figure[data-math], one in a sentence as a
span[data-math], and PowerPoint's picture kept for what has no faithful LaTeX.

The constructs are the CASES of tests/fixtures/import/make_math_pptx.py, which also builds
math.pptx from them for the browser test (tests/omml-import.spec.js) that has MathJax draw
every one.

    py -3 -m unittest tests.test_omml     (from deck-editor/)
"""
import html
import os
import re
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "fixtures", "import"))
import import_deck  # noqa: E402
import make_math_pptx as fx  # noqa: E402
import omml_latex  # noqa: E402
from make_math_pptx import d, e, frac, matrix, math_para, nary, pr, r, ssup, up  # noqa: E402

NS = f'{fx.M_NS} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'


def omath(inner):
    return ET.fromstring(f"<m:oMath {NS}>{inner}</m:oMath>")


def latex(inner):
    return omml_latex.to_latex(omath(inner))


class Constructs(unittest.TestCase):
    def test_every_case(self):
        for name, inner, want in fx.CASES:
            with self.subTest(construct=name):
                self.assertEqual(latex(inner), want)

    def test_runs_of_one_style_share_a_command(self):
        self.assertEqual(latex(up("d") + r("𝑥")), r"\mathrm{d}x")
        self.assertEqual(latex(up("lim sup")), r"\mathrm{lim}\ \mathrm{sup}")
        self.assertEqual(latex(r("𝐮𝐯")), r"\mathbf{uv}")
        self.assertEqual(latex(r("ab", sty="bi")), r"\boldsymbol{ab}")

    def test_a_command_is_kept_apart_from_the_letter_after_it(self):
        self.assertEqual(latex(r("𝛼𝑥")), r"\alpha x")
        self.assertEqual(latex(r("∀𝑥")), r"\forall x")

    def test_function_names_in_a_function(self):
        self.assertEqual(latex(fx.func(up("log"), ssub_(r("𝑥"), r("2")))), r"\log x_{2}")
        self.assertEqual(latex(fx.func(up("ln"), d(r("𝑥")))), r"\ln \left( x \right)")

    def test_separators_without_growing(self):
        self.assertEqual(latex(d(r("𝑎"), r("𝑏"), grow="0")), "(a|b)")
        self.assertEqual(latex(d(r("𝑎"), r("𝑏"), sepChr="‖", grow="0")), r"(a \| b)")

    def test_a_matrix_in_an_equation_array_keeps_its_own_columns(self):
        arr = f"<m:eqArr>{pr('eqArr')}{e(r('𝑀=') + matrix([[r('𝑎'), r('𝑏')]]))}</m:eqArr>"
        self.assertEqual(latex(arr), r"\begin{gathered} M=\begin{matrix} a & b \end{matrix} \end{gathered}")

    def test_alignment_point_from_the_run_properties(self):
        aln = '<m:r><m:rPr><m:aln/></m:rPr><m:t>=1</m:t></m:r>'
        arr = f"<m:eqArr>{pr('eqArr')}{e(r('𝑥') + aln)}{e(r('𝑦') + aln)}</m:eqArr>"
        self.assertEqual(latex(arr), r"\begin{aligned} x&=1 \\ y&=1 \end{aligned}")

    def test_an_ampersand_outside_an_equation_array_is_a_character(self):
        self.assertEqual(latex(r("𝑎&𝑏")), r"a\&b")

    def test_lines_of_a_display_equation(self):
        para = ET.fromstring(f'<m:oMathPara {NS}><m:oMath>{r("𝑎=1")}</m:oMath><m:oMath>{r("𝑏=2")}</m:oMath></m:oMathPara>')
        self.assertEqual(omml_latex.para_latex(para), (r"\begin{gathered} a=1 \\ b=2 \end{gathered}", "centerGroup"))
        para.insert(0, ET.fromstring(f'<m:oMathParaPr {NS}><m:jc m:val="left"/></m:oMathParaPr>'))
        self.assertEqual(omml_latex.para_latex(para), (r"\begin{aligned} &a=1 \\ &b=2 \end{aligned}", "left"))


def ssub_(b, s):
    return f"<m:sSub>{pr('sSub')}{e(b)}{e(s, tag='sub')}</m:sSub>"


class Characters(unittest.TestCase):
    def test_mathematical_alphanumerics(self):
        cases = {"𝑥": "x", "ℎ": "h", "𝐱": r"\mathbf{x}", "𝟐": r"\mathbf{2}", "𝒜": r"\mathcal{A}", "𝔄": r"\mathfrak{A}",
                 "𝔸": r"\mathbb{A}", "𝖺": r"\mathsf{a}", "𝚊": r"\mathtt{a}", "𝜋": r"\pi", "𝛤": r"\mathit{\Gamma}",
                 "𝚷": r"\mathbf{\Pi}", "𝝅": r"\boldsymbol{\pi}", "𝜕": r"\partial", "ℂ": r"\mathbb{C}", "ℭ": r"\mathfrak{C}"}
        for ch, want in cases.items():
            with self.subTest(char=ch):
                self.assertEqual(omml_latex.chars_tex(ch), want)

    def test_greek_capitals_without_a_command_are_latin(self):
        self.assertEqual(omml_latex.chars_tex("ΑΒ"), r"\mathrm{AB}")

    def test_greek_variants(self):
        self.assertEqual(omml_latex.chars_tex("εϵφϕ"), r"\varepsilon\epsilon\varphi\phi")

    def test_tex_specials_are_escaped(self):
        self.assertEqual(omml_latex.chars_tex("#$%&_{}~^\\"), r"\#\$\%\&\_\{\}\sim\hat{}\backslash")

    def test_minus_primes_and_spaces(self):
        self.assertEqual(omml_latex.chars_tex("𝑎−𝑏′ 𝑐\u2009𝑑"), r"a-b'\ c\,d")

    def test_invisible_operators_are_dropped(self):
        self.assertEqual(omml_latex.chars_tex("𝑓\u2061𝑥\u2062𝑦"), "fxy")

    def test_normal_text_keeps_tex_syntax_out_of_text_mode(self):
        self.assertEqual(omml_latex.text_tex("50% off {x}"), r"\text{50}\%\text{ off }\{\text{x}\}")
        self.assertEqual(latex(r("note", nor=True, sty="b")), r"\textbf{note}")

    def test_letters_of_other_alphabets_pass_through(self):
        self.assertEqual(omml_latex.chars_tex("é"), "é")

    def test_plain_text_of_an_equation(self):
        self.assertEqual(omml_latex.plain_text(omath(r("𝐸=𝑚") + ssup(r("𝑐"), r("2")))), "E=mc2")


class Unsupported(unittest.TestCase):
    """What has no faithful LaTeX raises, so the import keeps PowerPoint's picture."""

    def assertUnsupported(self, inner, words):
        with self.assertRaises(omml_latex.Unsupported) as cm:
            latex(inner)
        self.assertIn(words, str(cm.exception))

    def test_surface_integral(self):
        self.assertUnsupported(fx.SURFACE_INTEGRAL, "∯")

    def test_line_breaks(self):
        self.assertUnsupported('<m:r><m:rPr><m:brk/></m:rPr><m:t>x</m:t></m:r>', "line break")
        self.assertUnsupported('<m:r><m:t>x</m:t><m:br/></m:r>', "line break")

    def test_a_symbol_without_a_command(self):
        self.assertUnsupported(r("☃"), "U+2603")

    def test_a_lowercase_script_letter(self):
        self.assertUnsupported(r("𝒶"), "lowercase script")
        self.assertUnsupported(r("ℯ"), "lowercase script")

    def test_sans_serif_italic(self):
        self.assertUnsupported(r("𝘢"), "sans-serif italic")

    def test_unknown_accent_bracket_group_character_and_phantom(self):
        self.assertUnsupported(fx.acc("\u20d1", r("𝑥")), "accent")
        self.assertUnsupported(d(r("𝑥"), begChr="⟦", endChr="⟧"), "bracket")
        self.assertUnsupported(fx.group_chr(r("𝑥"), chr="⏜", pos="top"), "over or under")
        self.assertUnsupported(f"<m:phant>{pr('phant', zeroWid='1')}{e(r('𝑥'))}</m:phant>", "phantom")


def slides_of(page):
    return re.split(r'<section class="slide', page)[1:]


def import_slides(slides=None):
    """Import math.pptx (or one built with these two slides); (slides' markup, notes, asset files)."""
    with tempfile.TemporaryDirectory() as out:
        src = os.path.join(out, "in.pptx")
        fx.build(src, slides)
        deck = os.path.join(out, "deck")
        os.makedirs(deck)
        page, notes = import_deck.import_file(src, deck)
        assets = sorted(os.listdir(os.path.join(deck, "assets"))) if os.path.isdir(os.path.join(deck, "assets")) else []
    return slides_of(page), notes, assets


class Import(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.slides, cls.notes, cls.assets = import_slides()

    def test_a_display_equation_becomes_an_equation_figure(self):
        # The text box at 1524000, 2286000 EMU (240, 360 px) with PowerPoint's insets (14.4, 7.2 px);
        # 32pt is 64px on the 1920px stage; the runs' colour is the figure's.
        self.assertIn('<figure data-math="x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}" style="position:absolute; left:254.4px; '
                      'top:367.2px; margin:0; font-size:64px; color:#1f4e79;"></figure>', self.slides[0])

    def test_an_equation_in_a_sentence_becomes_an_equation_in_the_text(self):
        self.assertRegex(self.slides[0], r'<p [^>]*data-edit><span style="font-size:48px;">The energy </span>'
                                         r'<span style="font-size:48px;"><span data-math="E=mc\^\{2\}"></span></span>'
                                         r'<span style="font-size:48px;"> of a body at rest\.</span></p>')

    def test_what_does_not_convert_keeps_its_picture_and_says_so(self):
        self.assertIn("background:url('assets/image1.png')", self.slides[0])
        self.assertEqual(self.notes, ["an equation came in as PowerPoint's picture of it, not as an equation you can edit (the operator ∯)"])
        self.assertEqual(self.assets, ["image1.png"])          # the converted equations' pictures are not copied
        self.assertNotIn("∯", "".join(self.slides))

    def test_every_construct_comes_in_as_its_latex(self):
        texs = [html.unescape(t) for t in re.findall(r'<figure data-math="([^"]*)"', self.slides[1])]
        self.assertEqual(texs, [want for _, _, want in fx.CASES])

    def test_a_display_equation_among_text_stays_in_the_text(self):
        # A display equation in a paragraph of its own between two lines of text: drawn in the text,
        # in the display style, its paragraph centred (m:jc centerGroup).
        paras = ('<a:p><a:r><a:rPr lang="en-US"/><a:t>Before</a:t></a:r></a:p><a:p>' + math_para(frac(r("𝑎"), r("𝑏")))
                 + '</a:p><a:p><a:r><a:rPr lang="en-US"/><a:t>After</a:t></a:r></a:p>')
        slides, notes, _ = import_slides([fx.slide(fx.alternate(3, 0, 0, 6096000, 2000000, paras, auto=False)), fx.slide("")])
        self.assertEqual(notes, [])
        self.assertNotIn("<figure", slides[0])
        self.assertRegex(slides[0], r'<p style="[^"]*text-align:center;[^"]*" data-edit><span data-math="\\displaystyle \\frac\{a\}\{b\}"></span></p>')
        self.assertIn(">Before</p>", slides[0])

    def test_an_equation_without_a_picture_that_does_not_convert_comes_in_as_text(self):
        box = fx.text_box(3, 0, 0, 6096000, 914400, "<a:p>" + math_para(fx.SURFACE_INTEGRAL) + "</a:p>")
        slides, notes, _ = import_slides([fx.slide(box), fx.slide("")])
        self.assertIn("∯S", slides[0])
        self.assertEqual(notes, ["an equation came in as its plain text, not as an equation you can edit (the operator ∯)"])

    def test_an_equation_box_with_a_fill_keeps_the_fill_under_the_figure(self):
        box = fx.text_box(3, 0, 0, 3048000, 914400, "<a:p>" + math_para(r("𝑥")) + "</a:p>").replace("<a:noFill/>", '<a:solidFill><a:srgbClr val="FFEEAA"/></a:solidFill>')
        slides, _, _ = import_slides([fx.slide(box), fx.slide("")])
        self.assertRegex(slides[0], r'<div style="position:absolute; left:0px; top:0px; width:480px; height:144px; background:#ffeeaa;"></div>\s*<figure data-math="x"')

    def test_several_display_equations_in_one_box_are_one_figure(self):
        paras = "<a:p>" + math_para(r("𝑎=1"), jc="left") + "</a:p><a:p>" + math_para(r("𝑏=2"), jc="left") + "</a:p>"
        slides, _, _ = import_slides([fx.slide(fx.text_box(3, 0, 0, 3048000, 914400, paras)), fx.slide("")])
        self.assertEqual(re.findall(r'<figure data-math="([^"]*)"', slides[0]), [r"\begin{aligned} &amp;a=1 \\ &amp;b=2 \end{aligned}"])


if __name__ == "__main__":
    unittest.main()
