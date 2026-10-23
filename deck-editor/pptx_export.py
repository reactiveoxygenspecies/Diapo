"""Deck -> PowerPoint (.pptx) with real, editable content.

The editor measures the open deck in the browser (core/pptx.js: every
element's box, rotation, fill and outline, its text as paragraphs and runs
with their fonts and colours, pictures and their crops, tables, notes) and
sends that description here as JSON; build_pptx() writes the OOXML package
with the standard library only, the reverse of pptx_import.py.

    1 stage px = 6350 EMU = 0.5 pt, so a 1920 x 1080 stage is PowerPoint's
    13.333 x 7.5 in widescreen slide and 48px text is 24 pt.

The description (all lengths in stage px):

    {"w": 1920, "h": 1080, "title": str, "theme": {"colours": [..hex], "fonts": [major, minor]},
     "slides": [{"hidden": bool, "notes": str, "bg": {"color": "#hex", "image": PICTURE},
                 "items": [ITEM, ...]}]}

    ITEM, every kind: x, y, w, h, rot (degrees), name, alt
      "shape"  geom rect|roundRect|ellipse, radius, fill FILL, line LINE,
               paras [PARA], inset [l,t,r,b], anchor t|ctr|b, wrap bool
      "pic"    PICTURE, crop [l,t,r,b] (fractions cut off), flipH, flipV,
               alpha, radius
      "svg"    svg (markup), png (data: URL, the fallback older readers show)
      "table"  cols [px], rows [{h, cells [{paras, fill, span, rowspan,
               hmerge, vmerge, inset, anchor, borders {l,r,t,b: LINE}}]}]
      "chart"  kind column|bar|line|area|pie|doughnut, labels, series
               [{name, values, color}], stacked, legend, values, grid,
               title, text {font, size, color}; drawn natively, with its
               table in an embedded workbook so Edit Data works
    PICTURE  {"path": workspace-relative file} or {"data": data: URL}
    FILL     {"color": "#hex", "alpha": 0..1}
    LINE     {"color", "alpha", "width" px, "dash": solid|dash|dot}
    PARA     {align l|ctr|r|just, lineMult, before, after, marL, indent, level,
              bullet {"char": str} | {"auto": scheme, "start": n} | null,
              runs [{t, font, size, b, i, u, s, color, alpha, base, spc, cap, href} | {br: true}]}

resolve(picture) -> (bytes, extension) | None is supplied by serve.py, which
keeps file reads inside the workspace.
"""
import base64
import datetime
import io
import math
import re
import zipfile
from xml.sax.saxutils import escape

import pptx_chart_export

EMU = 6350                  # per stage px
PT100 = 50                  # hundredths of a point per stage px
INVALID_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")

NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
XMLNS = f'xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}"'
HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
SVG_EXT = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}"
IMAGE_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp",
               "tiff": "image/tiff", "svg": "image/svg+xml", "webp": "image/webp"}


def x(s):
    """Text for XML: escaped, with the characters XML forbids removed."""
    return escape(INVALID_XML.sub("", str(s if s is not None else "")), {'"': "&quot;"})


def emu(px):
    return int(round(float(px or 0) * EMU))


def hexcol(c, default="000000"):
    c = (c or "").strip().lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{6}", c):
        return c.upper()
    if re.fullmatch(r"[0-9a-fA-F]{3}", c):
        return "".join(ch * 2 for ch in c).upper()
    return default


def colour_xml(c, alpha=1.0):
    a = float(1 if alpha is None else alpha)
    inner = f'<a:alpha val="{int(round(max(0, min(1, a)) * 100000))}"/>' if a < 0.999 else ""
    return f'<a:srgbClr val="{hexcol(c)}">{inner}</a:srgbClr>'


def grad_xml(grad):
    """CSS gradient -> a:gradFill. CSS angles start at "to top" going clockwise; DrawingML's 0 is left to right."""
    stops = "".join(f'<a:gs pos="{int(round(max(0, min(1, float(s.get("pos") or 0))) * 100000))}">{colour_xml(s.get("color"), s.get("alpha"))}</a:gs>'
                    for s in grad.get("stops") or [])
    if grad.get("radial"):
        shade = '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>'
    else:
        ang = (float(grad.get("angle", 180)) - 90) % 360
        shade = f'<a:lin ang="{int(round(ang * 60000))}" scaled="0"/>'
    return f'<a:gradFill rotWithShape="1"><a:gsLst>{stops}</a:gsLst>{shade}</a:gradFill>'


