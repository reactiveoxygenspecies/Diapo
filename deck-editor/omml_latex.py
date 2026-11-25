"""Office Math (OMML, the m: elements PowerPoint and Word save equations as) -> LaTeX, for
pptx_import.py: an equation from PowerPoint comes over as one of the editor's own (math.js),
drawn by MathJax from the LaTeX this writes. Standard library only.

    to_latex(el)          the LaTeX of an m:oMath (or of any OMML element)
    para_latex(el)        (LaTeX, justification) of an m:oMathPara, its lines joined
    plain_text(el)        the characters of an equation, for where nothing else will do

What is converted: runs (m:r, their m:sty / m:scr / m:nor styles and the Unicode
Mathematical Alphanumeric Symbols PowerPoint stores italic letters as), fractions (bar,
skewed, linear, no bar), sub- and superscripts (m:sSub, m:sSup, m:sSubSup, m:sPre),
radicals, n-ary operators (sums, products, integrals, unions... with their limits above
and below or beside), delimiters (m:d, with separators, one side empty, fixed size),
function names (m:func), accents (m:acc), bars, group characters (braces over and under,
arrows with text), boxes and border boxes, matrices (in parentheses or brackets as pmatrix,
bmatrix...), equation arrays (aligned on their alignment points), m:limLow / m:limUpp,
phantoms and smashes, and Unicode maths symbols as LaTeX commands.

An element it does not know is read through: its children are converted. Something it
cannot write faithfully (a surface integral, a line break inside the equation, a lowercase
script letter MathJax has no glyph for...) raises Unsupported, with a few words saying what,
so the importer keeps PowerPoint's own picture of that equation instead.
"""
import re

M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
_M = "{%s}" % M_NS


class Unsupported(Exception):
    """The equation has something LaTeX (as MathJax draws it) cannot show faithfully."""


# ------------------------------------------------------------------
# Characters
# ------------------------------------------------------------------
GREEK = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta", "ε": r"\varepsilon", "ζ": r"\zeta", "η": r"\eta",
    "θ": r"\theta", "ι": r"\iota", "κ": r"\kappa", "λ": r"\lambda", "μ": r"\mu", "ν": r"\nu", "ξ": r"\xi", "ο": "o",
    "π": r"\pi", "ρ": r"\rho", "ς": r"\varsigma", "σ": r"\sigma", "τ": r"\tau", "υ": r"\upsilon", "φ": r"\varphi",
    "χ": r"\chi", "ψ": r"\psi", "ω": r"\omega", "ϑ": r"\vartheta", "ϕ": r"\phi", "ϖ": r"\varpi", "ϱ": r"\varrho",
    "ϵ": r"\epsilon", "ϰ": r"\varkappa", "ϝ": r"\digamma",
    "Γ": r"\Gamma", "Δ": r"\Delta", "Θ": r"\Theta", "ϴ": r"\Theta", "Λ": r"\Lambda", "Ξ": r"\Xi", "Π": r"\Pi",
    "Σ": r"\Sigma", "Υ": r"\Upsilon", "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega",
}
# Greek capitals LaTeX writes as the Latin letter (upright, as Greek capitals are).
GREEK_LATIN = {"Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O",
               "Ρ": "P", "Τ": "T", "Χ": "X"}

