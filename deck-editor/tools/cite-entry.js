/* The entry of app/vendor/citation.js (bundled by tools/build-vendor.js with esbuild): the parts
   of citation.js the editor uses, and the citeproc-js engine they format with.
     Cite      reads BibTeX / BibLaTeX, RIS and CSL-JSON into CSL-JSON (@citation-js/core and plugins)
     CSL       citeproc-js, which writes citations and bibliographies in a CSL style
     styles    the CSL styles citation.js ships (APA 7th, Vancouver, Harvard), by id
     locales   the CSL locales it ships (en-US, nl-NL, fr-FR, de-DE, es-ES), by code
   Loaded into the editor on first use (core/cite.js), never into a deck. */
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import '@citation-js/plugin-csl';
import CSL from 'citeproc';

const csl = plugins.config.get('@csl');
const asObject = (register) => Object.fromEntries(register.list().map(k => [k, register.get(k)]));

window.DiapoCite = { Cite, CSL, styles: asObject(csl.styles), locales: asObject(csl.locales) };
