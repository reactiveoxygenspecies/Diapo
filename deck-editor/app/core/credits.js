/* ============================================================
   credits.js - a picture's credit filled in from where it came
   from, when that is known: an image inserted from its address, or
   dragged in from a page in the browser (filedrop.js). The site
   becomes From and the address the Link; a picture from Wikimedia
   Commons gets its author and licence from the Commons file page
   (serve.py asks Commons, only then). What is filled in can be
   changed in the panel (Picture > Credit); nothing is filled in for
   a picture that has a credit already.
   ============================================================ */

const SITES = [
    [/(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/i, 'Wikimedia Commons'],
    [/(^|\.)unsplash\.com$/i, 'Unsplash'], [/(^|\.)pexels\.com$/i, 'Pexels'], [/(^|\.)pixabay\.com$/i, 'Pixabay'],
    [/(^|\.)flickr\.com$|(^|\.)staticflickr\.com$/i, 'Flickr'], [/(^|\.)nasa\.gov$/i, 'NASA'], [/(^|\.)noaa\.gov$/i, 'NOAA'],
];
/* The name of the site an address is on: "Wikimedia Commons", or the host without www. */
export function siteName(url) {
    let host;
    try { host = new URL(url).hostname; } catch (e) { return ''; }
    const known = SITES.find(([re]) => re.test(host));
    return known ? known[1] : host.replace(/^www\./, '');
}
export const isCommons = (url) => { try { return /(^|\.)(wikimedia|wikipedia)\.org$/i.test(new URL(url).hostname); } catch (e) { return false; } };

/* Fill the credit of `img` from the address it came from (one undo step); the Commons part
   arrives a moment later, as a step of its own. */
export async function creditFromUrl(app, img, url) {
    if (!img || !/^https?:\/\//i.test(url || '') || img.hasAttribute('data-credit-by') || img.hasAttribute('data-credit-from')) return;
    const h = app.history;
    h.begin('Picture credit');
    h.attr(img, 'data-credit-from', siteName(url), 'Picture credit');
    h.attr(img, 'data-credit-url', url, 'Picture credit');
    h.end();
    if (!isCommons(url)) return;
    try {
        const c = await app.api.commonsCredit(url);
        if (!img.isConnected) return;
        h.begin('Credit from Wikimedia Commons');
        if (c.by) h.attr(img, 'data-credit-by', c.by, 'Picture credit');
        if (c.license) h.attr(img, 'data-credit-license', c.license, 'Picture credit');
        if (c.url) h.attr(img, 'data-credit-url', c.url, 'Picture credit');
        h.end();
        if (app.inspector) app.inspector.sync();
        app.toast('Credit filled in from Wikimedia Commons: ' + [c.by, c.license].filter(Boolean).join(', '));
    } catch (err) { /* the site and the address stay; the author is typed in the panel */ }
}
