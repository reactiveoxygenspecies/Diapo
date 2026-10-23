"""PowerPoint charts (ppt/charts/chartN.xml) drawn as inline SVG for pptx_import.

Bar and column charts (clustered and stacked), line charts (with markers),
pie and doughnut charts (with data labels), area charts; the title, the
legend, category and value axes with gridlines. Series colours come from the
series' own fill when it has one, else from the theme's accent colours in
PowerPoint's order. Anything else (scatter, radar, surface, combo charts
beyond the first plot) returns None and the import notes it.
"""
import math
import xml.etree.ElementTree as ET

from pptx_import import NS, css_colour, css_px, esc, fill_css, first_colour, fnum, q

ACCENTS = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]


def _texts(node, path):
    """Values of c:pt/c:v under a c:cat or c:val (strRef / numRef / strLit / numLit)."""
    if node is None:
        return []
    out = {}
    for pt in node.iter(q("c:pt")):
        v = pt.find("c:v", NS)
        out[int(pt.get("idx", "0"))] = v.text if v is not None else ""
    n = node.find(".//c:ptCount", NS)
    count = int(n.get("val")) if n is not None else (max(out) + 1 if out else 0)
    return [out.get(i, "") for i in range(count)]


def _series(plot, theme):
    series = []
    for i, ser in enumerate(plot.findall("c:ser", NS)):
        name = "".join(t.text or "" for t in ser.findall("c:tx//c:v", NS)) or f"Series {i + 1}"
        cats = _texts(ser.find("c:cat", NS), None)
        vals = [fnum(v, 0.0) if v not in ("", None) else None for v in _texts(ser.find("c:val", NS), None)]
        sp = ser.find("c:spPr", NS)
        col, kind = fill_css(sp, theme) if sp is not None else (None, None)
        if not col or kind == "none":
            ln = sp.find("a:ln", NS) if sp is not None else None
            c = first_colour(ln.find("a:solidFill", NS), theme) if ln is not None else None
            col = css_colour(c) if c else None
        if not col:
            col = "#" + theme.scheme(ACCENTS[i % 6])
        points = {}
        for dpt in ser.findall("c:dPt", NS):
            idx = int(dpt.find("c:idx", NS).get("val"))
            pc, pk = fill_css(dpt.find("c:spPr", NS), theme)
            if pc and pk != "none":
                points[idx] = pc
        series.append({"name": name, "cats": cats, "vals": vals, "color": col, "points": points})
    return series


def _nice_max(v):
    if v <= 0:
        return 1.0
    mag = 10 ** math.floor(math.log10(v))
    for m in (1, 2, 2.5, 5, 10):
        if v <= m * mag:
            return m * mag
    return 10 * mag


def _fmt(v):
    if v is None:
        return ""
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return f"{v:.2f}".rstrip("0").rstrip(".")


_KINDS = {"lineChart": "line", "line3DChart": "line", "pieChart": "pie", "pie3DChart": "pie",
          "doughnutChart": "doughnut", "areaChart": "area", "area3DChart": "area"}


def _title(chart, series):
    t = chart.find("c:title", NS)
    deleted = chart.find("c:autoTitleDeleted", NS)
    if t is None or (deleted is not None and deleted.get("val") != "0"):
        return ""
    title = "".join(x.text or "" for x in t.iter(q("a:t"))).strip()
    return title or (series[0]["name"] if len(series) == 1 else "")


def _format_code(plot, plot_area):
    """The number format of the first series' values (the cache's), else of the value axis."""
    n = plot.find("c:ser/c:val//c:formatCode", NS)
    if n is not None and n.text and n.text != "General":
        return n.text
    n = plot_area.find("c:valAx/c:numFmt", NS)
    return (n.get("formatCode") or "") if n is not None else ""


def _plain(col):
    """A colour the editor can use as it is (a gradient or a picture fill is not one)."""
    return col if col and (col.startswith("#") or col.startswith("rgb")) else None


def chart_text(root, theme, pt):
    """The chart's text: its font family (the theme's minor font), size in css px and colour."""
    base_sz = root.find("c:txPr//a:defRPr", NS)
    fs = (fnum(base_sz.get("sz"), 1000) / 100.0 if base_sz is not None and base_sz.get("sz") else 10.0) * pt
    return theme.minor, fs, "#" + theme.scheme("tx1")


