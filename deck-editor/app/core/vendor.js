/* ============================================================
   vendor.js - the libraries in app/vendor/, loaded into the editor
   page the first time something needs them (MathJax is 2 MB), once.
   They never go into a deck: see math.js and chem.js.
   ============================================================ */
const loading = new Map();

export function loadVendor(file, ready = () => true) {
    if (!loading.has(file)) {
        loading.set(file, new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'vendor/' + file;
            s.onload = () => resolve();
            s.onerror = () => { loading.delete(file); reject(new Error('could not load ' + file)); };
            document.head.appendChild(s);
        }).then(ready));
    }
    return loading.get(file);
}