def fill_xml(fill):
    if fill and fill.get("grad") and len(fill["grad"].get("stops") or []) >= 2:
        return grad_xml(fill["grad"])
    if not fill or not fill.get("color"):
        return "<a:noFill/>"
    return f"<a:solidFill>{colour_xml(fill['color'], fill.get('alpha'))}</a:solidFill>"


def line_xml(line):
    if not line or not line.get("color") or float(line.get("width") or 0) <= 0:
        return "<a:ln><a:noFill/></a:ln>"
    dash = {"dash": "dash", "dot": "sysDot"}.get(line.get("dash"), "")
    return (f'<a:ln w="{emu(line["width"])}"><a:solidFill>{colour_xml(line["color"], line.get("alpha"))}</a:solidFill>'
            + (f'<a:prstDash val="{dash}"/>' if dash else "") + "</a:ln>")


def effects_xml(it):
    """A box-shadow as an outer shadow, a blur filter as soft edges (DrawingML orders them so)."""
    out = ""
    sh = it.get("shadow")
    if sh and sh.get("color"):
        dx, dy = float(sh.get("x") or 0), float(sh.get("y") or 0)
        dist, ang = math.hypot(dx, dy), (math.degrees(math.atan2(dy, dx)) % 360)
        out += (f'<a:outerShdw blurRad="{emu(sh.get("blur"))}" dist="{emu(dist)}" dir="{int(round(ang * 60000))}" algn="ctr" rotWithShape="0">'
                f'{colour_xml(sh["color"], sh.get("alpha"))}</a:outerShdw>')
    if it.get("soft"):
        out += f'<a:softEdge rad="{emu(it["soft"])}"/>'
    return f"<a:effectLst>{out}</a:effectLst>" if out else ""


class Package:
    """The parts of the .pptx as they are written: name -> bytes, with content types."""

    def __init__(self):
        self.parts = {}
        self.defaults = {"rels": "application/vnd.openxmlformats-package.relationships+xml", "xml": "application/xml"}
        self.overrides = {}
        self.media = {}                      # sha of bytes -> part name, so a picture used twice is stored once
        self.charts = []
        self.n_media = 0

    def add(self, name, data, ctype=None):
        self.parts[name] = data.encode("utf-8") if isinstance(data, str) else data
        if ctype:
            self.overrides["/" + name] = ctype

    def add_media(self, data, ext):
        import hashlib
        key = hashlib.sha1(data).hexdigest()
        if key in self.media:
            return self.media[key]
        ext = "jpeg" if ext == "jpg" else ext
        self.n_media += 1
        name = f"ppt/media/image{self.n_media}.{ext}"
        self.parts[name] = data
        self.defaults.setdefault(ext, IMAGE_TYPES.get(ext, "application/octet-stream"))
        self.media[key] = name
        return name

    def write(self):
        ct = [HEAD, f'<Types xmlns="{NS_CT}">']
        ct += [f'<Default Extension="{e}" ContentType="{t}"/>' for e, t in sorted(self.defaults.items())]
        ct += [f'<Override PartName="{p}" ContentType="{t}"/>' for p, t in sorted(self.overrides.items())]
        ct.append("</Types>")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", "".join(ct))
            for name in sorted(self.parts, key=lambda n: (not n.startswith("_rels"), n)):
                z.writestr(name, self.parts[name])
        return buf.getvalue()


class Rels:
    def __init__(self):
        self.items = []

    def add(self, rtype, target, external=False):
        rid = f"rId{len(self.items) + 1}"
        self.items.append((rid, rtype, target, external))
        return rid

    def xml(self):
        out = [HEAD, f'<Relationships xmlns="{NS_REL}">']
        for rid, rtype, target, ext in self.items:
            mode = ' TargetMode="External"' if ext else ""
            out.append(f'<Relationship Id="{rid}" Type="{rtype if rtype.startswith("http") else RT + rtype}" Target="{x(target)}"{mode}/>')
        out.append("</Relationships>")
        return "".join(out)