def chart_spec(root, theme):
    """The chart as the editor's table (see app/core/chart.js): (kind, spec) or None.

    kind is column / bar / line / area / pie / doughnut; spec holds the labels, the series with
    their colours, the palette (the theme's accents, and a pie's own slice colours), stacked,
    legend, values (data labels), the title and a unit read from the number format (a percent
    format's fractions become percentages; a currency sign is kept)."""
    chart = root.find("c:chart", NS)
    plot_area = chart.find("c:plotArea", NS) if chart is not None else None
    if plot_area is None:
        return None
    plots = [c for c in plot_area if c.tag.split("}")[-1].endswith("Chart")]
    if not plots:
        return None
    plot = plots[0]
    tag = plot.tag.split("}")[-1]
    if tag in ("barChart", "bar3DChart"):
        bar_dir = plot.find("c:barDir", NS)
        kind = "bar" if bar_dir is not None and bar_dir.get("val") == "bar" else "column"
    else:
        kind = _KINDS.get(tag)
    if not kind:
        return None
    series = _series(plot, theme)
    if not series:
        return None
    n = max(len(series[0]["cats"]), max(len(s["vals"]) for s in series))
    labels = [(series[0]["cats"][i] if i < len(series[0]["cats"]) else "") or str(i + 1) for i in range(n)]
    grouping = plot.find("c:grouping", NS)
    group = grouping.get("val") if grouping is not None else ""
    stacked = group in ("stacked", "percentStacked") and kind != "line"
    code = _format_code(plot, plot_area)
    unit, scale = "", 1.0
    if "%" in code:
        unit, scale = "%", 100.0
    else:
        for sign in ("$", "€", "£", "¥"):
            if sign in code:
                unit = sign
                break
    rows = [[(s["vals"][i] if i < len(s["vals"]) else None) for i in range(n)] for s in series]
    if group == "percentStacked":
        # Each column's share of its total, as PowerPoint draws it.
        for i in range(n):
            tot = sum(abs(r[i] or 0) for r in rows) or 1.0
            for r in rows:
                if r[i] is not None:
                    r[i] = r[i] / tot * 100.0
        unit, scale = "%", 1.0
    rows = [[None if v is None else round(v * scale, 6) for v in r] for r in rows]
    accents = ["#" + theme.scheme(a) for a in ACCENTS]
    pie = kind in ("pie", "doughnut")
    palette = [_plain(series[0]["points"].get(i)) or accents[i % 6] for i in range(n)] if pie else accents
    labels_on = [l for l in (plot.find("c:ser/c:dLbls", NS), plot.find("c:dLbls", NS)) if l is not None]

    def flag(name):
        for l in labels_on:
            el = l.find("c:" + name, NS)
            if el is not None:
                return el.get("val") == "1"
        return False
    spec = {
        "labels": labels,
        "series": [{"name": s["name"], "values": rows[i], **({"colour": _plain(s["color"])} if not pie and _plain(s["color"]) else {})} for i, s in enumerate(series)],
        "palette": palette,
        "legend": chart.find("c:legend", NS) is not None,
        # A pie's labels are its shares, which the editor always writes; the values go with them only
        # when PowerPoint shows values and not percentages.
        "values": (flag("showVal") and not flag("showPercent")) if pie else (flag("showVal") or flag("showPercent")),
        "grid": plot_area.find("c:valAx/c:majorGridlines", NS) is not None,
        "stacked": stacked,
    }
    # A pie whose values are its shares already (they add up to 100) says each once.
    if pie and spec["values"] and abs(sum(v or 0 for v in rows[0]) - 100) < 0.5:
        spec["values"] = False
    if unit:
        spec["unit"] = unit
    title = _title(chart, series)
    if title:
        spec["title"] = title
    return kind, spec