SYMBOLS = {
    # operators
    "±": r"\pm", "∓": r"\mp", "×": r"\times", "÷": r"\div", "⋅": r"\cdot", "·": r"\cdot", "∗": r"\ast", "∘": r"\circ",
    "∙": r"\bullet", "•": r"\bullet", "⋆": r"\star", "†": r"\dagger", "‡": r"\ddagger", "∖": r"\setminus", "≀": r"\wr",
    "⊎": r"\uplus", "⊓": r"\sqcap", "⊔": r"\sqcup", "⊕": r"\oplus", "⊖": r"\ominus", "⊗": r"\otimes", "⊘": r"\oslash",
    "⊙": r"\odot", "◦": r"\circ", "∧": r"\wedge", "∨": r"\vee", "∩": r"\cap", "∪": r"\cup", "⋄": r"\diamond",
    "△": r"\triangle", "▽": r"\triangledown", "◁": r"\triangleleft", "▷": r"\triangleright", "∔": r"\dotplus",
    "⋉": r"\ltimes", "⋊": r"\rtimes", "⊠": r"\boxtimes", "⊞": r"\boxplus", "⊟": r"\boxminus", "⊡": r"\boxdot",
    "−": "-", "‐": "-", "‒": "-", "–": "-", "∕": "/", "⁄": "/", "∣": r"\mid", "∤": r"\nmid", "∥": r"\parallel",
    "∦": r"\nparallel", "‖": r"\|", "⊺": r"\intercal", "⌢": r"\frown", "⌣": r"\smile",
    # relations
    "≤": r"\leq", "≥": r"\geq", "≦": r"\leqq", "≧": r"\geqq", "⩽": r"\leqslant", "⩾": r"\geqslant", "≠": r"\neq",
    "≈": r"\approx", "≡": r"\equiv", "≢": r"\not\equiv", "≅": r"\cong", "≃": r"\simeq", "∼": r"\sim", "≍": r"\asymp",
    "≐": r"\doteq", "∝": r"\propto", "≪": r"\ll", "≫": r"\gg", "⋘": r"\lll", "⋙": r"\ggg", "≺": r"\prec",
    "≻": r"\succ", "⪯": r"\preceq", "⪰": r"\succeq", "≼": r"\preccurlyeq", "≽": r"\succcurlyeq", "⊂": r"\subset",
    "⊃": r"\supset", "⊆": r"\subseteq", "⊇": r"\supseteq", "⊊": r"\subsetneq", "⊋": r"\supsetneq",
    "⊄": r"\not\subset", "⊅": r"\not\supset", "⊈": r"\nsubseteq", "⊉": r"\nsupseteq", "⊏": r"\sqsubset",
    "⊐": r"\sqsupset", "⊑": r"\sqsubseteq", "⊒": r"\sqsupseteq", "∈": r"\in", "∉": r"\notin", "∋": r"\ni",
    "∌": r"\not\ni", "⊥": r"\perp", "⊢": r"\vdash", "⊣": r"\dashv", "⊨": r"\models", "⊤": r"\top", "≔": ":=",
    "≜": r"\triangleq", "≮": r"\nless", "≯": r"\ngtr", "≰": r"\nleq", "≱": r"\ngeq", "≲": r"\lesssim",
    "≳": r"\gtrsim", "≶": r"\lessgtr", "≷": r"\gtrless", "∽": r"\backsim", "≊": r"\approxeq", "≏": r"\bumpeq",
    "≎": r"\Bumpeq", "⋈": r"\bowtie", "∴": r"\therefore", "∵": r"\because", "∶": ":", "∷": "::", "≁": r"\nsim",
    "≇": r"\ncong", "⊀": r"\nprec", "⊁": r"\nsucc",
    # arrows
    "→": r"\rightarrow", "←": r"\leftarrow", "↔": r"\leftrightarrow", "⇒": r"\Rightarrow", "⇐": r"\Leftarrow",
    "⇔": r"\Leftrightarrow", "↑": r"\uparrow", "↓": r"\downarrow", "↕": r"\updownarrow", "⇑": r"\Uparrow",
    "⇓": r"\Downarrow", "⇕": r"\Updownarrow", "↦": r"\mapsto", "⟼": r"\longmapsto", "⟶": r"\longrightarrow",
    "⟵": r"\longleftarrow", "⟷": r"\longleftrightarrow", "⟹": r"\Longrightarrow", "⟸": r"\Longleftarrow",
    "⟺": r"\Longleftrightarrow", "↗": r"\nearrow", "↘": r"\searrow", "↙": r"\swarrow", "↖": r"\nwarrow",
    "⇌": r"\rightleftharpoons", "⇋": r"\leftrightharpoons", "⇀": r"\rightharpoonup", "⇁": r"\rightharpoondown",
    "↼": r"\leftharpoonup", "↽": r"\leftharpoondown", "↪": r"\hookrightarrow", "↩": r"\hookleftarrow",
    "↠": r"\twoheadrightarrow", "↞": r"\twoheadleftarrow", "⇄": r"\rightleftarrows", "⇆": r"\leftrightarrows",
    "⇉": r"\rightrightarrows", "⇇": r"\leftleftarrows", "↣": r"\rightarrowtail", "↢": r"\leftarrowtail",
    "⇝": r"\rightsquigarrow", "↺": r"\circlearrowleft", "↻": r"\circlearrowright", "↛": r"\nrightarrow",
    "↚": r"\nleftarrow", "⇏": r"\nRightarrow", "⇍": r"\nLeftarrow", "↮": r"\nleftrightarrow",
    "⇎": r"\nLeftrightarrow", "⊸": r"\multimap", "↿": r"\upharpoonleft", "↾": r"\upharpoonright",
    "⇃": r"\downharpoonleft", "⇂": r"\downharpoonright",
    # letter-like and others
    "∞": r"\infty", "∂": r"\partial", "∇": r"\nabla", "∀": r"\forall", "∃": r"\exists", "∄": r"\nexists",
    "∅": r"\emptyset", "¬": r"\neg", "ℏ": r"\hbar", "ℓ": r"\ell", "℘": r"\wp", "ℵ": r"\aleph", "ℶ": r"\beth",
    "ℷ": r"\gimel", "ℸ": r"\daleth", "ℜ": r"\Re", "ℑ": r"\Im", "ı": r"\imath", "ȷ": r"\jmath", "ð": r"\eth",
    "℧": r"\mho", "∁": r"\complement", "°": r"^{\circ}", "′": "'", "″": "''", "‴": "'''", "…": r"\ldots",
    "⋯": r"\cdots", "⋮": r"\vdots", "⋱": r"\ddots", "∠": r"\angle", "∡": r"\measuredangle", "∢": r"\sphericalangle",
    "□": r"\square", "■": r"\blacksquare", "∎": r"\blacksquare", "⟨": r"\langle", "⟩": r"\rangle", "〈": r"\langle",
    "〉": r"\rangle", "⌈": r"\lceil", "⌉": r"\rceil", "⌊": r"\lfloor", "⌋": r"\rfloor", "♠": r"\spadesuit",
    "♡": r"\heartsuit", "♢": r"\diamondsuit", "♣": r"\clubsuit", "♭": r"\flat", "♮": r"\natural", "♯": r"\sharp",
    "✓": r"\checkmark", "★": r"\bigstar", "√": r"\surd",
    # big operators written as characters (an m:nary has its own table)
    "∑": r"\sum", "∏": r"\prod", "∐": r"\coprod", "∫": r"\int", "∬": r"\iint", "∭": r"\iiint", "⨌": r"\iiiint",
    "∮": r"\oint", "⋃": r"\bigcup", "⋂": r"\bigcap", "⋁": r"\bigvee", "⋀": r"\bigwedge", "⨁": r"\bigoplus",
    "⨂": r"\bigotimes", "⨀": r"\bigodot", "⨄": r"\biguplus", "⨆": r"\bigsqcup",
    # spaces
    " ": r"\ ", "\u00a0": "~", "\u2002": r"\enspace", "\u2003": r"\quad", "\u2004": r"\;", "\u2005": r"\:",
    "\u2006": r"\,", "\u2009": r"\,", "\u200a": r"\,", "\u205f": r"\:", "\u2007": r"\enspace", "\u2008": r"\,",
    # what TeX reads as its own syntax
    "#": r"\#", "$": r"\$", "%": r"\%", "&": r"\&", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\sim",
    "^": r"\hat{}", "\\": r"\backslash",
}
# Invisible operators (function application, invisible times...) and joiners: nothing to draw.
INVISIBLE = set("\u2061\u2062\u2063\u2064\u200b\u200c\u200d\ufeff\u2060")