def decode_data_url(url):
    m = re.match(r"data:([\w/+.-]+)?(;charset=[^;,]+)?(;base64)?,(.*)$", url or "", re.S)
    if not m:
        return None
    mime = (m.group(1) or "").lower()
    raw = m.group(4)
    try:
        data = base64.b64decode(raw) if m.group(3) else bytes(__import__("urllib.parse").parse.unquote(raw), "utf-8")
    except (ValueError, TypeError):
        return None
    ext = {"image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp", "image/bmp": "bmp"}.get(mime)
    return (data, ext) if ext else None


class SlideWriter:
    """One slide's shape tree, its relationships and what could not be carried."""

    def __init__(self, pkg, resolve, notes_out):
        self.pkg = pkg
        self.resolve = resolve
        self.rels = Rels()
        self.next_id = 2
        self.notes = notes_out
        self.charts = []

    def nid(self):
        self.next_id += 1
        return self.next_id - 1

    def picture_rel(self, pic):
        got = None
        if pic.get("data"):
            got = decode_data_url(pic["data"])
        elif pic.get("path"):
            got = self.resolve(pic)
        if not got:
            return None
        data, ext = got
        name = self.pkg.add_media(data, ext)
        return self.rels.add("image", "../media/" + name.rsplit("/", 1)[1])

    @staticmethod
    def xfrm(it, tag="a:xfrm"):
        rot = float(it.get("rot") or 0) % 360
        attrs = (f' rot="{int(round(rot * 60000))}"' if abs(rot) > 0.01 else "")
        attrs += ' flipH="1"' if it.get("flipH") else ""
        attrs += ' flipV="1"' if it.get("flipV") else ""
        return (f'<{tag}{attrs}><a:off x="{emu(it.get("x"))}" y="{emu(it.get("y"))}"/>'
                f'<a:ext cx="{max(1, emu(it.get("w")))}" cy="{max(1, emu(it.get("h")))}"/></{tag}>')

    def nv(self, it, kind, extra_c=""):
        i = self.nid()
        name = x(it.get("name") or f"{kind} {i}")
        descr = f' descr="{x(it["alt"])}"' if it.get("alt") else ""
        return i, f'<p:cNvPr id="{i}" name="{name}"{descr}/>'

    @staticmethod
    def geom(it):
        g = it.get("geom") or "rect"
        if g in ("round2Diag", "round2Same"):
            short = max(1.0, min(float(it.get("w") or 1), float(it.get("h") or 1)))
            a1 = int(round(max(0, min(0.5, float(it.get("radius") or 0) / short)) * 100000))
            a2 = int(round(max(0, min(0.5, float(it.get("radius2") or 0) / short)) * 100000))
            return (f'<a:prstGeom prst="{g}Rect"><a:avLst><a:gd name="adj1" fmla="val {a1}"/><a:gd name="adj2" fmla="val {a2}"/></a:avLst></a:prstGeom>')
        if g == "roundRect":
            r = float(it.get("radius") or 0)
            short = max(1.0, min(float(it.get("w") or 1), float(it.get("h") or 1)))
            adj = int(round(max(0, min(0.5, r / short)) * 100000))
            return f'<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val {adj}"/></a:avLst></a:prstGeom>'
        return f'<a:prstGeom prst="{"ellipse" if g == "ellipse" else "rect"}"><a:avLst/></a:prstGeom>'

    # -- text --------------------------------------------------------
    def run_xml(self, r):
        if r.get("br"):
            return f'<a:br><a:rPr lang="en-US" sz="{max(100, int(round(float(r.get("size") or 32) * PT100)))}"/></a:br>'
        attrs = f' lang="{x(r.get("lang") or "en-US")}" sz="{max(100, int(round(float(r.get("size") or 32) * PT100)))}"'
        attrs += ' b="1"' if r.get("b") else ' b="0"'
        attrs += ' i="1"' if r.get("i") else ""
        attrs += ' u="sng"' if r.get("u") else ""
        attrs += ' strike="sngStrike"' if r.get("s") else ""
        if r.get("base"):
            attrs += f' baseline="{int(r["base"])}"'
        if r.get("spc"):
            attrs += f' spc="{int(round(float(r["spc"]) * PT100))}"'
        if r.get("cap") in ("all", "small"):
            attrs += f' cap="{r["cap"]}"'
        inner = f"<a:solidFill>{colour_xml(r.get('color') or '#000000', r.get('alpha'))}</a:solidFill>"
        if r.get("highlight"):
            inner += f'<a:highlight><a:srgbClr val="{hexcol(r["highlight"])}"/></a:highlight>'
        if r.get("font"):
            f = x(r["font"])
            inner += f'<a:latin typeface="{f}"/><a:ea typeface="{f}"/><a:cs typeface="{f}"/>'
        if r.get("href"):
            rid = self.rels.add("hyperlink", r["href"], external=True)
            inner += f'<a:hlinkClick r:id="{rid}"/>'
        return f"<a:r><a:rPr{attrs} dirty=\"0\">{inner}</a:rPr><a:t>{x(r.get('t', ''))}</a:t></a:r>"

    def para_xml(self, p):
        attrs = ""
        align = {"l": "l", "ctr": "ctr", "r": "r", "just": "just"}.get(p.get("align"), "l")
        attrs += f' algn="{align}"'
        if p.get("level"):
            attrs += f' lvl="{min(8, int(p["level"]))}"'
        if p.get("marL"):
            attrs += f' marL="{emu(p["marL"])}"'
        if p.get("indent"):
            attrs += f' indent="{emu(p["indent"])}"'
        inner = ""
        if p.get("lineMult"):
            # PowerPoint's 100% is the font's own line (about 1.2 em); CSS gives line-height / font-size.
            inner += f'<a:lnSpc><a:spcPct val="{int(round(float(p["lineMult"]) / 1.2 * 100000))}"/></a:lnSpc>'
        inner += f'<a:spcBef><a:spcPts val="{int(round(float(p.get("before") or 0) * PT100))}"/></a:spcBef>'
        inner += f'<a:spcAft><a:spcPts val="{int(round(float(p.get("after") or 0) * PT100))}"/></a:spcAft>'
        b = p.get("bullet")
        if b and b.get("auto"):
            col = b.get("color")
            inner += (f"<a:buClr>{colour_xml(col)}</a:buClr>" if col else "") + f'<a:buFont typeface="+mj-lt"/><a:buAutoNum type="{x(b["auto"])}"' + (f' startAt="{int(b["start"])}"' if b.get("start") and int(b["start"]) != 1 else "") + "/>"
        elif b and b.get("char"):
            col = b.get("color")
            size = f'<a:buSzPct val="{int(round(float(b["scale"]) * 100000))}"/>' if b.get("scale") else ""
            inner += (f"<a:buClr>{colour_xml(col)}</a:buClr>" if col else "") + size + f'<a:buFont typeface="Arial"/><a:buChar char="{x(b["char"][:1])}"/>'
        else:
            inner += "<a:buNone/>"
        runs = p.get("runs") or []
        body = "".join(self.run_xml(r) for r in runs)
        size = next((r.get("size") for r in runs if r.get("size")), 32)
        end = f'<a:endParaRPr lang="en-US" sz="{int(round(float(size) * PT100))}" dirty="0"/>'
        return f"<a:p><a:pPr{attrs}>{inner}</a:pPr>{body}{end}</a:p>"

    def body_xml(self, it, tag="p:txBody"):
        l, t, r, b = (list(it.get("inset") or [0, 0, 0, 0]) + [0, 0, 0, 0])[:4]
        anchor = {"t": "t", "ctr": "ctr", "b": "b"}.get(it.get("anchor"), "t")
        wrap = "square" if it.get("wrap", True) else "none"
        paras = it.get("paras") or [{"runs": []}]
        return (f'<{tag}><a:bodyPr wrap="{wrap}" lIns="{emu(l)}" tIns="{emu(t)}" rIns="{emu(r)}" bIns="{emu(b)}" anchor="{anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr>'
                f'<a:lstStyle/>{"".join(self.para_xml(p) for p in paras)}</{tag}>')

    # -- items -------------------------------------------------------
    def shape(self, it):
        i, cnv = self.nv(it, "TextBox" if it.get("paras") else "Shape")
        tx = ' txBox="1"' if it.get("paras") and not it.get("fill") and not it.get("line") else ""
        sppr = f'<p:spPr>{self.xfrm(it)}{self.geom(it)}{fill_xml(it.get("fill"))}{line_xml(it.get("line"))}{effects_xml(it)}</p:spPr>'
        body = self.body_xml(it) if it.get("paras") else ""
        return f"<p:sp><p:nvSpPr>{cnv}<p:cNvSpPr{tx}/><p:nvPr/></p:nvSpPr>{sppr}{body}</p:sp>"

    def pic(self, it):
        rid = self.picture_rel(it.get("src") or {})
        if not rid:
            self.notes.append(f"picture not found, left out: {(it.get('src') or {}).get('path', 'embedded picture')}")
            return ""
        i, cnv = self.nv(it, "Picture")
        crop = ""
        if it.get("crop"):
            l, t, r, b = [int(round(max(0.0, min(0.99, float(v or 0))) * 100000)) for v in (list(it["crop"]) + [0, 0, 0, 0])[:4]]
            if l or t or r or b:
                crop = f'<a:srcRect l="{l}" t="{t}" r="{r}" b="{b}"/>'
        alpha = float(it.get("alpha") if it.get("alpha") is not None else 1)
        amod = f'<a:alphaModFix amt="{int(round(alpha * 100000))}"/>' if alpha < 0.999 else ""
        geom = self.geom({**it, "geom": "roundRect" if it.get("radius") else "rect"})
        return (f'<p:pic><p:nvPicPr>{cnv}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
                f'<p:blipFill><a:blip r:embed="{rid}">{amod}</a:blip>{crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill>'
                f'<p:spPr>{self.xfrm(it)}{geom}</p:spPr></p:pic>')

    def svg(self, it):
        svg = (it.get("svg") or "").encode("utf-8")
        png = decode_data_url(it.get("png") or "")
        if not svg and not png:
            return ""
        if not png:
            self.notes.append(f"{it.get('name') or 'drawing'}: no fallback picture, older PowerPoint shows it empty")
        i, cnv = self.nv(it, "Graphic")
        png_rid = self.rels.add("image", "../media/" + self.pkg.add_media(png[0], "png").rsplit("/", 1)[1]) if png else None
        svg_rid = self.rels.add("image", "../media/" + self.pkg.add_media(svg, "svg").rsplit("/", 1)[1]) if svg else None
        ext = (f'<a:extLst><a:ext uri="{SVG_EXT}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="{svg_rid}"/></a:ext></a:extLst>'
               if svg_rid else "")
        alpha = float(it.get("alpha") if it.get("alpha") is not None else 1)
        amod = f'<a:alphaModFix amt="{int(round(alpha * 100000))}"/>' if alpha < 0.999 else ""
        blip = f'<a:blip r:embed="{png_rid or svg_rid}">{amod}{ext}</a:blip>'
        return (f'<p:pic><p:nvPicPr>{cnv}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
                f'<p:blipFill>{blip}<a:stretch><a:fillRect/></a:stretch></p:blipFill>'
                f'<p:spPr>{self.xfrm(it)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')

    def table(self, it):
        i, cnv = self.nv(it, "Table")
        cols = it.get("cols") or []
        grid = "".join(f'<a:gridCol w="{max(1, emu(w))}"/>' for w in cols)
        rows = []
        for row in it.get("rows") or []:
            cells = []
            for c in row.get("cells") or []:
                attrs = ""
                if (c.get("span") or 1) > 1:
                    attrs += f' gridSpan="{int(c["span"])}"'
                if (c.get("rowspan") or 1) > 1:
                    attrs += f' rowSpan="{int(c["rowspan"])}"'
                if c.get("hmerge"):
                    attrs += ' hMerge="1"'
                if c.get("vmerge"):
                    attrs += ' vMerge="1"'
                l, t, r, b = (list(c.get("inset") or [8, 4, 8, 4]) + [0, 0, 0, 0])[:4]
                anchor = {"t": "t", "ctr": "ctr", "b": "b"}.get(c.get("anchor"), "t")
                borders = c.get("borders") or {}
                lines = ""
                for side, tag in (("l", "lnL"), ("r", "lnR"), ("t", "lnT"), ("b", "lnB")):
                    ln = borders.get(side)
                    if ln and ln.get("color") and float(ln.get("width") or 0) > 0:
                        lines += f'<a:{tag} w="{emu(ln["width"])}"><a:solidFill>{colour_xml(ln["color"], ln.get("alpha"))}</a:solidFill></a:{tag}>'
                    else:
                        lines += f"<a:{tag} w=\"0\"><a:noFill/></a:{tag}>"
                tcpr = f'<a:tcPr marL="{emu(l)}" marR="{emu(r)}" marT="{emu(t)}" marB="{emu(b)}" anchor="{anchor}">{lines}{fill_xml(c.get("fill"))}</a:tcPr>'
                body = self.body_xml({"paras": c.get("paras") or [{"runs": []}], "inset": [0, 0, 0, 0]}, tag="a:txBody")
                cells.append(f"<a:tc{attrs}>{body}{tcpr}</a:tc>")
            rows.append(f'<a:tr h="{max(1, emu(row.get("h")))}">{"".join(cells)}</a:tr>')
        tbl = f'<a:tbl><a:tblPr firstRow="0" bandRow="0"/><a:tblGrid>{grid}</a:tblGrid>{"".join(rows)}</a:tbl>'
        return (f'<p:graphicFrame><p:nvGraphicFramePr>{cnv}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
                f'{self.xfrm(it, "p:xfrm")}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">{tbl}</a:graphicData></a:graphic></p:graphicFrame>')

    def chart(self, it):
        self.pkg.charts.append(it)
        n = len(self.pkg.charts)
        chart_xml, workbook = pptx_chart_export.chart_part(it)
        self.pkg.add(f"ppt/charts/chart{n}.xml", chart_xml, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml")
        crels = Rels()
        if workbook:
            self.pkg.add(f"ppt/embeddings/Microsoft_Excel_Worksheet{n}.xlsx", workbook)
            self.pkg.defaults.setdefault("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            crels.add("package", f"../embeddings/Microsoft_Excel_Worksheet{n}.xlsx")
        self.pkg.add(f"ppt/charts/_rels/chart{n}.xml.rels", crels.xml())
        rid = self.rels.add("chart", f"../charts/chart{n}.xml")
        i, cnv = self.nv(it, "Chart")
        return (f'<p:graphicFrame><p:nvGraphicFramePr>{cnv}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
                f'{self.xfrm(it, "p:xfrm")}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
                f'<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="{rid}"/></a:graphicData></a:graphic></p:graphicFrame>')

    def item(self, it):
        kind = it.get("kind")
        try:
            if kind == "shape":
                return self.shape(it)
            if kind == "pic":
                return self.pic(it)
            if kind == "svg":
                return self.svg(it)
            if kind == "table":
                return self.table(it)
            if kind == "chart":
                return self.chart(it)
        except (TypeError, ValueError, KeyError) as e:
            self.notes.append(f"{it.get('name') or kind}: left out ({e})")
        return ""

    def background(self, bg):
        if not bg:
            return ""
        if bg.get("image"):
            rid = self.picture_rel(bg["image"])
            if rid:
                return (f'<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="{rid}"/><a:srcRect/>'
                        f'<a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>')
        if bg.get("grad") and len(bg["grad"].get("stops") or []) >= 2:
            return f'<p:bg><p:bgPr>{grad_xml(bg["grad"])}<a:effectLst/></p:bgPr></p:bg>'
        if bg.get("color"):
            return f'<p:bg><p:bgPr><a:solidFill>{colour_xml(bg["color"], bg.get("alpha"))}</a:solidFill><a:effectLst/></p:bgPr></p:bg>'
        return ""


SP_TREE_HEAD = ('<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
                '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>')


def theme_xml(name, colours, fonts):
    c = [hexcol(v) for v in (list(colours or []) + ["1C1C1F", "FFFFFF", "44546A", "E7E6E6", "2F6FED", "E8503F", "1C9A94", "F59E0B", "8B5CF6", "06B6D4"])[:10]]
    major, minor = (list(fonts or []) + ["Calibri", "Calibri"])[:2]
    names = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]
    scheme = "".join(f'<a:{n}><a:srgbClr val="{v}"/></a:{n}>' for n, v in zip(names, c))
    fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    ln = '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
    return (HEAD + f'<a:theme xmlns:a="{NS_A}" name="{x(name)}"><a:themeElements>'
            f'<a:clrScheme name="{x(name)}">{scheme}<a:hlink><a:srgbClr val="{c[4]}"/></a:hlink><a:folHlink><a:srgbClr val="{c[5]}"/></a:folHlink></a:clrScheme>'
            f'<a:fontScheme name="{x(name)}"><a:majorFont><a:latin typeface="{x(major)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
            f'<a:minorFont><a:latin typeface="{x(minor)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
            f'<a:fmtScheme name="{x(name)}"><a:fillStyleLst>{fill * 3}</a:fillStyleLst><a:lnStyleLst>{ln * 3}</a:lnStyleLst>'
            '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
            f'<a:bgFillStyleLst>{fill * 3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>')


CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'


def text_styles(minor_size=1800):
    lvl = "".join(f'<a:lvl{n}pPr marL="{(n - 1) * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">'
                  f'<a:defRPr sz="{minor_size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl{n}pPr>'
                  for n in range(1, 10))
    return lvl


def build_pptx(spec, resolve=lambda pic: None):
    """The .pptx bytes for a deck description, and notes on what was left out or changed."""
    pkg = Package()
    notes_out = []
    W, H = float(spec.get("w") or 1920), float(spec.get("h") or 1080)
    cx, cy = emu(W), emu(H)
    title = spec.get("title") or "Presentation"
    theme = spec.get("theme") or {}
    slides = spec.get("slides") or []
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Package-level parts
    root = Rels()
    root.add("officeDocument", "ppt/presentation.xml")
    root.add("http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")
    root.add("extended-properties", "docProps/app.xml")
    pkg.add("_rels/.rels", root.xml())
    pkg.add("docProps/core.xml", HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
            f'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{x(title)}</dc:title><dc:creator>Diapo</dc:creator>'
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>',
            "application/vnd.openxmlformats-package.core-properties+xml")
    pkg.add("docProps/app.xml", HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
            f'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Diapo</Application><Slides>{len(slides)}</Slides></Properties>',
            "application/vnd.openxmlformats-officedocument.extended-properties+xml")

    # Theme, master, one blank layout
    pkg.add("ppt/theme/theme1.xml", theme_xml(title[:60] or "Diapo", theme.get("colours"), theme.get("fonts")), "application/vnd.openxmlformats-officedocument.theme+xml")
    pkg.add("ppt/theme/theme2.xml", theme_xml("Notes", theme.get("colours"), theme.get("fonts")), "application/vnd.openxmlformats-officedocument.theme+xml")
    master_rels = Rels()
    master_rels.add("slideLayout", "../slideLayouts/slideLayout1.xml")
    master_rels.add("theme", "../theme/theme1.xml")
    pkg.add("ppt/slideMasters/_rels/slideMaster1.xml.rels", master_rels.xml())
    pkg.add("ppt/slideMasters/slideMaster1.xml", HEAD + f'<p:sldMaster {XMLNS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'
            f'<p:spTree>{SP_TREE_HEAD}</p:spTree></p:cSld><p:clrMap {CLR_MAP}/>'
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
            f'<p:txStyles><p:titleStyle>{text_styles(4400)}</p:titleStyle><p:bodyStyle>{text_styles()}</p:bodyStyle><p:otherStyle>{text_styles()}</p:otherStyle></p:txStyles></p:sldMaster>',
            "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml")
    layout_rels = Rels()
    layout_rels.add("slideMaster", "../slideMasters/slideMaster1.xml")
    pkg.add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", layout_rels.xml())
    pkg.add("ppt/slideLayouts/slideLayout1.xml", HEAD + f'<p:sldLayout {XMLNS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>{SP_TREE_HEAD}</p:spTree></p:cSld>'
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
            "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml")

    # Notes master (needed by any notes slide)
    nm_rels = Rels()
    nm_rels.add("theme", "../theme/theme2.xml")
    pkg.add("ppt/notesMasters/_rels/notesMaster1.xml.rels", nm_rels.xml())
    pkg.add("ppt/notesMasters/notesMaster1.xml", HEAD + f'<p:notesMaster {XMLNS}><p:cSld><p:spTree>{SP_TREE_HEAD}'
            '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>'
            '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
            '<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>'
            f'</p:spTree></p:cSld><p:clrMap {CLR_MAP}/><p:notesStyle>{text_styles(1200)}</p:notesStyle></p:notesMaster>',
            "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml")

    # Slides
    pres_rels = Rels()
    pres_rels.add("slideMaster", "slideMasters/slideMaster1.xml")
    pres_rels.add("notesMaster", "notesMasters/notesMaster1.xml")
    slide_ids = []
    for n, s in enumerate(slides, 1):
        sw = SlideWriter(pkg, resolve, notes_out)
        sw.rels.add("slideLayout", "../slideLayouts/slideLayout1.xml")
        shapes = "".join(sw.item(it) for it in (s.get("items") or []))
        notes_text = (s.get("notes") or "").strip()
        if notes_text:
            sw.rels.add("notesSlide", f"../notesSlides/notesSlide{n}.xml")
            nrels = Rels()
            nrels.add("notesMaster", "../notesMasters/notesMaster1.xml")
            nrels.add("slide", f"../slides/slide{n}.xml")
            pkg.add(f"ppt/notesSlides/_rels/notesSlide{n}.xml.rels", nrels.xml())
            paras = "".join(f'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>{x(line)}</a:t></a:r></a:p>' if line.strip() else '<a:p><a:endParaRPr lang="en-US"/></a:p>'
                            for line in notes_text.split("\n"))
            pkg.add(f"ppt/notesSlides/notesSlide{n}.xml", HEAD + f'<p:notes {XMLNS}><p:cSld><p:spTree>{SP_TREE_HEAD}'
                    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
                    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>'
                    f'<p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>',
                    "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml")
        show = ' show="0"' if s.get("hidden") else ""
        pkg.add(f"ppt/slides/slide{n}.xml", HEAD + f'<p:sld {XMLNS}{show}><p:cSld>{sw.background(s.get("bg"))}<p:spTree>{SP_TREE_HEAD}{shapes}</p:spTree></p:cSld>'
                '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
                "application/vnd.openxmlformats-officedocument.presentationml.slide+xml")
        pkg.add(f"ppt/slides/_rels/slide{n}.xml.rels", sw.rels.xml())
        slide_ids.append(pres_rels.add("slide", f"slides/slide{n}.xml"))
    theme_rid = pres_rels.add("theme", "theme/theme1.xml")
    pres_rels.add("presProps", "presProps.xml")
    pres_rels.add("viewProps", "viewProps.xml")
    pres_rels.add("tableStyles", "tableStyles.xml")
    del theme_rid
    pkg.add("ppt/_rels/presentation.xml.rels", pres_rels.xml())
    sld_ids = "".join(f'<p:sldId id="{256 + i}" r:id="{rid}"/>' for i, rid in enumerate(slide_ids))
    pkg.add("ppt/presentation.xml", HEAD + f'<p:presentation {XMLNS} saveSubsetFonts="1">'
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
            '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>'
            f'<p:sldIdLst>{sld_ids}</p:sldIdLst><p:sldSz cx="{cx}" cy="{cy}"/><p:notesSz cx="6858000" cy="9144000"/>'
            f'<p:defaultTextStyle>{text_styles()}</p:defaultTextStyle></p:presentation>',
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")
    pkg.add("ppt/presProps.xml", HEAD + f'<p:presentationPr {XMLNS}/>', "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml")
    pkg.add("ppt/viewProps.xml", HEAD + f'<p:viewPr {XMLNS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>'
            '<p:slideViewPr><p:cSldViewPr snapToGrid="0"><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr></p:viewPr>',
            "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml")
    pkg.add("ppt/tableStyles.xml", HEAD + f'<a:tblStyleLst xmlns:a="{NS_A}" def="{{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}}"/>',
            "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml")
    return pkg.write(), notes_out
