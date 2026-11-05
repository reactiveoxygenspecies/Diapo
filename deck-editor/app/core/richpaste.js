/* ============================================================
   richpaste.js - rich text from the clipboard, made safe for a deck.

   A paste into text being edited used to take only the clipboard's plain text, so colour,
   bold and links were lost. cleanPastedHtml() reads the clipboard's HTML (from Word, a web
   page, another text box here, an element copied on the canvas) and rebuilds it from a
   whitelist: <b> <i> <u> <s> <sub> <sup> <code> <a href> <br> and <span style="color;
   background-color">. Everything else is dropped or reduced to its text: classes, ids, fonts
   and sizes (Word's pt sizes included), Mso styles, layout and position styles, event
   handlers, scripts, images. Blocks (paragraphs, headings, list items, table rows) become
   lines, with the block's own colour and emphasis carried on its content.

   The result is built with DOM calls from parsed (inert) markup, never by string pasting, so
   nothing in the source can reach the output as an attribute or a tag.
   ============================================================ */

const DROP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'template', 'noscript', 'iframe', 'frame', 'object', 'embed', 'img', 'picture', 'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track', 'input', 'button', 'select', 'option', 'textarea', 'form', 'xml', 'o:p', 'base', 'applet', 'map', 'area']);
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'ul', 'caption']);
const NO_COLOUR = /^(windowtext|window|inherit|initial|unset|revert|currentcolor|transparent|auto|none|buttontext|canvas|canvastext)$/i;
const SAFE_COLOUR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%\/a-z-]+\)|[a-z]{3,24}|var\(--[\w-]+\))$/i;
const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;

/* A colour value that is safe to keep, or ''. */
function colourOf(v) {
    v = (v || '').trim();
    return v && !NO_COLOUR.test(v) && SAFE_COLOUR.test(v) && !/(expression|url|javascript)/i.test(v) ? v : '';
}
/* The same colour as the computer sees it, for comparing with the text it lands in. */
function normal(v, doc) {
    const t = doc.createElement('span'); t.style.color = v;
    return t.style.color;
}
/* Colours an element sets in its data-css (the panel's Code section), where it is plainly a
   colour: the editor keeps text colour there, and the clipboard copy of the element carries it. */
function cssColour(el, prop) {
    const css = el.getAttribute && el.getAttribute('data-css');
    if (!css) return '';
    const m = new RegExp('(?:^|[;{\\s])' + prop + '\\s*:\\s*([^;{}!]+)', 'i').exec(css);
    return m ? colourOf(m[1]) : '';
}

/* Clean HTML ready for insertHTML, or '' when nothing of value is left (the caller then pastes
   the plain text). `target` is the element the text goes into: colours equal to its own are not
   repeated on the pasted words. `doc` is the document the HTML will be inserted in. */
