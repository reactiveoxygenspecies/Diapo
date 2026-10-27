"""The editor's charts as native PowerPoint charts (the reverse of pptx_chart.py).

chart_part(item) gives the chart part's XML (c:chartSpace) and a small
embedded workbook holding the same table, so PowerPoint's Edit Data opens
it in Excel. Kinds: column, bar, line, area, pie, doughnut; stacked,
legend (and where), values on the chart, grid lines, a title, a unit and
decimals carried over, and the look: axis lines, titles, range, step and
log scale, tick marks, turned labels, line width, points, dashes,
smoothing and bar width.
Lengths are stage px (0.5 pt each), colours are hex.
"""
import io
import zipfile
from xml.sax.saxutils import escape

NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
FALLBACK = ["2F6FED", "F59E0B", "10B981", "E8503F", "8B5CF6", "06B6D4", "EC4899", "84CC16"]


def x(s):
    return escape(str(s if s is not None else ""), {'"': "&quot;"})


def hexcol(c, i=0):
    c = (c or "").strip().lstrip("#")
    if len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c):
        return c.upper()
    return FALLBACK[i % len(FALLBACK)]


def col_name(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def number_format(unit, decimals=None):
    """An Excel number format that writes the unit with each number ($ before, the rest after),
    with the decimals the chart fixes (General when it does not)."""
    u = (unit or "").replace('"', "")
    body = "General" if decimals is None else "#,##0" + ("." + "0" * int(decimals) if decimals else "")
    if not u.strip():
        return body
    if u.strip() in ("$", "€", "£", "¥"):
        return f'"{u.strip()}"{body}'
    return f'{body}"{u}"'                       # General: no trailing "." on whole numbers, as #,##0.## gives


def text_props(text, size_px=None, bold=False, rot=None):
    t = text or {}
    sz = int(round(float(size_px or t.get("size") or 24) * 50))
    font = t.get("font")
    latin = f'<a:latin typeface="{x(font)}"/>' if font else ""
    body = f'<a:bodyPr rot="{int(rot)}" vert="horz"/>' if rot else "<a:bodyPr/>"
    return (f'<c:txPr>{body}<a:lstStyle/><a:p><a:pPr><a:defRPr sz="{sz}" b="{1 if bold else 0}">'
            f'<a:solidFill><a:srgbClr val="{hexcol(t.get("color"), 0) if t.get("color") else "404040"}"/></a:solidFill>{latin}</a:defRPr></a:pPr>'
            '<a:endParaRPr lang="en-US"/></a:p></c:txPr>')


def rich_title(words, text, size_px, rot=None):
    """A chart or axis title: the words in the chart's font and colour, bold, turned rot (60000ths of a degree)."""
    t = text or {}
    sz = int(size_px * 50)
    body = f'<a:bodyPr rot="{int(rot)}" vert="horz"/>' if rot else "<a:bodyPr/>"
    return (f'<c:title><c:tx><c:rich>{body}<a:lstStyle/><a:p><a:pPr><a:defRPr sz="{sz}" b="1"/></a:pPr>'
            f'<a:r><a:rPr lang="en-US" sz="{sz}" b="1"><a:solidFill><a:srgbClr val="{hexcol(t.get("color"), 0) if t.get("color") else "404040"}"/></a:solidFill>'
            + (f'<a:latin typeface="{x(t["font"])}"/>' if t.get("font") else "")
            + f'</a:rPr><a:t>{x(words)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>')


def emu(px):
    """Stage px (0.5 pt) as EMU."""
    return int(round(float(px) * 6350))


SYMBOLS = {"circle": "circle", "square": "square", "triangle": "triangle", "diamond": "diamond", "none": "none"}
DASHES = {"dash": "dash", "dot": "sysDot"}


def err_bars(errors, values, n, outward, caps, colour, width):
    """A series' error bars, sizes given point by point: both ways, or only away from zero
    (plus for a positive value, minus for a negative one), as the editor draws them."""
    plus, minus = [], []
    for i in range(n):
        e = num(errors[i]) if i < len(errors) else None
        v = num(values[i]) if i < len(values) else None
        e = abs(e) if e is not None else 0
        plus.append(e if not outward or (v or 0) >= 0 else 0)
        minus.append(e if not outward or (v or 0) < 0 else 0)

    def lit(vals):
        pts = "".join(f'<c:pt idx="{i}"><c:v>{v:g}</c:v></c:pt>' for i, v in enumerate(vals))
        return f'<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="{n}"/>{pts}</c:numLit>'
    return (f'<c:errBars><c:errBarType val="both"/><c:errValType val="cust"/><c:noEndCap val="{0 if caps else 1}"/>'
            f'<c:plus>{lit(plus)}</c:plus><c:minus>{lit(minus)}</c:minus>'
            f'<c:spPr><a:ln w="{width}"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill></a:ln></c:spPr></c:errBars>')


def workbook(labels, series):
    """A minimal .xlsx: column A the labels, then one column per series, names in row 1."""
    rows = []
    head = '<c r="A1" t="inlineStr"><is><t></t></is></c>' + "".join(
        f'<c r="{col_name(j + 1)}1" t="inlineStr"><is><t>{x(s.get("name") or "")}</t></is></c>' for j, s in enumerate(series))
    rows.append(f'<row r="1">{head}</row>')
    for i, label in enumerate(labels):
        r = i + 2
        cells = f'<c r="A{r}" t="inlineStr"><is><t>{x(label)}</t></is></c>'
        for j, s in enumerate(series):
            v = num((s.get("values") or [None] * len(labels))[i] if i < len(s.get("values") or []) else None)
            if v is not None:
                cells += f'<c r="{col_name(j + 1)}{r}"><v>{repr(v) if v != int(v) else int(v)}</v></c>'
        rows.append(f'<row r="{r}">{cells}</row>')
    sheet = (HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             f'<sheetData>{"".join(rows)}</sheetData></worksheet>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr("_rels/.rels", HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   f'xmlns:r="{NS_R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def chart_part(it):
    kind = it.get("kind_chart") or it.get("chart") or "column"
    labels = [str(l) for l in (it.get("labels") or [])]
    series = [s for s in (it.get("series") or []) if isinstance(s, dict)]
    pie = kind in ("pie", "doughnut")
    if pie:
        series = series[:1]
    n = len(labels)
    last = n + 1
    text = it.get("text") or {}
    decimals = it.get("decimals")
    fmt = number_format(it.get("unit"), decimals if isinstance(decimals, int) else None)
    va = it.get("valueAxis") or {}
    la = it.get("labelAxis") or {}
    size = float(text.get("size") or 24)
    line_w = it.get("lineWidth") or max(3.0, size / 7)
    ink = hexcol(text.get("color"), 0) if text.get("color") else "404040"

    def ser_xml(j, s):
        colour = hexcol(s.get("color"), j)
        col = col_name(j + 1)
        vals = list(s.get("values") or [])
        pts = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in ((i, num(vals[i]) if i < len(vals) else None) for i in range(n)) if v is not None)
        cats = "".join(f'<c:pt idx="{i}"><c:v>{x(l)}</c:v></c:pt>' for i, l in enumerate(labels))
        out = (f'<c:ser><c:idx val="{j}"/><c:order val="{j}"/>'
               f'<c:tx><c:strRef><c:f>Sheet1!${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>{x(s.get("name") or "")}</c:v></c:pt></c:strCache></c:strRef></c:tx>')
        if kind == "line":
            # The editor's line is stage px wide, its points three lines across unless sized; a marker's size is in points.
            dash = f'<a:prstDash val="{DASHES[s["dash"]]}"/>' if s.get("dash") in DASHES else ""
            shape = s.get("marker") or "circle"
            hollow = shape.endswith("-open")
            symbol = SYMBOLS.get(shape.replace("-open", ""), "circle")
            pt = it.get("pointSize") if it.get("pointSize") is not None else line_w * 3
            msize = max(2, min(72, int(round(pt * 0.5))))
            mfill = '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' if hollow else f'<a:solidFill><a:srgbClr val="{colour}"/></a:solidFill>'
            mline = f'<a:ln w="{emu(max(1, line_w * 0.6))}"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill></a:ln>' if hollow else "<a:ln><a:noFill/></a:ln>"
            marker = ('<c:marker><c:symbol val="none"/></c:marker>' if symbol == "none" or not pt
                      else f'<c:marker><c:symbol val="{symbol}"/><c:size val="{msize}"/><c:spPr>{mfill}{mline}</c:spPr></c:marker>')
            out += f'<c:spPr><a:ln w="{emu(line_w)}" cap="rnd"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill>{dash}<a:round/></a:ln></c:spPr>{marker}' 
        elif pie:
            out += '<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>'
            palette = it.get("palette") or []
            for i in range(n):
                out += (f'<c:dPt><c:idx val="{i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="{hexcol(palette[i] if i < len(palette) else None, i)}"/></a:solidFill>'
                        '<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>')
        else:
            out += f'<c:spPr><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>'
            if kind in ("column", "bar"):
                out += '<c:invertIfNegative val="0"/>'
        if it.get("values"):
            pos = "" if kind in ("area",) or (kind in ("column", "bar") and it.get("stacked")) else ('<c:dLblPos val="outEnd"/>' if kind in ("column", "bar") else ('<c:dLblPos val="t"/>' if kind == "line" else '<c:dLblPos val="ctr"/>' if pie and kind == "pie" else ""))
            out += (f'<c:dLbls><c:numFmt formatCode="{x(fmt)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{text_props(text, (text.get("size") or 24) * 0.8)}{pos}'
                    f'<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>')
        if not pie and isinstance(s.get("errors"), list):
            out += err_bars(s["errors"], vals, n, it.get("errorDir") == "out", it.get("errorCaps") is not False,
                            colour if kind in ("line", "area") else ink, emu(it.get("axisWidth") or max(1.5, size / 14)))
        out += (f'<c:cat><c:strRef><c:f>Sheet1!$A$2:$A${last}</c:f><c:strCache><c:ptCount val="{n}"/>{cats}</c:strCache></c:strRef></c:cat>'
                f'<c:val><c:numRef><c:f>Sheet1!${col}$2:${col}${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="{n}"/>{pts}</c:numCache></c:numRef></c:val>')
        if kind == "line":
            out += f'<c:smooth val="{1 if it.get("smooth") else 0}"/>'
        return out + "</c:ser>"

    sers = "".join(ser_xml(j, s) for j, s in enumerate(series))
    axes_ids = '<c:axId val="111111111"/><c:axId val="222222222"/>'
    stacked = bool(it.get("stacked")) and kind in ("column", "bar", "area")
    if kind in ("column", "bar"):
        # A bar width is the share of its slot a bar (or a group) fills; the gap is the rest, in percent of a bar.
        frac = (it.get("barWidth") or 62) / 100.0
        gap = max(0, min(500, int(round((1 - frac) / frac * 100)))) if it.get("barWidth") else 80
        grouping = "stacked" if stacked else "clustered"
        overlap = '<c:overlap val="100"/>' if stacked else ""
        plot = (f'<c:barChart><c:barDir val="{"bar" if kind == "bar" else "col"}"/><c:grouping val="{grouping}"/><c:varyColors val="0"/>{sers}'
                f'<c:gapWidth val="{gap}"/>{overlap}{axes_ids}</c:barChart>')
    elif kind == "line":
        plot = f'<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{sers}<c:marker val="1"/>{axes_ids}</c:lineChart>'
    elif kind == "area":
        plot = f'<c:areaChart><c:grouping val="{"stacked" if stacked else "standard"}"/><c:varyColors val="0"/>{sers}{axes_ids}</c:areaChart>'
    elif kind == "pie":
        plot = f'<c:pieChart><c:varyColors val="1"/>{sers}<c:firstSliceAng val="0"/></c:pieChart>'
    else:
        plot = f'<c:doughnutChart><c:varyColors val="1"/>{sers}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>'
    axes = ""
    if not pie:
        grid = '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' if it.get("grid") else ""
        cat_pos, val_pos = ("l", "b") if kind == "bar" else ("b", "l")
        solid =f'<c:spPr><a:ln w="{emu(it.get("axisWidth") or max(1.5, size / 14))}"><a:solidFill><a:srgbClr val="{ink}"/></a:solidFill></a:ln></c:spPr>'
        cat_line = solid if la.get("line") else '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>'
        val_line = solid if va.get("line") else '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'
        ticks = {"out": "out", "in": "in"}.get(it.get("ticks"), "none")
        up = -5400000                                       # a title up the side reads from the bottom
        cat_title = rich_title(la["title"], text, size * 0.95, up if kind == "bar" else None) if la.get("title") else ""
        val_title = rich_title(va["title"], text, size * 0.95, None if kind == "bar" else up) if va.get("title") else ""
        angle = la.get("angle") if kind != "bar" and la.get("angle") in (45, 90) else 0
        log = bool(va.get("log"))
        scaling = ('<c:logBase val="10"/>' if log else "") + '<c:orientation val="minMax"/>'
        for key in ("max", "min"):                          # the schema's order: max before min
            v = num(va.get(key))
            if v is not None and (not log or v > 0):
                scaling += f'<c:{key} val="{v:g}"/>'
        step = num(va.get("step"))
        major = f'<c:majorUnit val="{step:g}"/>' if step and step > 0 and not log else ""
        axes = (f'<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="{"maxMin" if kind == "bar" else "minMax"}"/></c:scaling><c:delete val="0"/>'
                f'<c:axPos val="{cat_pos}"/>{cat_title}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="{ticks}"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
                f'{cat_line}{text_props(text, rot=-angle * 60000 if angle else None)}<c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
                f'<c:valAx><c:axId val="222222222"/><c:scaling>{scaling}</c:scaling><c:delete val="0"/><c:axPos val="{val_pos}"/>{grid}{val_title}'
                f'<c:numFmt formatCode="{x(fmt)}" sourceLinked="0"/><c:majorTickMark val="{ticks}"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
                f'{val_line}{text_props(text)}<c:crossAx val="111111111"/><c:crosses val="{"max" if kind == "bar" else "autoZero"}"/><c:crossBetween val="between"/>{major}</c:valAx>')
    title = ""
    if it.get("title"):
        title = rich_title(it["title"], text, size * 1.25) + '<c:autoTitleDeleted val="0"/>'
    else:
        title = '<c:autoTitleDeleted val="1"/>'
    # Where the editor draws it: at the top, unless the chart says where.
    pos = {"top": "t", "bottom": "b", "right": "r"}.get(it.get("legendPos") or "", "t")
    legend = f'<c:legend><c:legendPos val="{pos}"/><c:overlay val="0"/>{text_props(text)}</c:legend>' if it.get("legend") else ""
    xml = (HEAD + f'<c:chartSpace xmlns:c="{NS_C}" xmlns:a="{NS_A}" xmlns:r="{NS_R}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>'
           f'<c:chart>{title}<c:plotArea><c:layout/>{plot}{axes}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>{legend}'
           '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
           f'<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{text_props(text)}'
           '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>')
    return xml, workbook(labels, series)