def chart_svg(root, theme, rels, w, h, pt):
    """The SVG (string) of a chart part, sized w x h css px, or None when the kind is not drawn."""
    chart = root.find("c:chart", NS)
    if chart is None:
        return None
    plot_area = chart.find("c:plotArea", NS)
    if plot_area is None:
        return None
    plots = [c for c in plot_area if c.tag.split("}")[-1].endswith("Chart")]
    if not plots:
        return None
    plot = plots[0]
    kind = plot.tag.split("}")[-1]
    if kind not in ("barChart", "bar3DChart", "lineChart", "line3DChart", "pieChart", "pie3DChart", "doughnutChart", "areaChart", "area3DChart"):
        return None
    series = _series(plot, theme)
    if not series:
        return None
    # text: the chart's own default size (c:txPr on the chart space), else PowerPoint's 10pt
    minor, fs, text_col = chart_text(root, theme, pt)
    font = f"font-family:'{minor}', sans-serif;" if minor else ""
    title = ""
    title_fs = fs * 1.2
    t = chart.find("c:title", NS)
    if t is not None and (chart.find("c:autoTitleDeleted", NS) is None or chart.find("c:autoTitleDeleted", NS).get("val") == "0"):
        title = "".join(x.text or "" for x in t.iter(q("a:t"))).strip()
        if not title and len(series) == 1:
            title = series[0]["name"]
        tsz = t.find(".//a:rPr", NS)
        if tsz is None or not tsz.get("sz"):
            tsz = t.find(".//a:defRPr", NS)
        if tsz is not None and tsz.get("sz"):
            title_fs = fnum(tsz.get("sz")) / 100.0 * pt
    legend = chart.find("c:legend", NS)
    legend_pos = legend.find("c:legendPos", NS).get("val", "r") if legend is not None and legend.find("c:legendPos", NS) is not None else ("r" if legend is not None else None)
    parts = []
    pad = 0.5 * fs
    top = pad
    if title:
        parts.append(f'<text x="{w / 2:.1f}" y="{top + title_fs:.1f}" text-anchor="middle" font-size="{title_fs:.1f}" fill="{text_col}">{esc(title)}</text>')
        top += title_fs * 1.8
    bottom = h - pad
    left, right = pad, w - pad
    # legend: a row at the bottom or a column at the right
    leg_items = [(s["name"], s["color"]) for s in series]
    if kind in ("pieChart", "pie3DChart", "doughnutChart"):
        leg_items = [(c, series[0]["points"].get(i) or "#" + theme.scheme(ACCENTS[i % 6])) for i, c in enumerate(series[0]["cats"])]
    if legend_pos and leg_items:
        if legend_pos in ("b", "t"):
            row_h = fs * 1.6
            widths = [fs * 1.4 + len(n) * fs * 0.55 + fs for n, _ in leg_items]
            x = (w - sum(widths)) / 2
            y = (bottom - row_h) if legend_pos == "b" else top
            for (n, c), wd in zip(leg_items, widths):
                parts.append(f'<rect x="{x:.1f}" y="{y + fs * 0.3:.1f}" width="{fs:.1f}" height="{fs:.1f}" fill="{c}"/>'
                             f'<text x="{x + fs * 1.4:.1f}" y="{y + fs * 1.15:.1f}" font-size="{fs:.1f}" fill="{text_col}">{esc(n)}</text>')
                x += wd
            if legend_pos == "b":
                bottom -= row_h + pad
            else:
                top += row_h + pad
        else:
            col_w = max(len(n) for n, _ in leg_items) * fs * 0.55 + fs * 2
            x = (right - col_w) if legend_pos in ("r", "tr") else left
            y = top + (bottom - top - len(leg_items) * fs * 1.5) / 2
            for n, c in leg_items:
                parts.append(f'<rect x="{x:.1f}" y="{y + fs * 0.25:.1f}" width="{fs:.1f}" height="{fs:.1f}" fill="{c}"/>'
                             f'<text x="{x + fs * 1.4:.1f}" y="{y + fs * 1.1:.1f}" font-size="{fs:.1f}" fill="{text_col}">{esc(n)}</text>')
                y += fs * 1.5
            if legend_pos in ("r", "tr"):
                right -= col_w + pad
            else:
                left += col_w + pad
    if kind in ("pieChart", "pie3DChart", "doughnutChart"):
        parts.append(_pie(series[0], theme, left, top, right, bottom, fs, text_col, kind == "doughnutChart", plot))
    else:
        parts.append(_axes_chart(kind, plot, series, left, top, right, bottom, fs, text_col))
    return (f'<svg viewBox="0 0 {w:.1f} {h:.1f}" width="100%" height="100%" style="{font} max-width:none; max-height:none; overflow:visible;">'
            + "".join(parts) + "</svg>")