# Mathematical Alphanumeric Symbols (U+1D400-1D7FF): the style of each block of letters.
_LATIN_BLOCKS = [(0x1D400, "bold"), (0x1D434, "italic"), (0x1D468, "bolditalic"), (0x1D49C, "script"),
                 (0x1D4D0, "boldscript"), (0x1D504, "fraktur"), (0x1D538, "double"), (0x1D56C, "boldfraktur"),
                 (0x1D5A0, "sans"), (0x1D5D4, "sansbold"), (0x1D608, "sansitalic"), (0x1D63C, "sansbolditalic"),
                 (0x1D670, "mono")]
_GREEK_ORDER = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ"
_GREEK_BLOCKS = [(0x1D6A8, "bold"), (0x1D6E2, "italic"), (0x1D71C, "bolditalic"), (0x1D756, "sansbold"),
                 (0x1D790, "sansbolditalic")]
_DIGIT_BLOCKS = [(0x1D7CE, "bold"), (0x1D7D8, "double"), (0x1D7E2, "sans"), (0x1D7EC, "sansbold"), (0x1D7F6, "mono")]
# The letters of those blocks Unicode had already, elsewhere (the holes in the blocks).
LETTERLIKE = {"ℎ": ("italic", "h"), "ℬ": ("script", "B"), "ℰ": ("script", "E"), "ℱ": ("script", "F"),
              "ℋ": ("script", "H"), "ℐ": ("script", "I"), "ℒ": ("script", "L"), "ℳ": ("script", "M"),
              "ℛ": ("script", "R"), "ℯ": ("script", "e"), "ℊ": ("script", "g"), "ℴ": ("script", "o"),
              "ℭ": ("fraktur", "C"), "ℌ": ("fraktur", "H"), "ℨ": ("fraktur", "Z"), "ℂ": ("double", "C"),
              "ℍ": ("double", "H"), "ℕ": ("double", "N"), "ℙ": ("double", "P"), "ℚ": ("double", "Q"),
              "ℝ": ("double", "R"), "ℤ": ("double", "Z"), "𝚤": ("italic", "ı"), "𝚥": ("italic", "ȷ")}


def styled_char(ch):
    """(style, plain character) of a Mathematical Alphanumeric Symbol or a letter-like
    symbol standing in for one, else (None, ch)."""
    if ch in LETTERLIKE:
        return LETTERLIKE[ch]
    cp = ord(ch)
    if 0x1D400 <= cp < 0x1D6A4:
        for start, style in _LATIN_BLOCKS:
            if start <= cp < start + 52:
                i = cp - start
                return style, chr((0x41 if i < 26 else 0x61 - 26) + i)
    if 0x1D6A8 <= cp < 0x1D7CA:
        for start, style in _GREEK_BLOCKS:
            if start <= cp < start + 58:
                return style, _GREEK_ORDER[cp - start]
    if 0x1D7CE <= cp <= 0x1D7FF:
        for start, style in _DIGIT_BLOCKS:
            if start <= cp < start + 10:
                return style, chr(0x30 + cp - start)
    if 0x1D400 <= cp <= 0x1D7FF:
        raise Unsupported("a maths letter MathJax does not draw")
    return None, ch


def _letter_tex(ch):
    """(LaTeX, kind) of one plain letter or digit: kind is 'latin', 'digit', 'greek' (a
    lowercase Greek letter or a capital with a command of its own), 'GREEK' (a capital
    written as its Latin twin) or 'other' (a letter of another alphabet)."""
    if "a" <= ch <= "z" or "A" <= ch <= "Z":
        return ch, "latin"
    if "0" <= ch <= "9":
        return ch, "digit"
    if ch in GREEK:
        return GREEK[ch], "greek"
    if ch in GREEK_LATIN:
        return GREEK_LATIN[ch], "GREEK"
    if ch == "ı" or ch == "ȷ":
        return SYMBOLS[ch], "greek"
    if ch in ("∇", "∂"):
        return SYMBOLS[ch], "greek"
    return ch, "other"


