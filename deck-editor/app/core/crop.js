/* ============================================================
   crop.js - cropping a picture by hand.

   A cropped picture is a box that shows part of it:
     <div data-crop style="position:absolute; left; top; width;
          height; overflow:hidden; ...">
       <img src alt style="position:absolute; left:-12%; top:-4%;
            width:140%; height:125%; ...">
     </div>
   The box has the picture's place, size, look and identity (its
   classes, data-id, animation, link); the <img> inside keeps only
   what is the picture's own (src, alt), placed in percentages of the
   box, so resizing the box scales the crop with it. Plain HTML and
   CSS: nothing is needed to show it.

   Crop mode (double-click a picture, Enter, or Crop in the panel or
   the element menu) shows the whole picture dimmed round the box:
   drag the picture to move it in the box, drag the box's handles to
   change what shows, drag the picture's corners or turn the wheel to
   zoom. Enter, Esc or a click outside the picture ends it; the whole
   crop is one undo step, and a crop mode left without a change
   leaves the picture as it was.
   ============================================================ */
import { css } from './dom.js';
import { getOffset, setOffset } from './transform.js';
import { styleCmd } from './history.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNERS = ['nw', 'ne', 'se', 'sw'];
/* Attributes that are the picture's own and stay on the <img>; everything else goes to the box. */
const IMG_OWN = /^(src|srcset|sizes|alt|loading|decoding|crossorigin|referrerpolicy|width|height|style|contenteditable|spellcheck)$/;

export function isCropBox(el) {
    return !!el && typeof el.matches === 'function' && el.matches('[data-crop]') && !!el.querySelector(':scope > img');
}
/* The box of a cropped picture, from the box or the picture in it. */
export function cropBoxOf(el) {
    if (!el || typeof el.matches !== 'function') return null;
    if (isCropBox(el)) return el;
    return el.tagName === 'IMG' && isCropBox(el.parentElement) ? el.parentElement : null;
}
/* The <img> itself: the one in a crop box, or the element when it is a picture. */
export function pictureOf(el) {
    const box = cropBoxOf(el);
    if (box) return box.querySelector(':scope > img');
    return el && el.tagName === 'IMG' ? el : null;
}
export function canCrop(el) { return !!pictureOf(el) && !el.hasAttribute('data-placeholder'); }

