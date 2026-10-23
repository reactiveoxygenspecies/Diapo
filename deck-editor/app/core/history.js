/* ============================================================
   history.js - undo/redo as a command stack.

   Every change to the deck goes through here as a command with
   undo() and redo(). Commands that carry the same `key` within a
   short window are merged (slider drags, nudges), and begin()/end()
   wraps many commands into one step (a drag, a multi-select move).

   The stack also remembers the first-seen state of every element
   it touched (`originals`), so the serialiser can ask "was this
   element ever changed from what the deck loaded?".
   ============================================================ */

const MERGE_WINDOW_MS = 900;

export class History extends EventTarget {
    constructor() {
        super();
        this.undoStack = [];
        this.redoStack = [];
        this.savedAt = null;         // the command that was on top when the file was last saved
        this.tx = null;              // open transaction: { label, cmds }
        this.originals = new WeakMap();   // el -> { style, html, attrs }
    }

    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
    get top() { return this.undoStack[this.undoStack.length - 1] || null; }
    get isDirty() { return this.top !== this.savedAt; }

    markSaved() { this.savedAt = this.top; this._emit('change'); }
    /* After a draft restore the file on disk differs from the DOM even though nothing was undone. */
    forceDirty() { this.savedAt = {}; this._emit('change'); }
    clear() { this.undoStack = []; this.redoStack = []; this.savedAt = null; this.tx = null; this.originals = new WeakMap(); this._emit('change'); }

    /* ------------------------------------------------------------
       Recording
       ------------------------------------------------------------ */
    /* Push a command that has already been applied. */
    push(cmd) {
        if (!cmd) return;
        if (this.tx) { this.tx.cmds.push(cmd); return; }
        const last = this.top;
        if (last && cmd.key && last.key === cmd.key && last.merge && last.el === cmd.el && Date.now() - last.time < MERGE_WINDOW_MS && last !== this.savedAt) {
            last.merge(cmd);
            last.time = Date.now();
        } else {
            cmd.time = Date.now();
            this.undoStack.push(cmd);
        }
        this.redoStack = [];
        this._emit('change');
    }

    /* Apply and push. */
    run(cmd) { cmd.redo(); this.push(cmd); return cmd; }

    /* Transactions: everything pushed between begin() and end() becomes one step. */
    begin(label) {
        if (this.tx) return;
        this.tx = { label, cmds: [] };
    }
    end() {
        const tx = this.tx;
        this.tx = null;
        if (!tx || !tx.cmds.length) return;
        this.push(tx.cmds.length === 1 ? tx.cmds[0] : composite(tx.label, tx.cmds));
    }
    cancel() {
        const tx = this.tx;
        this.tx = null;
        if (tx) for (let i = tx.cmds.length - 1; i >= 0; i--) tx.cmds[i].undo();
    }

    /* ------------------------------------------------------------
       Stepping
       ------------------------------------------------------------ */
    undo() {
        if (this.tx) this.end();
        const cmd = this.undoStack.pop();
        if (!cmd) return null;
        this._emit('before-step', cmd);
        cmd.undo();
        this.redoStack.push(cmd);
        this._emit('change');
        this._emit('step', { cmd, direction: 'undo' });
        return cmd;
    }
    redo() {
        if (this.tx) this.end();
        const cmd = this.redoStack.pop();
        if (!cmd) return null;
        this._emit('before-step', cmd);
        cmd.redo();
        this.undoStack.push(cmd);
        this._emit('change');
        this._emit('step', { cmd, direction: 'redo' });
        return cmd;
    }

    /* ------------------------------------------------------------
       Originals: first-seen state of anything the editor touches
       ------------------------------------------------------------ */
    remember(el) {
        if (!el || this.originals.has(el)) return;
        this.originals.set(el, {
            style: el.getAttribute('style'),
            html: el.innerHTML,
            attrs: attrSnapshot(el),
        });
    }
    /* True when the element differs from the state it had before the editor first touched it. */
    isChanged(el) {
        const o = this.originals.get(el);
        if (!o) return false;
        return o.style !== el.getAttribute('style') || o.html !== el.innerHTML || o.attrs !== attrSnapshot(el);
    }
    /* True when root or anything inside it was changed. */
    hasChangesWithin(root) {
        if (this.isChanged(root)) return true;
        for (const el of root.querySelectorAll('*')) if (this.isChanged(el)) return true;
        return false;
    }