def _wrap(style, tex, kind):
    """The LaTeX of a letter in a style (None: the default, italic for letters)."""
    upper_greek = kind == "greek" and tex[1:2].isupper()
    if style in (None, "roman"):
        return r"\mathrm{%s}" % tex if kind == "GREEK" else tex        # a Greek capital is upright
    if style == "upright":
        return r"\mathrm{%s}" % tex if kind in ("latin", "GREEK", "other") else tex
    if style == "italic":
        if kind in ("digit", "GREEK") or upper_greek:
            return r"\mathit{%s}" % tex
        return tex
    if style == "bold":
        return r"\boldsymbol{%s}" % tex if kind == "greek" and not upper_greek else r"\mathbf{%s}" % tex
    if style == "bolditalic":
        return r"\boldsymbol{%s}" % tex
    if kind in ("greek", "other"):
        raise Unsupported("a Greek letter in a font MathJax does not have")
    if style in ("script", "boldscript"):
        if kind != "latin" or not tex.isupper():
            raise Unsupported("a lowercase script letter")
        return r"\mathcal{%s}" % tex if style == "script" else r"\boldsymbol{\mathcal{%s}}" % tex
    if style in ("fraktur", "boldfraktur"):
        if kind == "digit":
            raise Unsupported("a fraktur digit")
        return r"\mathfrak{%s}" % tex if style == "fraktur" else r"\boldsymbol{\mathfrak{%s}}" % tex
    if style == "double":
        if kind != "latin" or not tex.isupper():
            raise Unsupported("a double-struck lowercase letter or digit")
        return r"\mathbb{%s}" % tex
    if style == "sans":
        return r"\mathsf{%s}" % tex
    if style == "sansbold":
        return r"\boldsymbol{\mathsf{%s}}" % tex
    if style == "mono":
        return r"\mathtt{%s}" % tex
    raise Unsupported("letters in a sans-serif italic")


# The run's own style (m:sty, m:scr) as the names styled_char uses.
def _run_style(sty, scr):
    bold = sty in ("b", "bi")
    if scr in (None, "roman"):
        return {"p": "upright", "b": "bold", "bi": "bolditalic", "i": "italic"}.get(sty)
    base = {"script": "script", "fraktur": "fraktur", "double-struck": "double", "sans-serif": "sans",
            "monospace": "mono"}.get(scr)
    if base is None:
        return None
    if bold:
        return {"script": "boldscript", "fraktur": "boldfraktur", "sans": "sansbold"}.get(base, base)
    if base == "sans" and sty in ("i", None):
        return "sans"                                       # PowerPoint's sans is upright unless asked
    return base


def chars_tex(text, run_style=None):
    """The LaTeX of the characters of a maths run, letters in their style."""
    out = []
    for ch in text:
        if ch in INVISIBLE:
            continue
        style, plain = styled_char(ch)
        tex, kind = _letter_tex(plain)
        if kind == "other" and plain in SYMBOLS:
            kind = "symbol"                                  # ℏ, ℓ, ℵ: letters to Unicode, symbols to TeX
        if kind in ("latin", "digit", "greek", "GREEK") or (kind == "other" and plain.isalpha()):
            if style or kind == "latin":
                out.append(_wrap(style or run_style, tex, kind))
            else:
                # the run's font on a digit or a Greek letter: as far as LaTeX has it
                try:
                    out.append(_wrap(run_style, tex, kind))
                except Unsupported:
                    out.append(tex)
            continue
        if plain in SYMBOLS:
            out.append(SYMBOLS[plain])
            continue
        if " " <= plain <= "~":
            out.append(plain)                                # ASCII punctuation and operators: TeX's own
            continue
        raise Unsupported("the character %s (U+%04X)" % (plain, ord(plain)))
    return _merge_wraps(out)


def _merge_wraps(pieces):
    """\\mathrm{a}\\mathrm{b} as \\mathrm{ab}: one command for a word in one style."""
    merged = []
    for p in pieces:
        m = re.fullmatch(r"(\\(?:mathrm|mathbf|mathit|mathcal|mathfrak|mathbb|mathsf|mathtt|boldsymbol))\{([^{}]*)\}", p)
        if m and merged:
            prev = re.fullmatch(re.escape(m.group(1)) + r"\{([^{}]*)\}", merged[-1])
            if prev:
                merged[-1] = "%s{%s}" % (m.group(1), join([prev.group(1), m.group(2)]))
                continue
        merged.append(p)
    return join(merged)


TEXT_SPECIAL = set("\\{}$&#^_%~")


def text_tex(text, bold=False, italic=False):
    """Normal text inside the maths (m:nor): \\text{...}, with what text mode would read as
    TeX's own syntax written in maths around it."""
    cmd = r"\textbf" if bold else r"\textit" if italic else r"\text"
    out, buf = [], ""
    for ch in text:
        if ch in INVISIBLE:
            continue
        if ch in TEXT_SPECIAL:
            if buf:
                out.append("%s{%s}" % (cmd, buf))
                buf = ""
            out.append(SYMBOLS[ch])
        else:
            buf += ch
    if buf:
        out.append("%s{%s}" % (cmd, buf))
    return join(out)


