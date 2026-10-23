"""The editor's charts as native PowerPoint charts (the reverse of pptx_chart.py).

chart_part(item) gives the chart part's XML (c:chartSpace) and a small
embedded workbook holding the same table, so PowerPoint's Edit Data opens
it in Excel. Kinds: column, bar, line, area, pie, doughnut; stacked,
legend, values on the chart, grid lines, a title and a unit carried over.
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


def number_format(unit):
    """An Excel number format that writes the unit with each number ($ before, the rest after)."""
    u = (unit or "").replace('"', "")
    if not u.strip():
        return "General"
    if u.strip() in ("$", "€", "£", "¥"):
        return f'"{u.strip()}"General'
    return f'General"{u}"'                      # General: no trailing "." on whole numbers, as #,##0.## gives


def text_props(text, size_px=None, bold=False):
    t = text or {}
    sz = int(round(float(size_px or t.get("size") or 24) * 50))
    font = t.get("font")
    latin = f'<a:latin typeface="{x(font)}"/>' if font else ""
    return (f'<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="{sz}" b="{1 if bold else 0}">'
            f'<a:solidFill><a:srgbClr val="{hexcol(t.get("color"), 0) if t.get("color") else "404040"}"/></a:solidFill>{latin}</a:defRPr></a:pPr>'
            '<a:endParaRPr lang="en-US"/></a:p></c:txPr>')


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
    fmt = number_format(it.get("unit"))

    def ser_xml(j, s):
        colour = hexcol(s.get("color"), j)
        col = col_name(j + 1)
        vals = list(s.get("values") or [])
        pts = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in ((i, num(vals[i]) if i < len(vals) else None) for i in range(n)) if v is not None)
        cats = "".join(f'<c:pt idx="{i}"><c:v>{x(l)}</c:v></c:pt>' for i, l in enumerate(labels))
        out = (f'<c:ser><c:idx val="{j}"/><c:order val="{j}"/>'
               f'<c:tx><c:strRef><c:f>Sheet1!${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>{x(s.get("name") or "")}</c:v></c:pt></c:strCache></c:strRef></c:tx>')
        if kind == "line":
            out += (f'<c:spPr><a:ln w="38100" cap="rnd"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill><a:round/></a:ln></c:spPr>'
                    f'<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>')
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
        out += (f'<c:cat><c:strRef><c:f>Sheet1!$A$2:$A${last}</c:f><c:strCache><c:ptCount val="{n}"/>{cats}</c:strCache></c:strRef></c:cat>'
                f'<c:val><c:numRef><c:f>Sheet1!${col}$2:${col}${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="{n}"/>{pts}</c:numCache></c:numRef></c:val>')
        if kind == "line":
            out += '<c:smooth val="0"/>'
        return out + "</c:ser>"

    sers = "".join(ser_xml(j, s) for j, s in enumerate(series))
    axes_ids = '<c:axId val="111111111"/><c:axId val="222222222"/>'
    stacked = bool(it.get("stacked")) and kind in ("column", "bar", "area")
    if kind in ("column", "bar"):
        grouping = "stacked" if stacked else "clustered"
        overlap = '<c:overlap val="100"/>' if stacked else ""
        plot = (f'<c:barChart><c:barDir val="{"bar" if kind == "bar" else "col"}"/><c:grouping val="{grouping}"/><c:varyColors val="0"/>{sers}'
                f'<c:gapWidth val="80"/>{overlap}{axes_ids}</c:barChart>')
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
        axis_line = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>'
        axes = (f'<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="{"maxMin" if kind == "bar" else "minMax"}"/></c:scaling><c:delete val="0"/>'
                f'<c:axPos val="{cat_pos}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
                f'{axis_line}{text_props(text)}<c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
                f'<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="{val_pos}"/>{grid}'
                f'<c:numFmt formatCode="{x(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
                f'<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>{text_props(text)}<c:crossAx val="111111111"/><c:crosses val="{"max" if kind == "bar" else "autoZero"}"/><c:crossBetween val="between"/></c:valAx>')
    title = ""
    if it.get("title"):
        size = (text.get("size") or 24) * 1.25
        title = (f'<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="{int(size * 50)}" b="1"/></a:pPr>'
                 f'<a:r><a:rPr lang="en-US" sz="{int(size * 50)}" b="1"><a:solidFill><a:srgbClr val="{hexcol(text.get("color"), 0) if text.get("color") else "404040"}"/></a:solidFill>'
                 + (f'<a:latin typeface="{x(text["font"])}"/>' if text.get("font") else "")
                 + f'</a:rPr><a:t>{x(it["title"])}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>')
    else:
        title = '<c:autoTitleDeleted val="1"/>'
    # At the top, where the editor draws it.
    legend = f'<c:legend><c:legendPos val="t"/><c:overlay val="0"/>{text_props(text)}</c:legend>' if it.get("legend") else ""
    xml = (HEAD + f'<c:chartSpace xmlns:c="{NS_C}" xmlns:a="{NS_A}" xmlns:r="{NS_R}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>'
           f'<c:chart>{title}<c:plotArea><c:layout/>{plot}{axes}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>{legend}'
           '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
           f'<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{text_props(text)}'
           '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>')
    return xml, workbook(labels, series)
