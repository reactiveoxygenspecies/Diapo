"""The editor's charts as native PowerPoint charts (the reverse of pptx_chart.py).

chart_part(item) gives the chart part's XML (c:chartSpace) and a small
embedded workbook holding the same table, so PowerPoint's Edit Data opens
it in Excel. Kinds: column, bar, line, area, pie, doughnut, scatter; stacked,
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


def marker_xml(s, colour, line_w, point_size):
    """A series' points: the editor's line is stage px wide, its points three lines across unless
    sized; a marker's size is in points."""
    shape = s.get("marker") or "circle"
    hollow = shape.endswith("-open")
    symbol = SYMBOLS.get(shape.replace("-open", ""), "circle")
    pt = point_size if point_size is not None else line_w * 3
    msize = max(2, min(72, int(round(pt * 0.5))))
    mfill = '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' if hollow else f'<a:solidFill><a:srgbClr val="{colour}"/></a:solidFill>'
    mline = f'<a:ln w="{emu(max(1, line_w * 0.6))}"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill></a:ln>' if hollow else "<a:ln><a:noFill/></a:ln>"
    if symbol == "none" or not pt:
        return '<c:marker><c:symbol val="none"/></c:marker>'
    return f'<c:marker><c:symbol val="{symbol}"/><c:size val="{msize}"/><c:spPr>{mfill}{mline}</c:spPr></c:marker>'