# ------------------------------------------------------------------
# Joining LaTeX
# ------------------------------------------------------------------
def join(parts):
    """Pieces of LaTeX side by side: a space after a control word that a letter follows."""
    out = ""
    for p in parts:
        if not p:
            continue
        if out and re.search(r"\\[A-Za-z]+$", out) and re.match(r"[A-Za-z]", p):
            out += " "
        out += p
    return out


def _closing(s, i):
    """Index of the brace closing the one at s[i]."""
    depth = 0
    while i < len(s):
        if s[i] == "\\":
            i += 2
            continue
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def is_atom(s):
    """Whether s is one token for TeX: a character, a control sequence, or one braced group."""
    if len(s) == 1:
        return True
    if re.fullmatch(r"\\[A-Za-z]+|\\.", s):
        return True
    if s.startswith("{"):
        return _closing(s, 0) == len(s) - 1
    m = re.match(r"\\[A-Za-z]+(?=\{)", s)                  # \mathrm{C}: a command and its one argument
    return bool(m) and _closing(s, m.end()) == len(s) - 1


def group(s):
    return s if s and is_atom(s) else "{%s}" % s


# ------------------------------------------------------------------
# Properties
# ------------------------------------------------------------------
def _local(el):
    return el.tag.split("}")[-1] if isinstance(el.tag, str) else ""


def _is_math(el):
    return isinstance(el.tag, str) and el.tag.startswith(_M)


def _pr(el, name):
    """The m:<name> property element of el's m:<local>Pr."""
    pr = el.find(_M + _local(el) + "Pr")
    return pr.find(_M + name) if pr is not None else None


def _val(el, name, default=None):
    p = _pr(el, name)
    if p is None:
        return default
    return p.get(_M + "val", p.get("val", default))


def _flag(el, name, default=False):
    p = _pr(el, name)
    if p is None:
        return default
    v = p.get(_M + "val", p.get("val"))
    if v is None:
        return True
    return v.lower() in ("1", "on", "true")


def _child(el, name):
    return el.find(_M + name)


# ------------------------------------------------------------------
# The converter
# ------------------------------------------------------------------
FUNCTIONS = {"sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth",
             "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "gcd", "arg",
             "Pr", "hom", "liminf", "limsup"}
NARY = {"∑": r"\sum", "∏": r"\prod", "∐": r"\coprod", "∫": r"\int", "∬": r"\iint", "∭": r"\iiint", "⨌": r"\iiiint",
        "∮": r"\oint", "⋃": r"\bigcup", "⋂": r"\bigcap", "⋁": r"\bigvee", "⋀": r"\bigwedge", "⨁": r"\bigoplus",
        "⨂": r"\bigotimes", "⨀": r"\bigodot", "⨄": r"\biguplus", "⨆": r"\bigsqcup"}
INTEGRALS = {"∫", "∬", "∭", "⨌", "∮"}
DELIMS = {"(": "(", ")": ")", "[": "[", "]": "]", "{": r"\{", "}": r"\}", "|": "|", "‖": r"\|", "⟨": r"\langle",
          "⟩": r"\rangle", "〈": r"\langle", "〉": r"\rangle", "⌊": r"\lfloor", "⌋": r"\rfloor", "⌈": r"\lceil",
          "⌉": r"\rceil", "/": "/", "\\": r"\backslash", "↑": r"\uparrow", "↓": r"\downarrow", "↕": r"\updownarrow",
          "⇑": r"\Uparrow", "⇓": r"\Downarrow", "⇕": r"\Updownarrow", "": "."}
MATRIX_ENVS = {("(", ")"): "pmatrix", ("[", "]"): "bmatrix", ("{", "}"): "Bmatrix", ("|", "|"): "vmatrix",
               ("‖", "‖"): "Vmatrix"}
# Accents: (over one character, over more).
ACCENTS = {}
for _chars, _cmds in (("\u0302^\u02c6", (r"\hat", r"\widehat")), ("\u0303~\u02dc", (r"\tilde", r"\widetilde")),
                      ("\u0304\u00af", (r"\bar", r"\overline")), ("\u0305\u203e", (r"\overline", r"\overline")),
                      ("\u0307\u02d9", (r"\dot", r"\dot")), ("\u0308\u00a8", (r"\ddot", r"\ddot")),
                      ("\u20db", (r"\dddot", r"\dddot")), ("\u20dc", (r"\ddddot", r"\ddddot")),
                      ("\u20d7\u2192", (r"\vec", r"\overrightarrow")), ("\u20d6\u2190", (r"\overleftarrow", r"\overleftarrow")),
                      ("\u20e1\u2194", (r"\overleftrightarrow", r"\overleftrightarrow")),
                      ("\u030c\u02c7", (r"\check", r"\check")), ("\u0306\u02d8", (r"\breve", r"\breve")),
                      ("\u0301\u00b4", (r"\acute", r"\acute")), ("\u0300`", (r"\grave", r"\grave")),
                      ("\u030a\u02da", (r"\mathring", r"\mathring"))):
    for _c in _chars:
        ACCENTS[_c] = _cmds
# Group characters with the base on the baseline: (character, position) -> command.
GROUP_ON_BASE = {("⏟", "bot"): r"\underbrace", ("⏞", "top"): r"\overbrace",
                 ("→", "top"): r"\overrightarrow", ("←", "top"): r"\overleftarrow", ("↔", "top"): r"\overleftrightarrow",
                 ("→", "bot"): r"\underrightarrow", ("←", "bot"): r"\underleftarrow", ("↔", "bot"): r"\underleftrightarrow"}