export function cleanPastedHtml(html, doc, target) {
    if (!html) return '';
    const src = new DOMParser().parseFromString(html, 'text/html');
    const root = src.body;
    if (!root) return '';
    const base = {
        color: target ? normal(doc.defaultView.getComputedStyle(target).color, doc) : '',
        bg: target ? normal(doc.defaultView.getComputedStyle(target).backgroundColor, doc) : '',
    };
    const out = src.createElement('div');
    const state = { lineStart: true, olCount: [] };
    const NODE_ELEMENT = 1, NODE_TEXT = 3;

    const newLine = (dst) => {
        if (state.lineStart) return;
        dst.appendChild(src.createElement('br'));
        state.lineStart = true;
    };
    const text = (dst, s, pre) => {
        if (pre) {
            s.split(/\r?\n/).forEach((line, i) => {
                if (i) { dst.appendChild(src.createElement('br')); state.lineStart = true; }
                if (line) { dst.appendChild(src.createTextNode(line)); state.lineStart = false; }
            });
            return;
        }
        s = s.replace(/[ \t\r\n\f]+/g, ' ');
        if (state.lineStart) s = s.replace(/^ /, '');
        if (!s) return;
        dst.appendChild(src.createTextNode(s));
        state.lineStart = false;
    };

    /* What an element says about the look of its text, from the whitelist only. */
    const looks = (el, tag) => {
        const st = el.style || {};
        const m = {};
        const wt = (st.fontWeight || '').toLowerCase();
        if (tag === 'b' || tag === 'strong' || wt === 'bold' || wt === 'bolder' || (+wt >= 600)) m.b = true;
        if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn' || tag === 'var' || /italic|oblique/.test(st.fontStyle || '')) m.i = true;
        const deco = (st.textDecorationLine || st.textDecoration || '').toLowerCase();
        if (tag === 'u' || tag === 'ins' || /underline/.test(deco)) m.u = true;
        if (tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(deco)) m.s = true;
        const va = (st.verticalAlign || '').toLowerCase();
        if (tag === 'sup' || va === 'super') m.sup = true;
        else if (tag === 'sub' || va === 'sub') m.sub = true;
        if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') m.code = true;
        let color = colourOf(st.color) || (tag === 'font' ? colourOf(el.getAttribute('color')) : '') || cssColour(el, 'color');
        let bg = colourOf(st.backgroundColor) || cssColour(el, 'background-color');
        if (tag === 'mark' && !bg) bg = '#ffe600';
        if (color && base.color && normal(color, doc) === base.color) color = '';
        if (bg && /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(normal(bg, doc))) bg = '';
        if (bg && base.bg && normal(bg, doc) === base.bg) bg = '';
        if (color) m.color = color;
        if (bg) m.bg = bg;
        if (tag === 'a') {
            const href = (el.getAttribute('href') || '').replace(/[\u0000-\u001f\u007f\s]+/g, '');
            if (href && SAFE_HREF.test(href)) m.href = href;
        }
        return m;
    };
    /* Wrappers for a set of looks, outermost first; returns the innermost element to fill. */
    const wrap = (dst, m) => {
        let cur = dst;
        const add = (tag, style) => { const e = src.createElement(tag); if (style) e.setAttribute('style', style); cur.appendChild(e); cur = e; };
        if (m.href) { add('a'); cur.setAttribute('href', m.href); }
        if (m.color || m.bg) add('span', (m.color ? 'color: ' + m.color + ';' : '') + (m.color && m.bg ? ' ' : '') + (m.bg ? 'background-color: ' + m.bg + ';' : ''));
        for (const t of ['b', 'i', 'u', 's', 'sup', 'sub', 'code']) if (m[t]) add(t);
        return cur;
    };

    const walk = (node, dst, pre) => {
        if (node.nodeType === NODE_TEXT) { text(dst, node.data, pre); return; }
        if (node.nodeType !== NODE_ELEMENT) return;       // comments (Word's conditional ones) and the like
        const tag = node.localName;
        if (DROP.has(tag) || node.hasAttribute('hidden')) return;
        const st = node.style;
        if (st && (st.display === 'none' || st.visibility === 'hidden' || /mso-hide:\s*all/i.test(node.getAttribute('style') || ''))) return;
        if (tag === 'br') { dst.appendChild(src.createElement('br')); state.lineStart = true; return; }
        const block = BLOCK.has(tag);
        const isPre = pre || tag === 'pre';
        if (block) newLine(dst);
        if (tag === 'hr') return;
        if (tag === 'ol') state.olCount.push(0);
        if (tag === 'ul') state.olCount.push(-1);
        if (tag === 'li') {
            const n = state.olCount.length ? state.olCount[state.olCount.length - 1] : -1;
            if (n >= 0) { state.olCount[state.olCount.length - 1] = n + 1; text(dst, (n + 1) + '. ', false); } else text(dst, '• ', false);
        }
        // A block's look (colour, bold ...) belongs to the words in it; an inline element's too.
        const m = looks(node, tag);
        if (block) { delete m.href; delete m.code; }
        const inner = (m.href || m.color || m.bg || m.b || m.i || m.u || m.s || m.sup || m.sub || m.code) ? wrap(dst, m) : dst;
        // Wrapping a block's words in an element only when it has some: an empty wrapper is noise.
        const before = inner.childNodes.length;
        for (const c of Array.from(node.childNodes)) walk(c, inner, isPre);
        if (inner !== dst && inner.childNodes.length === before && !inner.textContent) {
            // nothing came of it: remove the empty wrapper chain
            let e = inner; while (e !== dst && e.parentNode && !e.textContent && !e.querySelector('br')) { const p = e.parentNode; p.removeChild(e); e = p; }
        }
        if (tag === 'ol' || tag === 'ul') state.olCount.pop();
        if (tag === 'td' || tag === 'th') { if (node.nextElementSibling) text(dst, ' ', false); }
        if (block && tag !== 'table' && tag !== 'tbody' && tag !== 'thead' && tag !== 'tfoot') newLine(dst);
    };
    for (const c of Array.from(root.childNodes)) walk(c, out, false);

    // No line break at the very end (or start), and none doubled by wrappers closing together.
    const tail = () => { let n = out.lastChild; while (n && n.nodeType === 1 && n.localName !== 'br' && n.lastChild) n = n.lastChild; return n; };
    for (let n = tail(); n && n.localName === 'br'; n = tail()) n.remove();
    const html2 = out.innerHTML;
    return out.textContent.trim() || /<br/.test(html2) ? html2 : '';
}