def _pie(s, theme, left, top, right, bottom, fs, text_col, doughnut, plot):
    vals = [v or 0.0 for v in s["vals"]]
    total = sum(vals) or 1.0
    cx, cy = (left + right) / 2, (top + bottom) / 2
    r = min(right - left, bottom - top) / 2 * 0.9
    # data labels: the series' own settings first, the plot's as the fallback
    candidates = [l for l in (plot.find("c:ser/c:dLbls", NS), plot.find("c:dLbls", NS)) if l is not None]

    def flag(name):
        for l in candidates:
            el = l.find("c:" + name, NS)
            if el is not None:
                return el.get("val") == "1"
        return False
    show_pct, show_val = flag("showPercent"), flag("showVal")
    fmt = next((l.find("c:numFmt", NS) for l in candidates if l.find("c:numFmt", NS) is not None), None)
    suffix = "%" if fmt is not None and "%" in (fmt.get("formatCode") or "") else ""
    first = plot.find("c:firstSliceAng", NS)
    ang = math.radians(fnum(first.get("val")) if first is not None else 0) - math.pi / 2
    out = []
    for i, v in enumerate(vals):
        frac = v / total
        a2 = ang + frac * 2 * math.pi
        col = s["points"].get(i) or "#" + theme.scheme(ACCENTS[i % 6])
        large = 1 if frac > 0.5 else 0
        x1, y1 = cx + r * math.cos(ang), cy + r * math.sin(ang)
        x2, y2 = cx + r * math.cos(a2), cy + r * math.sin(a2)
        if frac >= 0.9999:
            out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{col}"/>')
        else:
            out.append(f'<path d="M{cx:.1f} {cy:.1f} L{x1:.1f} {y1:.1f} A{r:.1f} {r:.1f} 0 {large} 1 {x2:.1f} {y2:.1f}Z" fill="{col}" stroke="#fff" stroke-width="1"/>')
        if (show_pct or show_val) and frac > 0.03:
            mid = (ang + a2) / 2
            lx, ly = cx + r * 0.65 * math.cos(mid), cy + r * 0.65 * math.sin(mid)
            label = f"{frac * 100:.0f}%" if show_pct else _fmt(v) + suffix
            out.append(f'<text x="{lx:.1f}" y="{ly + fs * 0.35:.1f}" text-anchor="middle" font-size="{fs:.1f}" fill="#fff">{esc(label)}</text>')
        ang = a2
    if doughnut:
        hole = plot.find("c:holeSize", NS)
        hr = r * (fnum(hole.get("val"), 50) / 100.0 if hole is not None else 0.5)
        out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{hr:.1f}" fill="#fff"/>')
    return "".join(out)