# Arrows on the baseline with the text over (or under) them.
X_ARROWS = {"→": r"\xrightarrow", "←": r"\xleftarrow", "↔": r"\xleftrightarrow", "⇒": r"\xRightarrow",
            "⇐": r"\xLeftarrow", "⇔": r"\xLeftrightarrow", "⇌": r"\xrightleftharpoons", "↦": r"\xmapsto",
            "↪": r"\xhookrightarrow", "↩": r"\xhookleftarrow"}


class Converter:
    def __init__(self):
        self.align = False                                  # inside an equation array: & marks a column
        self.aligned = False                                # and one was marked

    def args(self, el, **kw):
        """The LaTeX of an argument (m:e, m:num, m:sub...): its children side by side."""
        if el is None:
            return ""
        return join(self.conv(c, **kw) for c in el)

    def conv(self, el, fname=False):
        if not isinstance(el.tag, str):
            return ""
        name = _local(el)
        if not _is_math(el):
            # DrawingML / WordprocessingML run properties and the like carry no maths
            return "" if name in ("rPr", "ctrlPr") else join(self.conv(c, fname=fname) for c in el)
        if name.endswith("Pr"):
            return ""                                       # m:fPr, m:ctrlPr...: properties, read where needed
        method = getattr(self, "m_" + name, None)
        if method is None:
            return join(self.conv(c, fname=fname) for c in el)    # read through what is not known
        return method(el, fname)

    # -- runs ----------------------------------------------------------------
    def m_r(self, el, fname=False):
        rpr = _child(el, "rPr")
        sty = scr = None
        nor = lit_align = False
        if rpr is not None:
            for p in rpr:
                n, v = _local(p), p.get(_M + "val")
                if n == "sty":
                    sty = v
                elif n == "scr":
                    scr = v
                elif n == "nor":
                    nor = v is None or v.lower() in ("1", "on", "true")
                elif n == "brk":
                    raise Unsupported("a line break inside an equation")
                elif n == "aln":
                    lit_align = True
        if el.find(_M + "br") is not None:
            raise Unsupported("a line break inside an equation")
        text = "".join(t.text or "" for t in el.iter(_M + "t"))
        pre = "&" if lit_align and self.align else ""
        self.aligned = self.aligned or bool(pre)
        if self.align and "&" in text and not nor:
            # in an equation array, & marks where the rows line up
            self.aligned = True
            return pre + "&".join(self._run_text(part, sty, scr, nor, fname) for part in text.split("&"))
        return pre + self._run_text(text, sty, scr, nor, fname)

    def _run_text(self, text, sty, scr, nor, fname):
        if nor:
            return text_tex(text, bold=sty in ("b", "bi"), italic=sty == "i")
        plain = "".join(c for c in text if c not in INVISIBLE)
        if fname and re.fullmatch(r"[A-Za-z]+", plain or "-") and sty in (None, "p") and scr in (None, "roman"):
            # a function's name: sin, log, lim are TeX's own; any other name is an operator name
            return "\\" + plain if plain in FUNCTIONS else r"\operatorname{%s}" % plain
        return chars_tex(text, _run_style(sty, scr))

    # -- fractions and scripts ----------------------------------------------------
    def m_f(self, el, fname=False):
        num, den = self.args(_child(el, "num")), self.args(_child(el, "den"))
        kind = _val(el, "type", "bar")
        if kind == "lin":
            return "%s/%s" % (group(num), group(den))
        if kind == "skw":
            return r"{}^{%s}\!/\!{}_{%s}" % (num, den)
        if kind == "noBar":
            return r"\genfrac{}{}{0pt}{}{%s}{%s}" % (num, den)
        return r"\frac{%s}{%s}" % (num, den)

    def _base(self, el, fname):
        b = self.args(_child(el, "e"), fname=fname)
        return group(b) if b else "{}"

    def m_sSub(self, el, fname=False):
        return "%s_{%s}" % (self._base(el, fname), self.args(_child(el, "sub")))

    def m_sSup(self, el, fname=False):
        sup = self.args(_child(el, "sup"))
        if sup and set(sup) == {"'"}:
            return self._base(el, fname) + sup               # a prime: x' as TeX writes it
        return "%s^{%s}" % (self._base(el, fname), sup)

    def m_sSubSup(self, el, fname=False):
        return "%s_{%s}^{%s}" % (self._base(el, fname), self.args(_child(el, "sub")), self.args(_child(el, "sup")))

    def m_sPre(self, el, fname=False):
        return "{}_{%s}^{%s}%s" % (self.args(_child(el, "sub")), self.args(_child(el, "sup")), group(self.args(_child(el, "e"))))

    def m_rad(self, el, fname=False):
        e = self.args(_child(el, "e"))
        deg = "" if _flag(el, "degHide") else self.args(_child(el, "deg"))
        return r"\sqrt[%s]{%s}" % (deg, e) if deg else r"\sqrt{%s}" % e

    # -- n-ary operators --------------------------------------------------------------
    def m_nary(self, el, fname=False):
        ch = _val(el, "chr", "∫")
        if ch not in NARY:
            raise Unsupported("the operator %s" % ch)
        loc = _val(el, "limLoc", "subSup" if ch in INTEGRALS else "undOvr")
        out = NARY[ch]
        if loc == "undOvr" and ch in INTEGRALS:
            out += r"\limits"
        elif loc == "subSup" and ch not in INTEGRALS:
            out += r"\nolimits"
        sub = "" if _flag(el, "subHide") else self.args(_child(el, "sub"))
        sup = "" if _flag(el, "supHide") else self.args(_child(el, "sup"))
        if sub:
            out += "_{%s}" % sub
        if sup:
            out += "^{%s}" % sup
        e = self.args(_child(el, "e"))
        return out + (" " + e if e else "")

    # -- delimiters -----------------------------------------------------------------------
    def m_d(self, el, fname=False):
        beg, end, sep = _val(el, "begChr", "("), _val(el, "endChr", ")"), _val(el, "sepChr", "|")
        grow = not (_pr(el, "grow") is not None and not _flag(el, "grow"))
        for c in (beg, end, sep):
            if c not in DELIMS:
                raise Unsupported("the bracket %s" % c)
        parts = el.findall(_M + "e")
        # a matrix in parentheses, brackets or bars: the matrix environment that has them
        if grow and len(parts) == 1 and (beg, end) in MATRIX_ENVS:
            inner = [c for c in parts[0] if _is_math(c) and not _local(c).endswith("Pr")]
            if len(inner) == 1 and _local(inner[0]) == "m" and self._matrix_cols(inner[0]) is None:
                return self.matrix(inner[0], MATRIX_ENVS[(beg, end)])
        cells = [self.args(p) for p in parts]
        if not grow:
            # a fixed size: the brackets as they are, without \left and \right
            mid = DELIMS[sep] if sep else ""
            body = (" %s " % mid if mid.startswith("\\") else mid).join(cells)
            return join([DELIMS[beg] if beg else "", body, DELIMS[end] if end else ""])
        body = (r" \middle%s " % DELIMS[sep] if sep else " ").join(cells)
        return r"\left%s %s \right%s" % (DELIMS[beg], body, DELIMS[end])

    # -- functions and limits ------------------------------------------------------------
    def m_func(self, el, fname=False):
        name = self.args(_child(el, "fName"), fname=True)
        e = self.args(_child(el, "e"))
        return "%s %s" % (name, e) if name and e else name or e

    def m_limLow(self, el, fname=False):
        base = self.args(_child(el, "e"), fname=True)
        lim = self.args(_child(el, "lim"))
        if re.fullmatch(r"\\(lim|max|min|sup|inf|liminf|limsup|det|gcd|Pr)|\\operatorname\{[A-Za-z]+\}", base):
            return r"%s_{%s}" % (base.replace(r"\operatorname{", r"\operatorname*{"), lim)
        if base.startswith(r"\underbrace") and is_atom(base[len(r"\underbrace"):]):
            return r"%s_{%s}" % (base, lim)
        return r"\underset{%s}{%s}" % (lim, base)

    def m_limUpp(self, el, fname=False):
        base = self.args(_child(el, "e"), fname=fname)
        lim = self.args(_child(el, "lim"))
        if base.startswith(r"\overbrace") and is_atom(base[len(r"\overbrace"):]):
            return r"%s^{%s}" % (base, lim)
        return r"\overset{%s}{%s}" % (lim, base)

    # -- accents, bars, group characters ----------------------------------------------------
    def m_acc(self, el, fname=False):
        ch = _val(el, "chr", "\u0302")
        if ch not in ACCENTS:
            raise Unsupported("the accent %s" % ch)
        e = self.args(_child(el, "e"))
        one, wide = ACCENTS[ch]
        single = len(re.findall(r"\\[A-Za-z]+\{[^{}]\}|\\[A-Za-z]+|\\.|.", e)) <= 1
        return r"%s{%s}" % (one if single else wide, e)

    def m_bar(self, el, fname=False):
        e = self.args(_child(el, "e"))
        return (r"\overline{%s}" if _val(el, "pos", "bot") == "top" else r"\underline{%s}") % e

    def m_groupChr(self, el, fname=False):
        ch = _val(el, "chr", "\u23df")
        pos = _val(el, "pos", "bot")
        vjc = _val(el, "vertJc")
        e = self.args(_child(el, "e"))
        on_char = (pos == "bot" and vjc == "bot") or (pos == "top" and vjc == "top")
        if not on_char and (ch, pos) in GROUP_ON_BASE:
            return r"%s{%s}" % (GROUP_ON_BASE[(ch, pos)], e)
        if on_char and ch in X_ARROWS:
            return r"%s{%s}" % (X_ARROWS[ch], e) if pos == "bot" else r"%s[%s]{}" % (X_ARROWS[ch], e)
        raise Unsupported("the character %s over or under an expression" % ch)

    # -- boxes and phantoms -----------------------------------------------------------------
    def m_box(self, el, fname=False):
        pre = "&" if self.align and _flag(el, "aln") else ""
        self.aligned = self.aligned or bool(pre)
        return pre + self.args(_child(el, "e"))

    def m_borderBox(self, el, fname=False):
        e = self.args(_child(el, "e"))
        sides = [s for s, hide in (("top", "hideTop"), ("bottom", "hideBot"), ("left", "hideLeft"), ("right", "hideRight")) if not _flag(el, hide)]
        strikes = [s for s, f in (("horizontalstrike", "strikeH"), ("verticalstrike", "strikeV"),
                                  ("updiagonalstrike", "strikeBLTR"), ("downdiagonalstrike", "strikeTLBR")) if _flag(el, f)]
        if len(sides) == 4 and not strikes:
            return r"\boxed{%s}" % e
        if not sides and strikes in (["updiagonalstrike"], ["downdiagonalstrike"], ["updiagonalstrike", "downdiagonalstrike"]):
            return {1: r"\cancel{%s}" if strikes == ["updiagonalstrike"] else r"\bcancel{%s}", 2: r"\xcancel{%s}"}[len(strikes)] % e
        if not sides and not strikes:
            return e
        return r"\enclose{%s}{%s}" % (",".join(sides + strikes), e)

    def m_phant(self, el, fname=False):
        e = self.args(_child(el, "e"))
        show = _flag(el, "show", True)
        wid, asc, desc = _flag(el, "zeroWid"), _flag(el, "zeroAsc"), _flag(el, "zeroDesc")
        if not show:
            if not (wid or asc or desc):
                return r"\phantom{%s}" % e
            if wid and not asc and not desc:
                return r"\vphantom{%s}" % e
            if asc and desc and not wid:
                return r"\hphantom{%s}" % e
            if asc and desc and wid:
                return ""
        else:
            if not (wid or asc or desc):
                return e
            if asc and desc and not wid:
                return r"\smash{%s}" % e
            if asc and not desc and not wid:
                return r"\smash[t]{%s}" % e
            if desc and not asc and not wid:
                return r"\smash[b]{%s}" % e
        raise Unsupported("a phantom of a kind LaTeX has no command for")

    # -- matrices and equation arrays --------------------------------------------------------
    def _matrix_cols(self, el):
        """The column alignments of a matrix ('lcr'...), or None when all are centred."""
        mcs = el.find(_M + "mPr/" + _M + "mcs")
        if mcs is None:
            return None
        cols = []
        for mc in mcs.findall(_M + "mc"):
            pr = mc.find(_M + "mcPr")
            count = pr.find(_M + "count") if pr is not None else None
            jc = pr.find(_M + "mcJc") if pr is not None else None
            n = int((count.get(_M + "val") if count is not None else None) or 1)
            a = {"left": "l", "right": "r"}.get(jc.get(_M + "val") if jc is not None else "", "c")
            cols.extend([a] * max(1, min(n, 64)))
        return "".join(cols) if any(c != "c" for c in cols) else None

    def m_m(self, el, fname=False):
        return self.matrix(el)

    def matrix(self, el, env="matrix"):
        keep, self.align = self.align, False
        try:
            rows = [" & ".join(self.args(e) for e in mr.findall(_M + "e")) for mr in el.findall(_M + "mr")]
        finally:
            self.align = keep
        cols = self._matrix_cols(el)
        body = r" \\ ".join(rows)
        if cols:
            return r"\begin{array}{%s} %s \end{array}" % (cols, body)      # columns lined up left or right
        return r"\begin{%s} %s \end{%s}" % (env, body, env)

    def m_eqArr(self, el, fname=False):
        keep = self.align, self.aligned
        self.align, self.aligned = True, False
        try:
            rows = [self.args(e) for e in el.findall(_M + "e")]
            env = "aligned" if self.aligned else "gathered"
        finally:
            self.align, self.aligned = keep
        return r"\begin{%s} %s \end{%s}" % (env, r" \\ ".join(rows), env)