export class Cropper {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.selection = app.selection;
        this.s = null;                  // the session while crop mode is on
        const redraw = () => { if (this.s) this.draw(); };
        window.addEventListener('editor:zoom', redraw);
        window.addEventListener('resize', redraw);
        this.selection.canvas.addEventListener('scroll', redraw);
        this.deck.addEventListener('slide', () => this.finish());
        window.addEventListener('editor:before-save', () => this.finish());
        window.addEventListener('editor:before-step', () => this.finish());
        // A double-click (or Enter) on a picture crops it.
        this.selection.addEventListener('edit-text', (e) => { if (canCrop(e.detail.el) && !this.s) this.start(e.detail.el); });
    }
    get active() { return !!this.s; }

    /* ------------------------------------------------------------
       Into crop mode and out of it
       ------------------------------------------------------------ */
    start(el) {
        if (this.s || !canCrop(el)) return false;
        let box = cropBoxOf(el);
        const target = box || el;
        if ((parseFloat(target.style.rotate) || 0) !== 0 || isTurned(css(target).transform)) {
            this.app.toast('Crop works on a picture that is not rotated: set Rotate to 0 first, crop, then rotate it again.', { ms: 5000 });
            return false;
        }
        if (el.tagName === 'IMG' && !el.complete) { this.app.toast('The picture has not loaded yet'); return false; }
        this.app.textEdit.commit();
        this.history.begin('Crop');
        if (!box) box = this._wrap(el);
        const img = box.querySelector(':scope > img');
        this.history.remember(box); this.history.remember(img);
        this.s = { box, img, before: [box.getAttribute('style'), img.getAttribute('style')], overflow: box.style.overflow };
        box.style.overflow = 'visible';            // the whole picture shows while cropping (not recorded)
        this.selection.select(box);
        this.selection.enabled = false;
        this.selection.overlay.classList.add('cropping');
        this._build();
        this.draw();
        return true;
    }

    /* Leave crop mode: the changes are one undo step with the wrapping, none at all when nothing changed. */
    finish() {
        const s = this.s; if (!s) return;
        this.s = null;
        s.box.style.overflow = s.overflow || 'hidden';
        this.layer.remove(); this.layer = null;
        this.selection.overlay.classList.remove('cropping');
        this.selection.enabled = true;
        // Setting overflow rewrote the box's style in the browser's own spelling: when the CSS is what it
        // was, the attribute goes back exactly as written, so an untouched crop leaves the file untouched.
        if (s.before[0] != null && sameCss(s.box.getAttribute('style'), s.before[0])) s.box.setAttribute('style', s.before[0]);
        const after = [s.box.getAttribute('style'), s.img.getAttribute('style')];
        if (after[0] === s.before[0] && after[1] === s.before[1]) {
            this.history.cancel();                 // no crop made: a picture that was wrapped for it is unwrapped
            const pic = s.box.isConnected ? s.box : s.img;
            this.selection.select(pic.isConnected ? pic : null);
            return;
        }
        [s.box, s.img].forEach((el, i) => { if (after[i] !== s.before[i]) this.history.push(styleCmd(el, s.before[i], after[i], 'Crop')); });
        this.history.end();
        this.selection.select(s.box);
    }

    /* A picture becomes a crop box holding it, looking just as it did: where object-fit put its
       pixels (cover crops, contain leaves bands) is where they are inside the box. */
    _wrap(img) {
        const doc = img.ownerDocument, cs = css(img);
        const w = img.offsetWidth, h = img.offsetHeight;
        const nw = img.naturalWidth || w, nh = img.naturalHeight || h;
        let dw = w, dh = h, dx = 0, dy = 0;
        const fit = cs.objectFit;
        if (fit && fit !== 'fill') {
            const cover = Math.max(w / nw, h / nh), contain = Math.min(w / nw, h / nh);
            const k = fit === 'cover' ? cover : fit === 'contain' ? contain : fit === 'none' ? 1 : Math.min(1, contain);
            dw = nw * k; dh = nh * k;
            const [px, py] = (cs.objectPosition || '50% 50%').split(/\s+/);
            const at = (v, free) => /%$/.test(v) ? parseFloat(v) / 100 * free : parseFloat(v) || 0;
            dx = at(px, w - dw); dy = at(py || '50%', h - dh);
        }
        // What shows: the drawn picture clipped to its box.
        const vx = Math.max(0, dx), vy = Math.max(0, dy);
        const vw = Math.min(w, dx + dw) - vx, vh = Math.min(h, dy + dh) - vy;
        const box = doc.createElement('div');
        box.setAttribute('data-crop', '');
        for (const a of Array.from(img.attributes)) if (!IMG_OWN.test(a.name)) box.setAttribute(a.name, a.value);
        box.setAttribute('style', img.getAttribute('style') || '');
        const bs = box.style;
        for (const p of ['objectFit', 'objectPosition', 'maxWidth', 'maxHeight', 'minWidth', 'minHeight']) bs[p] = '';
        if (cs.position === 'static') { bs.position = 'relative'; bs.display = cs.display === 'inline' ? 'inline-block' : cs.display; }
        bs.width = r1(vw) + 'px'; bs.height = r1(vh) + 'px';
        bs.overflow = 'hidden';
        // The deck's rounding of pictures goes to the box, where the edge now is.
        if (!bs.borderRadius && parseFloat(cs.borderTopLeftRadius)) bs.borderRadius = cs.borderRadius;
        // The picture inside: where its pixels were, in percentages of the box.
        const inner = `position:absolute; left:${pct((dx - vx) / vw)}; top:${pct((dy - vy) / vh)}; width:${pct(dw / vw)}; height:${pct(dh / vh)}; max-width:none; max-height:none; min-width:0; min-height:0; margin:0; object-fit:fill; border-radius:0; translate:none; rotate:none;`;
        this.history.insert(box, img.parentNode, img, 'Crop');
        if (vx || vy) { const o = getOffset(box); this.history.style(box, () => setOffset(box, o.x + vx, o.y + vy), { label: 'Crop' }); }
        for (const a of Array.from(img.attributes)) if (!IMG_OWN.test(a.name)) this.history.attr(img, a.name, null, 'Crop');
        this.history.style(img, () => img.setAttribute('style', inner), { label: 'Crop' });
        this.history.move(img, box, null, 'Crop');
        return box;
    }

    /* The picture as a picture again, whole, in the box's place and width. One undo step. */
    uncrop(el) {
        const box = cropBoxOf(el); if (!box) return null;
        const img = box.querySelector(':scope > img');
        const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
        const style = box.getAttribute('style') || '';
        this.history.begin('Remove crop');
        this.history.move(img, box.parentNode, box, 'Remove crop');
        for (const a of Array.from(box.attributes)) if (a.name !== 'data-crop' && a.name !== 'style') this.history.attr(img, a.name, a.value, 'Remove crop');
        this.history.style(img, () => {
            img.setAttribute('style', style);
            const w = parseFloat(img.style.width) || box.offsetWidth;
            img.style.overflow = '';
            img.style.width = r1(w) + 'px';
            img.style.height = r1(w * nh / nw) + 'px';
            img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
            if (img.style.display === 'inline-block' || img.style.position === 'relative') { img.style.display = ''; if (img.style.position === 'relative') img.style.position = ''; }
        }, { label: 'Remove crop' });
        this.history.remove(box, 'Remove crop');
        this.history.end();
        this.selection.select(img);
        return img;
    }

    /* ------------------------------------------------------------
       The overlay: the whole picture dimmed round the box, handles on both
       ------------------------------------------------------------ */
    _build() {
        const layer = document.createElement('div');
        layer.className = 'crop-layer';
        layer.innerHTML = `<div class="crop-clip"><div class="crop-window"></div></div>
            <div class="crop-image"></div><div class="crop-frame"></div>
            ${CORNERS.map(h => `<i class="crop-ih" data-ih="${h}" title="Drag to zoom the picture"></i>`).join('')}
            ${HANDLES.map(h => `<i class="crop-h" data-h="${h}" title="Drag to crop"></i>`).join('')}
            <div class="crop-tip">Drag the picture to move it · the white handles crop · the corners or the wheel zoom · Enter when done</div>`;
        this.selection.overlay.appendChild(layer);
        this.layer = layer;
        layer.addEventListener('pointerdown', (e) => this._down(e));
        layer.addEventListener('pointermove', (e) => this._move(e));
        layer.addEventListener('pointerup', (e) => this._up(e));
        layer.addEventListener('pointercancel', (e) => this._up(e));
        layer.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
        layer.addEventListener('dblclick', (e) => { e.stopPropagation(); this.finish(); });
        layer.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    }

    /* Stage rects of the box and of the whole picture. */
    rects() {
        const B = this.deck.stageRect(this.s.box), I = this.deck.stageRect(this.s.img);
        return { B, I };
    }
    draw() {
        if (!this.s || !this.layer) return;
        const { B, I } = this.rects(), sel = this.selection;
        const b = sel.toOverlay(B), i = sel.toOverlay(I);
        const place = (n, r) => Object.assign(n.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        const q = (c) => this.layer.querySelector(c);
        place(q('.crop-clip'), i);
        place(q('.crop-window'), { x: b.x - i.x, y: b.y - i.y, w: b.w, h: b.h });
        place(q('.crop-image'), i);
        place(q('.crop-frame'), b);
        const at = (r, h) => ({ x: r.x + (h.includes('w') ? 0 : h.includes('e') ? r.w : r.w / 2), y: r.y + (h.includes('n') ? 0 : h.includes('s') ? r.h : r.h / 2) });
        this.layer.querySelectorAll('.crop-h').forEach(n => { const p = at(b, n.dataset.h); n.style.left = p.x + 'px'; n.style.top = p.y + 'px'; });
        this.layer.querySelectorAll('.crop-ih').forEach(n => { const p = at(i, n.dataset.ih); n.style.left = p.x + 'px'; n.style.top = p.y + 'px'; });
        const tip = q('.crop-tip');
        // Over the picture, kept inside the canvas.
        const room = this.layer.clientWidth || innerWidth;
        tip.style.left = Math.max(4, Math.min(b.x, room - tip.offsetWidth - 8)) + 'px';
        tip.style.top = Math.max(4, Math.min(i.y, b.y) - 30) + 'px';
    }

    /* The picture at stage rect I, the box at stage rect B: written as the box's size and place and
       the picture's percentages inside it. */
    _apply(B, I) {
        const { box, img } = this.s;
        const cur = this.deck.stageRect(box);
        if (Math.abs(B.w - cur.w) > 0.01 || Math.abs(B.h - cur.h) > 0.01) { box.style.width = r1(B.w) + 'px'; box.style.height = r1(B.h) + 'px'; }
        if (Math.abs(B.x - cur.x) > 0.01 || Math.abs(B.y - cur.y) > 0.01) {
            const o = getOffset(box);
            setOffset(box, o.x + (B.x - cur.x), o.y + (B.y - cur.y));
            // Where a move lands is up to the layout (rounding, a flex parent): measured again.
            const now = this.deck.stageRect(box);
            B = { ...B, x: now.x, y: now.y };
        }
        img.style.left = pct((I.x - B.x) / B.w);
        img.style.top = pct((I.y - B.y) / B.h);
        img.style.width = pct(I.w / B.w);
        img.style.height = pct(I.h / B.h);
        this.draw();
    }

    /* ------------------------------------------------------------
       Pointer work
       ------------------------------------------------------------ */
    _down(e) {
        e.stopPropagation();
        if (e.button !== 0) return;
        e.preventDefault();
        const { B, I } = this.rects();
        const p = this.selection.toStage(e.clientX, e.clientY);
        const h = e.target.closest('.crop-h'), ih = e.target.closest('.crop-ih');
        const inside = p.x >= I.x && p.x <= I.x + I.w && p.y >= I.y && p.y <= I.y + I.h;
        if (!h && !ih && !inside) { this.finish(); return; }          // a press outside the picture ends the crop
        this.layer.setPointerCapture(e.pointerId);
        this.drag = { kind: h ? 'frame' : ih ? 'zoom' : 'pan', h: h ? h.dataset.h : ih ? ih.dataset.ih : null, p0: p, B0: B, I0: I };
        this.deck.setTransitions(false);
    }
    _move(e) {
        e.stopPropagation();
        const d = this.drag; if (!d) return;
        const p = this.selection.toStage(e.clientX, e.clientY);
        const dx = p.x - d.p0.x, dy = p.y - d.p0.y;
        const { B0, I0 } = d;
        if (d.kind === 'pan') {
            this._apply(B0, cover(B0, { ...I0, x: I0.x + dx, y: I0.y + dy }));
        } else if (d.kind === 'frame') {
            // The box's edges move over the fixed picture, never past it, never smaller than a few pixels.
            let x1 = B0.x, y1 = B0.y, x2 = B0.x + B0.w, y2 = B0.y + B0.h;
            const min = 8;
            if (d.h.includes('w')) x1 = clamp(B0.x + dx, I0.x, x2 - min);
            if (d.h.includes('e')) x2 = clamp(B0.x + B0.w + dx, x1 + min, I0.x + I0.w);
            if (d.h.includes('n')) y1 = clamp(B0.y + dy, I0.y, y2 - min);
            if (d.h.includes('s')) y2 = clamp(B0.y + B0.h + dy, y1 + min, I0.y + I0.h);
            // Shift on a corner keeps the box's proportions.
            if (e.shiftKey && d.h.length === 2) {
                const ratio = B0.w / B0.h;
                if ((x2 - x1) / (y2 - y1) > ratio) { const w = (y2 - y1) * ratio; if (d.h.includes('w')) x1 = x2 - w; else x2 = x1 + w; }
                else { const hh = (x2 - x1) / ratio; if (d.h.includes('n')) y1 = y2 - hh; else y2 = y1 + hh; }
            }
            this._apply({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, I0);
        } else {
            // Zoom from the opposite corner, the picture keeping its proportions and covering the box.
            const ax = d.h.includes('w') ? I0.x + I0.w : I0.x, ay = d.h.includes('n') ? I0.y + I0.h : I0.y;
            const sx = d.h.includes('w') ? -1 : 1, sy = d.h.includes('n') ? -1 : 1;
            let f = Math.max((I0.w + sx * dx) / I0.w, (I0.h + sy * dy) / I0.h);
            const farX = sx > 0 ? B0.x + B0.w - ax : ax - B0.x, farY = sy > 0 ? B0.y + B0.h - ay : ay - B0.y;
            f = Math.max(f, farX / I0.w, farY / I0.h);
            const w = I0.w * f, hh = I0.h * f;
            this._apply(B0, { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - hh, w, h: hh });
        }
    }
    _up(e) {
        e.stopPropagation();
        if (!this.drag) return;
        this.drag = null;
        this.deck.setTransitions(true);
        try { this.layer.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
    }
    _wheel(e) {
        e.preventDefault(); e.stopPropagation();
        const { B, I } = this.rects();
        const p = this.selection.toStage(e.clientX, e.clientY);
        const f = Math.exp(-e.deltaY * 0.0015);
        this._apply(B, cover(B, { x: p.x + (I.x - p.x) * f, y: p.y + (I.y - p.y) * f, w: I.w * f, h: I.h * f }));
    }

    /* Keys while cropping: Enter and Esc finish, arrows move the picture a pixel (ten with Shift).
       Returns true when the key was used; anything with Ctrl finishes first and goes on. */
    handleKey(e) {
        if (!this.s) return false;
        if (e.ctrlKey || e.metaKey) { this.finish(); return false; }
        if (e.key === 'Enter' || e.key === 'Escape') { this.finish(); return true; }
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) { const { B, I } = this.rects(); this._apply(B, cover(B, { ...I, x: I.x + d[0], y: I.y + d[1] })); return true; }
        return true;                               // nothing else reaches the slide while cropping
    }
}

/* The picture rect I made to cover the box B: scaled up about its centre when it is too small,
   then moved so no edge of the box is left uncovered. */
function cover(B, I) {
    const k = Math.max(1, B.w / I.w, B.h / I.h);
    if (k > 1) I = { x: I.x + I.w / 2 - I.w * k / 2, y: I.y + I.h / 2 - I.h * k / 2, w: I.w * k, h: I.h * k };
    return { ...I, x: clamp(I.x, B.x + B.w - I.w, B.x), y: clamp(I.y, B.y + B.h - I.h, B.y) };
}
/* A computed transform that turns the element: a matrix with a skew or rotation part (a move, as
   the deck's reveal classes make, is a matrix too, and does not count). */
function isTurned(t) {
    const m = /^matrix\(([^)]+)\)/.exec(t || '');
    if (!m) return /^matrix3d|rotate/.test(t || '');
    const [, b, c] = m[1].split(',').map(parseFloat);
    return Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6;
}
function sameCss(a, b) {
    const x = document.createElement('i'), y = document.createElement('i');
    x.setAttribute('style', a || ''); y.setAttribute('style', b || '');
    return x.style.cssText === y.style.cssText;
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function pct(v) { return (Math.round(v * 100000) / 1000) + '%'; }
function r1(v) { return Math.round(v * 10) / 10; }