def _axes_chart(kind, plot, series, left, top, right, bottom, fs, text_col):
    cats = series[0]["cats"] or [str(i + 1) for i in range(len(series[0]["vals"]))]
    n = max(len(cats), max(len(s["vals"]) for s in series))
    cats = cats + [""] * (n - len(cats))
    grouping = plot.find("c:grouping", NS)
    stacked = grouping is not None and grouping.get("val") in ("stacked", "percentStacked")
    percent = grouping is not None and grouping.get("val") == "percentStacked"
    bar_dir = plot.find("c:barDir", NS)
    horizontal = kind.startswith("bar") and bar_dir is not None and bar_dir.get("val") == "bar"
    # value range
    if stacked:
        tops = [sum((s["vals"][i] or 0) for s in series if i < len(s["vals"]) and (s["vals"][i] or 0) > 0) for i in range(n)]
        bots = [sum((s["vals"][i] or 0) for s in series if i < len(s["vals"]) and (s["vals"][i] or 0) < 0) for i in range(n)]
        vmax, vmin = max(tops + [0]), min(bots + [0])
        if percent:
            vmax, vmin = 100.0, 0.0
    else:
        allv = [v for s in series for v in s["vals"] if v is not None]
        vmax, vmin = max(allv + [0]), min(allv + [0])
    vmax = _nice_max(vmax) if vmax > 0 else 0
    vmin = -_nice_max(-vmin) if vmin < 0 else 0
    if vmax == vmin:
        vmax = vmin + 1
    ticks = 5
    # plot box: room for value labels on the left (or bottom when horizontal) and category labels
    lab_w = max(len(_fmt(v)) for v in (vmax, vmin)) * fs * 0.6 + fs
    if horizontal:
        cat_w = max(len(c) for c in cats) * fs * 0.55 + fs
        px0, px1 = left + cat_w, right - fs
        py0, py1 = top + fs * 0.5, bottom - fs * 1.8
    else:
        px0, px1 = left + lab_w, right - fs * 0.5
        py0, py1 = top + fs * 0.5, bottom - fs * 1.8
    out = []
    span = vmax - vmin

    def vy(v):
        return py1 - (v - vmin) / span * (py1 - py0)

    def vx(v):
        return px0 + (v - vmin) / span * (px1 - px0)
    # gridlines and value labels
    for i in range(ticks + 1):
        v = vmin + span * i / ticks
        if horizontal:
            x = vx(v)
            out.append(f'<line x1="{x:.1f}" y1="{py0:.1f}" x2="{x:.1f}" y2="{py1:.1f}" stroke="#c8c8c8" stroke-width="1"/>')
            out.append(f'<text x="{x:.1f}" y="{py1 + fs * 1.2:.1f}" text-anchor="middle" font-size="{fs:.1f}" fill="{text_col}">{esc(_fmt(v) + ("%" if percent else ""))}</text>')
        else:
            y = vy(v)
            out.append(f'<line x1="{px0:.1f}" y1="{y:.1f}" x2="{px1:.1f}" y2="{y:.1f}" stroke="#c8c8c8" stroke-width="1"/>')
            out.append(f'<text x="{px0 - fs * 0.4:.1f}" y="{y + fs * 0.35:.1f}" text-anchor="end" font-size="{fs:.1f}" fill="{text_col}">{esc(_fmt(v) + ("%" if percent else ""))}</text>')
    # category labels
    for i, c in enumerate(cats):
        if horizontal:
            y = py0 + (i + 0.5) / n * (py1 - py0)
            out.append(f'<text x="{px0 - fs * 0.4:.1f}" y="{y + fs * 0.35:.1f}" text-anchor="end" font-size="{fs:.1f}" fill="{text_col}">{esc(c)}</text>')
        else:
            x = px0 + (i + 0.5) / n * (px1 - px0)
            out.append(f'<text x="{x:.1f}" y="{py1 + fs * 1.2:.1f}" text-anchor="middle" font-size="{fs:.1f}" fill="{text_col}">{esc(c)}</text>')
    zero = vy(0) if not horizontal else vx(0)
    if kind.startswith("bar"):
        groups = 1 if stacked else len(series)
        slot = (px1 - px0) / n if not horizontal else (py1 - py0) / n
        gap = slot * 0.2
        bw = (slot - gap) / groups
        acc_pos = [0.0] * n
        acc_neg = [0.0] * n
        for si, s in enumerate(series):
            for i in range(n):
                v = s["vals"][i] if i < len(s["vals"]) else None
                if v is None:
                    continue
                if percent:
                    tot = sum(abs(t["vals"][i] or 0) for t in series if i < len(t["vals"])) or 1
                    v = v / tot * 100
                if stacked:
                    base = acc_pos[i] if v >= 0 else acc_neg[i]
                    v0, v1 = base, base + v
                    if v >= 0:
                        acc_pos[i] = v1
                    else:
                        acc_neg[i] = v1
                    off = 0
                else:
                    v0, v1 = 0, v
                    off = si * bw
                col = s["points"].get(i) or s["color"]
                if horizontal:
                    y = py0 + i * slot + gap / 2 + off
                    x_a, x_b = vx(min(v0, v1)), vx(max(v0, v1))
                    out.append(f'<rect x="{x_a:.1f}" y="{y:.1f}" width="{max(0.5, x_b - x_a):.1f}" height="{bw:.1f}" fill="{col}"/>')
                else:
                    x = px0 + i * slot + gap / 2 + off
                    y_a, y_b = vy(max(v0, v1)), vy(min(v0, v1))
                    out.append(f'<rect x="{x:.1f}" y="{y_a:.1f}" width="{bw:.1f}" height="{max(0.5, y_b - y_a):.1f}" fill="{col}"/>')
    elif kind.startswith("line"):
        marker = plot.find("c:marker", NS)
        show_marker = marker is None or marker.get("val") != "0"
        for s in series:
            pts = []
            for i in range(n):
                v = s["vals"][i] if i < len(s["vals"]) else None
                if v is None:
                    continue
                pts.append((px0 + (i + 0.5) / n * (px1 - px0), vy(v)))
            if len(pts) > 1:
                out.append(f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="none" stroke="{s["color"]}" stroke-width="{max(1.5, fs * 0.2):.1f}" stroke-linejoin="round"/>')
            if show_marker:
                for x, y in pts:
                    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{fs * 0.3:.1f}" fill="{s["color"]}"/>')
    elif kind.startswith("area"):
        acc = [0.0] * n
        for s in series:
            pts, base = [], []
            for i in range(n):
                v = s["vals"][i] if i < len(s["vals"]) else None
                if v is None:
                    v = 0.0
                x = px0 + (i + 0.5) / n * (px1 - px0)
                b = acc[i] if stacked else 0.0
                pts.append((x, vy(b + v)))
                base.append((x, vy(b)))
                if stacked:
                    acc[i] = b + v
            poly = pts + base[::-1]
            out.append(f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in poly)}" fill="{s["color"]}" fill-opacity="0.8"/>')
    # axes
    if horizontal:
        out.append(f'<line x1="{zero:.1f}" y1="{py0:.1f}" x2="{zero:.1f}" y2="{py1:.1f}" stroke="#888" stroke-width="1"/>')
    else:
        out.append(f'<line x1="{px0:.1f}" y1="{zero:.1f}" x2="{px1:.1f}" y2="{zero:.1f}" stroke="#888" stroke-width="1"/>')
    return "".join(out)