def to_latex(el):
    """The LaTeX of an m:oMath (or any OMML element). Raises Unsupported."""
    return Converter().conv(el).strip()


def para_latex(el):
    """(LaTeX, justification) of an m:oMathPara: its m:oMath lines, more than one stacked
    (centred, or lined up on the left or the right as the paragraph's m:jc says)."""
    jc = "centerGroup"
    pr = el.find(_M + "oMathParaPr/" + _M + "jc")
    if pr is not None:
        jc = pr.get(_M + "val", jc)
    if _local(el) == "oMath":
        return to_latex(el), jc
    lines = [to_latex(m) for m in el.findall(_M + "oMath")]
    lines = [ln for ln in lines if ln]
    return stack(lines, jc), jc


def stack(lines, jc="centerGroup"):
    """Lines of LaTeX one under the other."""
    if len(lines) <= 1:
        return lines[0] if lines else ""
    if jc == "left":
        return r"\begin{aligned} %s \end{aligned}" % r" \\ ".join("&" + ln for ln in lines)
    if jc == "right":
        return r"\begin{aligned} %s \end{aligned}" % r" \\ ".join(ln + "&" for ln in lines)
    return r"\begin{gathered} %s \end{gathered}" % r" \\ ".join(lines)


def plain_text(el):
    """The characters of an equation, its maths letters as plain ones, with the operators
    and brackets its structures draw."""
    out = []

    def walk(node):
        name = _local(node) if _is_math(node) else ""
        if name == "t":
            for ch in node.text or "":
                if ch not in INVISIBLE:
                    try:
                        out.append(styled_char(ch)[1])
                    except Unsupported:
                        out.append(ch)
            return
        if name == "nary":
            out.append(_val(node, "chr", "∫"))
        if name == "d":
            out.append(_val(node, "begChr", "("))
        for c in node:
            walk(c)
        if name == "d":
            out.append(_val(node, "endChr", ")"))

    walk(el)
    return "".join(out)