    /* ------------------------------------------------------------
       Convenience recorders: capture before, apply, push after.
       ------------------------------------------------------------ */
    /* Change inline styles: fn(el) does the work. */
    style(el, fn, { label = 'Style', key = null } = {}) {
        this.remember(el);
        const before = el.getAttribute('style');
        fn(el);
        const after = el.getAttribute('style');
        if (before === after) return null;
        return this.push(styleCmd(el, before, after, label, key));
    }
    /* Change innerHTML (text edits). */
    html(el, before, after, label = 'Edit text') {
        this.remember(el);
        if (before === after) return null;
        return this.push(htmlCmd(el, before, after, label));
    }
    /* Change one attribute. */
    attr(el, name, value, label = 'Change ' + name) {
        this.remember(el);
        const before = el.getAttribute(name);
        if (before === value) return null;
        return this.run(attrCmd(el, name, before, value, label));
    }
    insert(node, parent, before = null, label = 'Insert') { return this.run(insertCmd(node, parent, before, label)); }
    remove(node, label = 'Delete') { return this.run(removeCmd(node, label)); }
    move(node, parent, before = null, label = 'Move') { return this.run(moveCmd(node, parent, before, label)); }

    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

function attrSnapshot(el) {
    return Array.from(el.attributes).filter(a => a.name !== 'style').map(a => a.name + '=' + a.value).sort().join('\n');
}

/* ------------------------------------------------------------
   Command factories. Each returns { label, undo, redo, key?, merge? }.
   ------------------------------------------------------------ */
function setAttr(el, name, v) { if (v == null) el.removeAttribute(name); else el.setAttribute(name, v); }

export function styleCmd(el, before, after, label = 'Style', key = null) {
    return {
        label, key, el, before, after,
        undo() { setAttr(el, 'style', this.before); },
        redo() { setAttr(el, 'style', this.after); },
        /* A later command with the same key folds in: keep our `before`, take its `after`. */
        merge(next) { this.after = next.after; },
    };
}

export function htmlCmd(el, before, after, label = 'Edit text') {
    return { label, el, undo() { el.innerHTML = before; }, redo() { el.innerHTML = after; } };
}

export function attrCmd(el, name, before, after, label) {
    const index = Array.from(el.attributes).findIndex(a => a.name === name);
    return { label: label || 'Change ' + name, el, undo() { setAttrAt(el, name, before, index); }, redo() { setAttr(el, name, after); } };
}

/* Put an attribute back where it was, so an undone removal does not move it to the end. */
function setAttrAt(el, name, value, index) {
    if (value == null) { el.removeAttribute(name); return; }
    if (el.hasAttribute(name) || index < 0) { el.setAttribute(name, value); return; }
    const tail = Array.from(el.attributes).slice(index).map(a => [a.name, a.value]);
    for (const [n] of tail) el.removeAttribute(n);
    el.setAttribute(name, value);
    for (const [n, v] of tail) el.setAttribute(n, v);
}

export function insertCmd(node, parent, before = null, label = 'Insert') {
    return { label, el: node, redo() { parent.insertBefore(node, before); }, undo() { node.remove(); } };
}

export function removeCmd(node, label = 'Delete') {
    const parent = node.parentNode, before = node.nextSibling;
    return { label, el: node, redo() { node.remove(); }, undo() { parent.insertBefore(node, before); } };
}

export function moveCmd(node, toParent, toBefore = null, label = 'Move') {
    const fromParent = node.parentNode, fromBefore = node.nextSibling;
    return {
        label, el: node,
        redo() { toParent.insertBefore(node, toBefore); },
        undo() { fromParent.insertBefore(node, fromBefore); },
    };
}

export function composite(label, cmds) {
    return {
        label, el: cmds[0] && cmds[0].el,
        redo() { for (const c of cmds) c.redo(); },
        undo() { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo(); },
    };
}