def parse_x(v):
    """A scatter's X written as text (a label): "2", "0.5", "0,5", "1e-3"; None when it is not a number."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v) if v == v and abs(v) != float("inf") else None
    t = str(v if v is not None else "").strip().replace("−", "-").replace(" ", "")
    if not t:
        return None
    if "," in t and "." not in t and t.count(",") == 1:
        t = t.replace(",", ".")
    try:
        f = float(t.replace(",", ""))
    except ValueError:
        return None
    return f if f == f and abs(f) != float("inf") else None


def scatter_x(labels):
    """X as the editor draws it: the labels as numbers, or 1, 2, 3... when they are not all numbers."""
    xs = [parse_x(l) for l in labels]
    if all(x is not None or not str(l).strip() for x, l in zip(xs, labels)):
        return xs
    return [float(i + 1) for i in range(len(labels))]


def err_bars(errors, values, n, outward, caps, colour, width, direction=None):
    """A series' error bars, sizes given point by point: both ways, or only away from zero
    (plus for a positive value, minus for a negative one), as the editor draws them. A scatter
    says which way they go (y: up and down)."""
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
    err_dir = f'<c:errDir val="{direction}"/>' if direction else ""
    return (f'<c:errBars>{err_dir}<c:errBarType val="both"/><c:errValType val="cust"/><c:noEndCap val="{0 if caps else 1}"/>'
            f'<c:plus>{lit(plus)}</c:plus><c:minus>{lit(minus)}</c:minus>'
            f'<c:spPr><a:ln w="{width}"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill></a:ln></c:spPr></c:errBars>')


def workbook(labels, series, xs=None):
    """A minimal .xlsx: column A the labels (a scatter's X, as numbers), then one column per
    series, names in row 1."""
    rows = []
    head = '<c r="A1" t="inlineStr"><is><t></t></is></c>' + "".join(
        f'<c r="{col_name(j + 1)}1" t="inlineStr"><is><t>{x(s.get("name") or "")}</t></is></c>' for j, s in enumerate(series))
    rows.append(f'<row r="1">{head}</row>')
    for i, label in enumerate(labels):
        r = i + 2
        xv = xs[i] if xs is not None and i < len(xs) else None
        if xs is not None:
            cells = f'<c r="A{r}"><v>{xv:.15g}</v></c>' if xv is not None else ""
        else:
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


def scaling_xml(axis):
    """An axis' c:scaling: log base 10, then max before min (the schema's order)."""
    log = bool(axis.get("log"))
    out = ('<c:logBase val="10"/>' if log else "") + '<c:orientation val="minMax"/>'
    for key in ("max", "min"):
        v = num(axis.get(key))
        if v is not None and (not log or v > 0):
            out += f'<c:{key} val="{v:g}"/>'
    return out


def scatter_part(it):
    """A scatter (XY) chart: c:scatterChart with two value axes. X is the labels as numbers (or
    1, 2, 3... as the editor draws them), each series' points joined or not, its Y error bars and
    its trend line, of the kind that is straight on the axes the editor draws it on (a power law
    on log-log, an exponential on a log Y, a logarithm on a log X) with R² shown, as in the legend."""
    labels = [str(l) for l in (it.get("labels") or [])]
    series = [s for s in (it.get("series") or []) if isinstance(s, dict)]
    n = len(labels)
    last = n + 1
    xs_in = it.get("xValues")
    xs = [num(v) for v in xs_in] if isinstance(xs_in, list) and len(xs_in) == n else scatter_x(labels)
    text = it.get("text") or {}
    decimals = it.get("decimals") if isinstance(it.get("decimals"), int) else None
    fmt_y, fmt_x = number_format(it.get("unit"), decimals), number_format("", decimals)
    va, la = it.get("valueAxis") or {}, it.get("labelAxis") or {}
    size = float(text.get("size") or 24)
    line_w = it.get("lineWidth") or max(3.0, size / 7)
    ink = hexcol(text.get("color"), 0) if text.get("color") else "404040"
    axis_w = emu(it.get("axisWidth") or max(1.5, size / 14))
    lines = bool(it.get("lines"))
    xlog, ylog = bool(la.get("log")), bool(va.get("log"))
    trend_type = "power" if xlog and ylog else "exp" if ylog else "log" if xlog else "linear"

    def cache(vals):
        return "".join(f'<c:pt idx="{i}"><c:v>{v:.15g}</c:v></c:pt>' for i, v in enumerate(vals) if v is not None)

    sers = ""
    for j, s in enumerate(series):
        colour = hexcol(s.get("color"), j)
        col = col_name(j + 1)
        vals = list(s.get("values") or [])
        ys = [num(vals[i]) if i < len(vals) and xs[i] is not None else None for i in range(n)]
        dash = f'<a:prstDash val="{DASHES[s["dash"]]}"/>' if s.get("dash") in DASHES else ""
        ln = (f'<a:ln w="{emu(line_w)}" cap="rnd"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill>{dash}<a:round/></a:ln>' if lines
              else '<a:ln w="19050" cap="rnd"><a:noFill/></a:ln>')
        out = (f'<c:ser><c:idx val="{j}"/><c:order val="{j}"/>'
               f'<c:tx><c:strRef><c:f>Sheet1!${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>{x(s.get("name") or "")}</c:v></c:pt></c:strCache></c:strRef></c:tx>'
               f'<c:spPr>{ln}</c:spPr>')
        # Points without lines always show (the editor draws a circle for "none" then).
        marker_s = s if lines or (s.get("marker") or "circle") != "none" else {**s, "marker": "circle"}
        out += marker_xml(marker_s, colour, line_w, it.get("pointSize"))
        if it.get("values"):
            out += (f'<c:dLbls><c:numFmt formatCode="{x(fmt_y)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{text_props(text, size * 0.8)}<c:dLblPos val="t"/>'
                    '<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>')
        if s.get("trend"):
            out += (f'<c:trendline><c:spPr><a:ln w="{emu(max(1.5, line_w * 0.6))}" cap="rnd"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>'
                    f'<c:trendlineType val="{trend_type}"/><c:dispRSqr val="1"/><c:dispEq val="0"/></c:trendline>')
        if isinstance(s.get("errors"), list):
            out += err_bars(s["errors"], vals, n, it.get("errorDir") == "out", it.get("errorCaps") is not False, colour, axis_w, "y")
        out += (f'<c:xVal><c:numRef><c:f>Sheet1!$A$2:$A${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="{n}"/>{cache(xs)}</c:numCache></c:numRef></c:xVal>'
                f'<c:yVal><c:numRef><c:f>Sheet1!${col}$2:${col}${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="{n}"/>{cache(ys)}</c:numCache></c:numRef></c:yVal>'
                f'<c:smooth val="{1 if lines and it.get("smooth") else 0}"/></c:ser>')
        sers += out
    plot = (f'<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>{sers}'
            '<c:axId val="111111111"/><c:axId val="222222222"/></c:scatterChart>')
    grid = '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' if it.get("grid") else ""
    solid = f'<c:spPr><a:ln w="{axis_w}"><a:solidFill><a:srgbClr val="{ink}"/></a:solidFill></a:ln></c:spPr>'
    ticks = {"out": "out", "in": "in"}.get(it.get("ticks"), "none")
    # Where each axis crosses the other (a place on the other one): the X axis at a Y, the Y axis
    # at an X; by default at the edge, the minimum, where the editor draws them.
    cy = num(la.get("at"))
    x_cross = f'<c:crossesAt val="{cy:g}"/>' if cy is not None and (not ylog or cy > 0) else '<c:crosses val="min"/>'
    cx = parse_x(va.get("at")) if va.get("at") not in (None, "") else None
    y_cross = f'<c:crossesAt val="{cx:g}"/>' if cx is not None and (not xlog or cx > 0) else '<c:crosses val="min"/>'

    def axis(ax_id, cross_id, pos, a, fmt, title, cross, line_on):
        step = num(a.get("step"))
        major = f'<c:majorUnit val="{step:g}"/>' if step and step > 0 and not a.get("log") else ""
        # An axis without its line has none (the grid shows the plot), so the import reads it back alike.
        line = solid if line_on else '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'
        return (f'<c:valAx><c:axId val="{ax_id}"/><c:scaling>{scaling_xml(a)}</c:scaling><c:delete val="0"/><c:axPos val="{pos}"/>{grid}{title}'
                f'<c:numFmt formatCode="{x(fmt)}" sourceLinked="0"/><c:majorTickMark val="{ticks}"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
                f'{line}{text_props(text)}<c:crossAx val="{cross_id}"/>{cross}<c:crossBetween val="midCat"/>{major}</c:valAx>')
    x_title = rich_title(la["title"], text, size * 0.95) if la.get("title") else ""
    y_title = rich_title(va["title"], text, size * 0.95, -5400000) if va.get("title") else ""
    axes = (axis(111111111, 222222222, "b", la, fmt_x, x_title, x_cross, la.get("line"))
            + axis(222222222, 111111111, "l", va, fmt_y, y_title, y_cross, va.get("line")))
    return frame(it, plot, axes, text), workbook(labels, series, xs)


def frame(it, plot, axes, text):
    """The chart space round a plot and its axes: the title, the legend, the text."""
    size = float(text.get("size") or 24)
    if it.get("title"):
        title = rich_title(it["title"], text, size * 1.25) + '<c:autoTitleDeleted val="0"/>'
    else:
        title = '<c:autoTitleDeleted val="1"/>'
    # Where the editor draws it: at the top, unless the chart says where.
    pos = {"top": "t", "bottom": "b", "right": "r"}.get(it.get("legendPos") or "", "t")
    legend = f'<c:legend><c:legendPos val="{pos}"/><c:overlay val="0"/>{text_props(text)}</c:legend>' if it.get("legend") else ""
    return (HEAD + f'<c:chartSpace xmlns:c="{NS_C}" xmlns:a="{NS_A}" xmlns:r="{NS_R}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>'
            f'<c:chart>{title}<c:plotArea><c:layout/>{plot}{axes}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>{legend}'
            '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
            f'<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{text_props(text)}'
            '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>')


def chart_part(it):
    kind = it.get("kind_chart") or it.get("chart") or "column"
    if kind == "scatter":
        return scatter_part(it)
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
            marker = marker_xml(s, colour, line_w, it.get("pointSize"))
            out +=f'<c:spPr><a:ln w="{emu(line_w)}" cap="rnd"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill>{dash}<a:round/></a:ln></c:spPr>{marker}' 
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
        # Where each axis crosses the other: an axis' crosses is a place on the other one. The value
        # axis through a label's point (on the tick marks, for a line or an area, as the editor draws
        # it), the label axis at a value.
        at = va.get("at")
        cross_j = labels.index(at) if isinstance(at, str) and at and at in labels else -1
        val_cross = f'<c:crossesAt val="{cross_j + 1}"/>' if cross_j >= 0 else f'<c:crosses val="{"max" if kind == "bar" else "autoZero"}"/>'
        between = "midCat" if cross_j >= 0 and kind in ("line", "area") else "between"
        cv = num(la.get("at"))
        cat_cross = f'<c:crossesAt val="{cv:g}"/>' if cv is not None and (not log or cv > 0) else '<c:crosses val="autoZero"/>'
        # Bars would cover numbers and names that went with their axis: they stay at the edge ("low" is
        # the start of the other axis, which a bar chart turns upside down).
        bars = kind in ("column", "bar")
        cat_lbl = "low" if bars and "crossesAt" in cat_cross else "nextTo"
        val_lbl = ("high" if kind == "bar" else "low") if bars and cross_j >= 0 else "nextTo"
        axes = (f'<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="{"maxMin" if kind == "bar" else "minMax"}"/></c:scaling><c:delete val="0"/>'
                f'<c:axPos val="{cat_pos}"/>{cat_title}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="{ticks}"/><c:minorTickMark val="none"/><c:tickLblPos val="{cat_lbl}"/>'
                f'{cat_line}{text_props(text, rot=-angle * 60000 if angle else None)}<c:crossAx val="222222222"/>{cat_cross}<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
                f'<c:valAx><c:axId val="222222222"/><c:scaling>{scaling}</c:scaling><c:delete val="0"/><c:axPos val="{val_pos}"/>{grid}{val_title}'
                f'<c:numFmt formatCode="{x(fmt)}" sourceLinked="0"/><c:majorTickMark val="{ticks}"/><c:minorTickMark val="none"/><c:tickLblPos val="{val_lbl}"/>'
                f'{val_line}{text_props(text)}<c:crossAx val="111111111"/>{val_cross}<c:crossBetween val="{between}"/>{major}</c:valAx>')
    return frame(it, plot, axes, text), workbook(labels, series)
