/* ============================================================
   inspector.js - the properties panel, bound to the selection.

   Every field maps to one CSS property (or to the editor's move
   offset). A field shows the computed value when nothing is set
   and is highlighted when the element carries an explicit inline
   override; the small "x" next to it removes only that override.
   Changes preview on `input` and become one undo step on `change`;
   they apply to every selected element and reflect the primary one.
   ============================================================ */
import { describe, nameOf, uniqueId, isShape, css, isEditableText, isMaster, isLocked, isLayoutUnit, MEDIA_TAGS, DRAWN, colourName, setSwatches } from './dom.js';
import { getOffset, setOffset, setRotation, afterResize, fitText, refitAll } from './transform.js';
import { styleCmd } from './history.js';
import { PRESETS, EASES, animationCss, deckRevealClasses, describeAnimation, applyPreset, setTiming, replay, setFragment, fragmentOf, TEXT_EFFECTS, setTextEffect } from './animate.js';
import { firstFamily, availableWeights, ensureGoogle, isGoogleFamily } from './fonts.js';
import { setListKind, clearMarker } from './insert.js';
import { ChartSection, chartOf } from './chart.js';
import { MathSection, mathOf } from './math.js';
import { ChemSection, chemOf } from './chem.js';
import { canCrop, cropBoxOf, pictureOf } from './crop.js';

const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const SHADOWS = {
    '': 'none',
    soft: '0 4px 16px rgba(0,0,0,0.12)',
    medium: '0 8px 28px rgba(0,0,0,0.20)',
    hard: '4px 4px 0 rgba(0,0,0,0.35)',
};
/* The type fields that can apply to part of the text, and what their x clears there. */
const INLINE_PROPS = {
    fontFamily: { fontFamily: '' }, fontSize: { fontSize: '' }, fontWeight: { fontWeight: '' },
    fontStyle: { fontStyle: '', textTransform: '' }, letterSpacing: { letterSpacing: '' },
};
/* What a list can be marked with, per kind. The empty value leaves it to the deck's CSS. */
const LIST_MARKERS = {
    ul: [['', 'deck default'], ['disc', 'disc'], ['circle', 'circle'], ['square', 'square'], ['none', 'none']],
    ol: [['', 'deck default'], ['decimal', '1. 2. 3.'], ['decimal-leading-zero', '01. 02. 03.'], ['lower-alpha', 'a. b. c.'], ['upper-alpha', 'A. B. C.'],
         ['lower-roman', 'i. ii. iii.'], ['upper-roman', 'I. II. III.'], ['none', 'none']],
};
const RECENT_KEY = 'deck-editor-recent-colours';

/* Selectors of rules for a state (the slide shown, an element revealed, hovered): what they set changes. */
const STATE_SEL = /\.(visible|active|current|past|future)\b|:(hover|focus|focus-within|checked)\b/;
/* Animation declarations at the top level of an element's own CSS (nested rules and @-rules left out). */
const OWN_ANIM = (css) => /(^|[;\s])animation(-[a-z-]+)?\s*:/i.test(css.replace(/\{[^{}]*\}/g, '').replace(/[^;{}]*\{[^{}]*\}/g, ''));
const FOLD_KEY = 'diapo-panel-folded';
const FOLDED_FIRST = ['timing', 'box', 'align', 'anim', 'pos', 'link'];

export class Inspector {
    constructor(app, root) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.selection = app.selection;
        this.root = root;
        this.pending = null;          // { items: [{el, before}], label } while a field is being dragged/typed
        this.syncing = false;
        this.colourTarget = 'text';
        // The CSSOM rewrites shadow strings (colour first, px units); keep the normalised forms to recognise presets.
        const scratch = document.createElement('i');
        this.shadowKeys = Object.entries(SHADOWS).map(([k, v]) => { scratch.style.boxShadow = v; return [k, v, scratch.style.boxShadow]; });
        this._build();
        this.chart = new ChartSection(app, this.$('inspChart'));
        this.math = new MathSection(app, this.$('inspMath'));
        this.chem = new ChemSection(app, this.$('inspChem'));
        this._bind();
    }

    get items() { return this.selection.items; }
    get el() { return this.selection.primary; }

    /* ------------------------------------------------------------
       Markup
       ------------------------------------------------------------ */
    _build() {
        this.root.innerHTML = `
        <div class="insp-empty" data-when="none">Select something on the slide to edit it.<br><small>Click selects, double-click edits text, Ctrl+click picks the exact element.</small></div>
        <div data-when="slide">
          <section class="insp-section">
            <h4>Slide <span id="inspSlideNo" class="insp-role"></span></h4>
            <div class="insp-row"><label>Name</label><div class="insp-field" data-prop="_name"><input type="text" id="inspSlideName" placeholder="(none)" spellcheck="false" title="The slide's name in the strip and in Morph from lists. Saved as data-name."></div></div>
            <div class="insp-row"><label>Section</label><div class="insp-field" data-prop="_section"><input type="text" id="inspSection" placeholder="(none)" spellcheck="false" title="A section starts at this slide: a heading in the slide strip, and in the overview (O) when presenting. Saved as data-section."></div></div>
            <div class="insp-row"><label>Transition</label><div class="insp-field" data-prop="_transition"><select id="inspTransition"><option value="">Deck default</option><option value="none">None</option><option value="fade">Fade</option><option value="slide">Slide</option><option value="up">Up</option><option value="zoom">Zoom</option></select></div></div>
            <div class="insp-row"><label>All slides</label><div class="insp-field" data-prop="_transitionDeck" title="The transition of every slide that does not choose its own"><select id="inspTransitionDeck"><option value="">None</option><option value="fade">Fade</option><option value="slide">Slide</option><option value="up">Up</option><option value="zoom">Zoom</option></select></div></div>
            <div class="insp-hint insp-state" id="inspTransitionHint"></div>
            <label class="align-toslide" style="margin-top:10px" title="Elements on both slides (linked with Morph from, else the same text or picture) travel, resize and reshape into their new place; everything else fades in. Duplicate this slide and rearrange the copy, or link an element on the next slide with Morph from."><input type="checkbox" id="inspAutoAnimate"> <span>Auto-animate to the next slide</span></label>
            <div class="insp-hint">Elements on both slides move into place; the rest fades in.</div>
            <div id="inspMasterRow" hidden>
              <label class="align-toslide" style="margin-top:10px" title="The master layer: the footer, page counter or logo that every slide shows. Click one on the canvas to edit it for all slides; Insert > Footer on every slide adds one."><input type="checkbox" id="inspShowMaster"> <span>Show the footer and page number here</span></label>
            </div>
          </section>
          <section class="insp-section" data-fold="timing">
            <h4>Runs by itself</h4>
            <div class="insp-row"><label>Advance after</label><div class="insp-field" data-prop="_advance" title="When the deck presents on its own (A in the saved deck, or a deck that starts by itself): this slide waits these seconds, a fragment at a time, then moves on. Empty: the wait of all slides."><input type="number" id="inspAdvance" min="0.5" max="600" step="0.5" placeholder="same as all"><span class="unit">s</span><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            <div class="insp-row"><label>All slides</label><div class="insp-field" data-prop="_advanceDeck" title="The wait of every slide that does not set its own. A deck that has one starts running by itself when it is opened on its own (a kiosk)."><input type="number" id="inspAdvanceDeck" min="0.5" max="600" step="0.5" placeholder="off"><span class="unit">s</span><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            <label class="align-toslide" id="inspLoopRow" title="At the end of a deck that runs by itself, start again from the first slide."><input type="checkbox" id="inspLoop"> <span>Start again at the end</span></label>
          </section>
          <section class="insp-section">
            <h4>Background</h4>
            <div class="insp-swatches" id="inspSlideSwatches"></div>
            <div class="insp-colour" id="inspSlideColour">
              <input type="color" id="inspSlideBg" title="Pick a colour">
              <input type="text" id="inspSlideBgHex" placeholder="#rrggbb" spellcheck="false">
              <button class="mini-btn" data-act="slidebg-none" title="Back to the deck's default">default</button>
            </div>
          </section>
          <section class="insp-section">
            <h4>Speaker notes</h4>
            <textarea id="inspNotes" class="insp-notes" rows="6" placeholder="Notes for the presenter view" spellcheck="false"></textarea>
          </section>
        </div>
        <div data-when="some">
          <section class="insp-section">
            <div class="insp-what"><input type="text" id="inspName" class="insp-name" spellcheck="false" title="Give it a name: shown here and in the Morph from lists"> <span class="insp-role" id="inspRole"></span>
              <span class="insp-nav"><button class="mini-btn" data-act="parent" title="Select what contains it" aria-label="Select what contains it">&#8593;</button><button class="mini-btn" data-act="child" title="Select the first thing inside it" aria-label="Select the first thing inside it">&#8595;</button></span>
              <div class="insp-text" id="inspText"></div></div>
            <div class="insp-btns">
              <button class="mini-btn" data-act="text" title="Edit the text (Enter or double-click)">Edit text</button>
              <button class="mini-btn" data-act="choose-image" id="inspChooseImage" title="Replace this placeholder with a picture from a file" hidden>Choose image...</button>
              <button class="mini-btn" data-act="delete" title="Delete (Delete key)">Delete</button>
              <button class="mini-btn" data-act="hide" title="Hide: kept in the file, Unhide all brings it back">Hide</button>
              <button class="mini-btn" data-act="lock" id="inspLock" title="Lock: a click or a marquee passes it by, it cannot be moved or resized; Ctrl+click still selects it">Lock</button>
              <button class="mini-btn" data-act="reset" title="Take back every change made to its look in the panel">Reset</button>
            </div>
          </section>

          <section class="insp-section" id="inspTable" hidden>
            <h4>Table</h4>
            <div class="insp-btns">
              <button class="mini-btn" data-act="row-add" title="Add a row at the bottom (Tab in the last cell does too)">+ Row</button>
              <button class="mini-btn" data-act="col-add" title="Add a column at the right">+ Column</button>
              <button class="mini-btn" data-act="row-del" title="Remove the bottom row">- Row</button>
              <button class="mini-btn" data-act="col-del" title="Remove the rightmost column">- Column</button>
            </div>
            <div class="insp-hint">Double-click a cell; Tab moves on.</div>
          </section>

          <section class="insp-section" id="inspList" hidden>
            <h4>List</h4>
            <div class="insp-row"><label>Kind</label><div class="insp-field insp-seg" id="inspListKind"><button data-v="ul" title="Bulleted list">&#8226; Bulleted</button><button data-v="ol" title="Numbered list">1. Numbered</button></div></div>
            <div class="insp-row"><label>Marker</label><div class="insp-field" data-prop="listStyleType"><select id="inspListMarker"></select><i class="insp-clear" role="button" tabindex="0" title="Use the deck's value">&times;</i></div></div>
            <div class="insp-row" id="inspListStartRow"><label>Starts at</label><div class="insp-field" data-prop="_start"><input type="number" id="inspListStart" min="1" step="1" title="The first number, for a list that carries on from another slide. Saved as the start attribute."><i class="insp-clear" role="button" tabindex="0" title="Start at 1">&times;</i></div></div>
            <div class="insp-hint">Editing the text: Enter makes the next item, Tab makes it a sub-item, Shift+Tab brings it back out.</div>
          </section>

          <section class="insp-section" id="inspPicture" hidden>
            <h4>Picture</h4>
            <div class="insp-row"><label>Alt text</label><div class="insp-field" data-prop="_alt"><input type="text" id="inspAlt" placeholder="What the picture shows" spellcheck="true" title="Read out by screen readers, shown when the picture does not load, and carried into the PDF. Leave it empty for a decorative picture."><i class="insp-clear" role="button" tabindex="0" title="Remove the alt text">&times;</i></div></div>
            <div id="inspMediaRows">
              <div class="insp-row"><label>File</label><div class="insp-btns" style="margin:0"><button class="mini-btn" data-act="replace-image" title="Another picture in the same box">Replace...</button><span class="insp-src" id="inspSrc"></span></div></div>
              <div class="insp-row" id="inspCropRow"><label>Crop</label><div class="insp-btns" style="margin:0"><button class="mini-btn" data-act="crop" title="Choose the part of the picture that shows: drag the picture, the handles, the corners (or double-click the picture, or Enter)">Crop...</button><button class="mini-btn" data-act="uncrop" id="inspUncrop" title="The whole picture again, in this place and width">Remove crop</button></div></div>
              <div class="insp-row" id="inspFitRow2"><label>Fit</label><div class="insp-field" data-prop="objectFit"><select id="inspFit"><option value="">Stretch to the box</option><option value="cover">Fill the box, cropping the edges</option><option value="contain">Whole picture inside the box</option></select><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
              <div class="insp-row" id="inspFocusRow"><label>Focus</label><div class="insp-focus" id="inspFocus" title="Which part of the picture stays in view when the edges are cropped">${['left top', 'center top', 'right top', 'left center', 'center center', 'right center', 'left bottom', 'center bottom', 'right bottom'].map(v => `<button data-focus="${v}" title="${v}"></button>`).join('')}</div></div>
              <div class="insp-row"><label>Flip</label><div class="insp-seg" id="inspFlip"><button data-flip="x" title="Flip left to right">&#8596;</button><button data-flip="y" title="Flip top to bottom">&#8597;</button></div></div>
              <div class="insp-row"><label>Grayscale</label><div class="insp-field insp-range" data-prop="_grayscale"><input type="range" id="inspGray" min="0" max="100" step="5"><span id="inspGrayV" class="unit"></span><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            </div>
          </section>
          <section class="insp-section" id="inspChart" hidden></section>
          <section class="insp-section" id="inspMath" hidden></section>
          <section class="insp-section" id="inspChem" hidden></section>

          <section class="insp-section" id="inspColour">
            <h4>Colour</h4>
            <div class="insp-seg" id="inspColourTarget">
              <button data-t="text">Text</button><button data-t="fill">Fill</button><button data-t="border">Border</button>
            </div>
            <div class="insp-swatches" id="inspSwatches"></div>
            <div class="insp-recent" id="inspRecent"></div>
            <div class="insp-colour">
              <input type="color" id="inspPick" title="Pick a colour">
              <input type="text" id="inspHex" placeholder="#rrggbb" spellcheck="false">
              <button class="mini-btn" data-act="nocolour" title="Remove this colour">none</button>
            </div>
          </section>

          <section class="insp-section" id="inspType">
            <h4>Text</h4>
            <div class="insp-row"><label>Font</label><div class="insp-field" data-prop="fontFamily"><button type="button" id="inspFont" class="insp-fontbtn" title="Choose a font"></button><i class="insp-clear" role="button" tabindex="0" title="Use the deck's value">&times;</i></div></div>
            <div class="insp-row"><label>Size</label><div class="insp-field" data-prop="fontSize"><input type="number" id="inspSize" min="4" max="600" step="1"><span class="unit">px</span><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            <div class="insp-row"><label>Weight</label><div class="insp-field" data-prop="fontWeight"><select id="inspWeight"><option value="">default</option></select><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            <div class="insp-row"><label>Style</label><div class="insp-field insp-seg" data-prop="fontStyle" id="inspStyle"><button data-v="italic" title="Italic"><i>I</i></button><button data-v="uppercase" title="Uppercase">AB</button><button data-v="capitalize" title="Capitalise each word">Ab</button><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            <div class="insp-row"><label>Line height</label><div class="insp-field" data-prop="lineHeight"><input type="number" id="inspLine" min="0.5" max="4" step="0.05"><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            <div class="insp-row"><label>Spacing</label><div class="insp-field" data-prop="letterSpacing"><input type="number" id="inspTrack" min="-20" max="100" step="0.5"><span class="unit">px</span><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            <div class="insp-row"><label>Align</label><div class="insp-field insp-seg" data-prop="textAlign" id="inspAlign"><button data-v="left" title="Left">&#8676;</button><button data-v="center" title="Centre">&#8596;</button><button data-v="right" title="Right">&#8677;</button><button data-v="justify" title="Justify">&#8801;</button><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
            <div id="inspFitRow" hidden>
              <label class="align-toslide" title="When the text overflows its box, the size steps down until it fits, and back up when there is room again; the size above is the most it gets. Saved as data-fit."><input type="checkbox" id="inspFitText"> <span>Shrink to fit the box</span></label>
            </div>
          </section>

          <section class="insp-section" data-fold="box">
            <h4>Box</h4>
            <div class="insp-row2">
              <div class="insp-field" data-prop="width"><label>W</label><input type="number" id="inspW" min="1" step="1"><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div>
              <div class="insp-field" data-prop="height"><label>H</label><input type="number" id="inspH" min="1" step="1"><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div>
            </div>
            <div class="insp-row2">
              <div class="insp-field" data-prop="padding"><label>Padding</label><input type="number" id="inspPad" min="0" step="1"><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div>
              <div class="insp-field" data-prop="borderRadius"><label>Radius</label><input type="number" id="inspRadius" min="0" step="1"><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div>
            </div>
            <div class="insp-row2">
              <div class="insp-field" data-prop="borderWidth"><label>Border</label><input type="number" id="inspBorder" min="0" step="1"><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div>
              <div class="insp-field" data-prop="boxShadow"><label>Shadow</label><select id="inspShadow"><option value="">none</option><option value="soft">soft</option><option value="medium">medium</option><option value="hard">hard</option></select><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div>
            </div>
            <div class="insp-row"><label>Opacity</label><div class="insp-field insp-range" data-prop="opacity"><input type="range" id="inspOpacity" min="0" max="1" step="0.05"><span id="inspOpacityV" class="unit"></span><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div></div>
          </section>

          <section class="insp-section" data-fold="align">
            <h4>Align</h4>
            <div class="align-bar">
              <div class="align-group">
                <button data-align="left" title="Align left"><svg viewBox="0 0 20 20"><path d="M3 2v16"/><rect x="5" y="5" width="11" height="4" rx="1"/><rect x="5" y="11" width="7" height="4" rx="1"/></svg></button>
                <button data-align="centre" title="Align horizontal centres"><svg viewBox="0 0 20 20"><path d="M10 2v16"/><rect x="4" y="5" width="12" height="4" rx="1"/><rect x="6.5" y="11" width="7" height="4" rx="1"/></svg></button>
                <button data-align="right" title="Align right"><svg viewBox="0 0 20 20"><path d="M17 2v16"/><rect x="4" y="5" width="11" height="4" rx="1"/><rect x="8" y="11" width="7" height="4" rx="1"/></svg></button>
              </div>
              <div class="align-group">
                <button data-align="top" title="Align top"><svg viewBox="0 0 20 20"><path d="M2 3h16"/><rect x="5" y="5" width="4" height="11" rx="1"/><rect x="11" y="5" width="4" height="7" rx="1"/></svg></button>
                <button data-align="middle" title="Align vertical middles"><svg viewBox="0 0 20 20"><path d="M2 10h16"/><rect x="5" y="4" width="4" height="12" rx="1"/><rect x="11" y="6.5" width="4" height="7" rx="1"/></svg></button>
                <button data-align="bottom" title="Align bottom"><svg viewBox="0 0 20 20"><path d="M2 17h16"/><rect x="5" y="4" width="4" height="11" rx="1"/><rect x="11" y="8" width="4" height="7" rx="1"/></svg></button>
              </div>
              <div class="align-group">
                <button data-distribute="x" title="Distribute horizontally (equal gaps)"><svg viewBox="0 0 20 20"><path d="M2 2v16M18 2v16"/><rect x="5" y="6" width="3" height="8" rx="1"/><rect x="12" y="6" width="3" height="8" rx="1"/></svg></button>
                <button data-distribute="y" title="Distribute vertically (equal gaps)"><svg viewBox="0 0 20 20"><path d="M2 2h16M2 18h16"/><rect x="6" y="5" width="8" height="3" rx="1"/><rect x="6" y="12" width="8" height="3" rx="1"/></svg></button>
              </div>
            </div>
            <label class="align-toslide"><input type="checkbox" id="inspAlignSlide"> <span>Align to the slide</span> <span class="insp-hint insp-state" id="inspAlignHint"></span></label>
          </section>

          <section class="insp-section" data-fold="anim">
            <h4>Animation <button class="mini-btn" data-act="anim-play" title="Replay the entrance of this element" style="float:right">&#9654; Play</button></h4>
            <div class="anim-now" id="animNow"></div>
            <div class="anim-grid" id="animGrid"></div>
            <div class="anim-timing" id="animTiming">
              <div class="insp-field" data-prop="_animDur"><label id="animDurLabel">Duration</label><input type="number" id="animDur" min="0.1" max="120" step="0.1"><span class="unit">s</span></div>
              <div class="insp-field" data-prop="_animDelay"><label>Delay</label><input type="number" id="animDelay" min="0" max="20" step="0.1"><span class="unit">s</span></div>
              <div class="insp-field" data-prop="_animEase"><select id="animEase"></select></div>
            </div>
            <div class="insp-row" id="animTextRow"><label>Text effect</label><div class="insp-field" data-prop="_textFx"><select id="animTextFx"></select></div></div>
            <div class="insp-row" id="animDeckRow"><label>Reveal order</label><div class="insp-field" data-prop="_i" title="When it comes in, among the deck's own entrances on this slide: 0 first, then 1, 2 ..."><input type="number" id="animIndex" min="0" max="40" step="1"></div></div>
            <div class="anim-fragment">
              <label class="align-toslide"><input type="checkbox" id="animFragment"> <span>Reveal on click</span></label>
              <div class="insp-field" data-prop="_fragIndex" id="animFragIndexField"><label>Order</label><input type="number" id="animFragIndex" min="0" max="99" step="1" placeholder="auto"></div>
            </div>
            <div class="insp-hint insp-state" id="animFragHint"></div>
            <div class="insp-row" id="animMorphRow" hidden><label>Morph from</label><div class="insp-field" data-prop="_morph" title="The previous slide auto-animates into this one: this element travels and reshapes out of the one chosen there (a shape into a shape, a colour into a colour; two that do not look alike cross-fade)."><select id="animMorph"></select></div></div>
            <div class="insp-hint" id="animMorphHint" hidden>This element takes the place of the one chosen on the previous slide.</div>
          </section>

          <details class="insp-section insp-code" id="inspCode">
            <summary><h4>Code</h4></summary>
            <div class="insp-hint">The element's markup and the CSS that styles it.</div>
            <div class="insp-code-label">HTML</div>
            <textarea id="inspCodeHtml" class="insp-notes theme-css" rows="6" spellcheck="false" title="The element's markup: change it and it is replaced (one element, its contents included)"></textarea>
            <div class="insp-code-label">Styles from the deck</div>
            <pre class="insp-code-pre" id="inspCodeRules" tabindex="0" title="Click, then Ctrl+A and Ctrl+C to copy"></pre>
            <div class="insp-code-label">CSS for this element</div>
            <textarea id="inspCodeCss" class="insp-notes theme-css" rows="7" spellcheck="false" placeholder="Declarations for this element, and @keyframes / @media rules of their own" title="Declarations go on the element, @-rules (keyframes, media) stand on their own. Saved as data-css and written into the deck's style block on save; a copy of the element takes it along."></textarea>
            <label class="align-toslide"><input type="checkbox" id="inspCodeLive"> <span>Plays while editing too</span></label>
            <div class="insp-hint">Starts as the deck's CSS for this element, with its animation and keyframes; change it and it is the element's own (keyframes included: the rest of the deck keeps the originals).</div>
          </details>
          <section class="insp-section" data-fold="pos">
            <h4>Position</h4>
            <div class="insp-row2">
              <div class="insp-field" data-prop="_x"><label>X</label><input type="number" id="inspX" step="1"><i class="insp-clear" role="button" tabindex="0" title="Back to where the deck puts it">&times;</i></div>
              <div class="insp-field" data-prop="_y"><label>Y</label><input type="number" id="inspY" step="1"><i class="insp-clear" role="button" tabindex="0" title="Back to where the deck puts it">&times;</i></div>
            </div>
            <div class="insp-row2">
              <div class="insp-field" data-prop="rotate"><label>Rotate</label><input type="number" id="inspRot" step="1"><span class="unit">&deg;</span><i class="insp-clear" role="button" tabindex="0" aria-label="Back to the deck's value" title="Back to the deck's value">&times;</i></div>
              <div class="insp-field insp-seg" data-prop="zIndex"><button data-act="forward" title="Bring forward one step (Ctrl+])">&#9650;</button><button data-act="backward" title="Send backward one step (Ctrl+[)">&#9660;</button><button data-act="front" title="Bring to front (Ctrl+Shift+])">Front</button><button data-act="back" title="Send to back (Ctrl+Shift+[)">Back</button></div>
            </div>
            <div class="insp-hint insp-state" id="inspPosHint"></div>
          </section>

          <section class="insp-section" data-fold="link">
            <h4>Link</h4>
            <div class="insp-row"><label>Address</label><div class="insp-field" data-prop="_href"><input type="text" id="inspHref" placeholder="https://..." spellcheck="false" title="A click on the element opens the address in a new tab when presenting. Needs the presentation features (Presenter menu). Links inside text are set while editing the text."><i class="insp-clear" role="button" tabindex="0" title="Remove the link">&times;</i></div></div>
            <div class="insp-hint" id="inspHrefHint">Opens in a new tab when presenting.</div>
          </section>

          <section class="insp-section" id="inspUnhide">
            <div class="insp-btns"><button class="mini-btn" data-act="unhide">Unhide all on this slide</button></div>
          </section>
        </div>`;
        this.$ = (id) => this.root.querySelector('#' + id);
        // Tooltips say what a field does; how it is written into the file is in REFERENCE.md.
        this.root.querySelectorAll('[title]').forEach(n => {
            n.title = n.title.replace(/\s*Saved as [^.]*\.|;?\s*saved as [^.;]*/g, '').trim();
        });
        this._setupFolding();
    }

    /* Sections a slide tool keeps out of the way until asked (running by itself, box, align,
       animation, position, link) fold: their heading opens and closes them and, folded, says in a few
       words what is set. What is folded is remembered per browser (none, the first time, but
       these). */
    _setupFolding() {
        let folded;
        try { folded = JSON.parse(localStorage.getItem(FOLD_KEY)); } catch (e) { folded = null; }
        if (!Array.isArray(folded)) folded = FOLDED_FIRST;
        this.root.querySelectorAll('.insp-section[data-fold]').forEach(sec => {
            const h = sec.querySelector(':scope > h4');
            const play = h.querySelector('[data-act]');
            if (play) play.insertAdjacentHTML('beforebegin', '<span class="insp-sum"></span>');
            else h.insertAdjacentHTML('beforeend', '<span class="insp-sum"></span>');
            h.setAttribute('role', 'button');
            h.tabIndex = 0;
            const set = (on) => {
                sec.classList.toggle('folded', on);
                h.setAttribute('aria-expanded', String(!on));
            };
            set(folded.includes(sec.dataset.fold));
            const toggle = (e) => {
                if (e.target.closest('[data-act]')) return;           // the Play button in the Animation heading
                set(!sec.classList.contains('folded'));
                const now = Array.from(this.root.querySelectorAll('.insp-section.folded[data-fold]')).map(x => x.dataset.fold);
                try { localStorage.setItem(FOLD_KEY, JSON.stringify(now)); } catch (err) { /* private window */ }
            };
            h.addEventListener('click', toggle);
            h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
        });
    }
    _summary(key, text) {
        const sum = this.root.querySelector(`.insp-section[data-fold="${key}"] .insp-sum`);
        if (sum) sum.textContent = text ? text : '';
    }

    /* ------------------------------------------------------------
       Wiring
       ------------------------------------------------------------ */
    _bind() {
        const r = this.root;
        this.selection.addEventListener('change', () => this.sync());
        // A double-click on a chart goes to its table.
        this.selection.addEventListener('edit-text', (e) => { if (chartOf(e.detail.el)) { this.sync(); this.chart.focusData(); } });
        this.selection.addEventListener('edit-text', (e) => { if (mathOf(e.detail.el)) { this.sync(); this.math.focus(); } else if (chemOf(e.detail.el)) { this.sync(); this.chem.focus(); } });
        this.history.addEventListener('change', () => { if (!this.pending) this.sync(); });
        this.deck.addEventListener('ready', () => { this.swatches = null; this.sync(); });
        this.deck.addEventListener('overrides', () => { this.swatches = null; this.sync(); });
        this.deck.addEventListener('fonts', () => { if (!this.syncing) this.sync(); });

        r.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (b) return this._act(b.dataset.act);
            const clear = e.target.closest('.insp-clear');
            if (clear) return this._clear(clear.closest('.insp-field').dataset.prop);
            const t = e.target.closest('#inspColourTarget button');
            if (t) { this.colourTarget = t.dataset.t; this.sync(); return; }
            const sw = e.target.closest('.insp-swatch');
            if (sw) return this.applyColour(sw.dataset.c, true);
            const al = e.target.closest('#inspAlign button');
            if (al) return this._commitStyle('Align', (el) => { el.style.textAlign = al.dataset.v; });
            const ab = e.target.closest('[data-align]');
            if (ab) return this.selection.align(ab.dataset.align, { toSlide: this.$('inspAlignSlide').checked });
            const db = e.target.closest('[data-distribute]');
            if (db) return this.selection.distribute(db.dataset.distribute);
        });

        // Number and select fields: preview while typing/dragging, one undo step on change.
        this._num('inspSize', 'fontSize', 'px', null, true);
        this._num('inspLine', 'lineHeight', '');
        this._num('inspTrack', 'letterSpacing', 'px', null, true);
        this._num('inspPad', 'padding', 'px');
        this._num('inspRadius', 'borderRadius', 'px');
        this._num('inspOpacity', 'opacity', '', () => { this.$('inspOpacityV').textContent = Math.round(this.$('inspOpacity').value * 100) + '%'; });
        this._num('inspW', 'width', 'px', (el) => afterResize(el));
        this._num('inspH', 'height', 'px', (el) => afterResize(el));
        this._field('inspBorder', (el, v) => {
            el.style.borderWidth = v === '' ? '' : v + 'px';
            if (v !== '' && +v > 0 && css(el).borderStyle === 'none') el.style.borderStyle = 'solid';
        }, 'Border');
        this.$('inspWeight').addEventListener('change', () => {
            if (this.syncing || !this.el) return;
            const v = this.$('inspWeight').value;
            const part = this.typePart();
            this.history.begin('Change font weight');
            if (v) for (const el of (part ? [part] : this.items)) ensureGoogle(this.deck, this.history, firstFamily(css(el).fontFamily), [+v], css(el).fontStyle === 'italic' ? [+v] : []);
            if (!this._typeSelection({ fontWeight: v })) this._commitStyle('Change font weight', (el) => { el.style.fontWeight = v; });
            this.history.end();
        });
        this.$('inspFont').addEventListener('click', () => {
            if (!this.el) return;
            const src = this.typePart() || this.el;
            this.app.fontPicker.open(this.$('inspFont'), {
                current: src.style.fontFamily || css(src).fontFamily,
                onPick: (stack, name) => {
                    const part = this.typePart();
                    this.history.begin('Change font');
                    const weights = new Set([400, 700]), italics = new Set();
                    for (const el of (part ? [part] : this.items)) { const c = css(el); weights.add(+c.fontWeight || 400); if (c.fontStyle === 'italic') italics.add(+c.fontWeight || 400); }
                    ensureGoogle(this.deck, this.history, name, [...weights], [...italics]);
                    // Part of the text selected: only that part changes font.
                    if (!this._typeSelection({ fontFamily: stack })) this._commitStyle('Change font', (el) => { el.style.fontFamily = stack; });
                    this.history.end();
                },
            });
        });
        this.$('inspStyle').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-v]'); if (!b || !this.el) return;
            const v = b.dataset.v, on = b.classList.contains('on'), part = this.typePart();
            this.history.begin('Text style');
            if (v === 'italic') {
                if (!on) for (const el of (part ? [part] : this.items)) ensureGoogle(this.deck, this.history, firstFamily(css(el).fontFamily), [], [+css(el).fontWeight || 400]);
                if (!this._typeSelection({ fontStyle: on ? '' : 'italic' })) this._commitStyle('Italic', (el) => { el.style.fontStyle = on ? '' : 'italic'; });
            } else if (!this._typeSelection({ textTransform: on ? '' : v })) this._commitStyle('Text case', (el) => { el.style.textTransform = on ? '' : v; });
            this.history.end();
        });
        // List: bulleted or numbered, the marker, and the number it starts at.
        this.$('inspListKind').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-v]'); const list = this._list();
            if (!b || !list || list.tagName.toLowerCase() === b.dataset.v) return;
            this.selection.set([setListKind(this.history, list, b.dataset.v === 'ol')]);
        });
        this.$('inspListMarker').addEventListener('change', () => {
            const list = this._list(); if (!list || this.syncing) return;
            const v = this.$('inspListMarker').value;
            this.history.begin('List marker');
            this.history.style(list, (el) => { el.style.listStyleType = v; }, { label: 'List marker' });
            // An imported list carries the marker on every item, which would win over the list's.
            for (const li of list.children) if (li.style.listStyleType) this.history.style(li, clearMarker, { label: 'List marker' });
            this.history.end();
            this.sync();
        });
        this.$('inspListStart').addEventListener('change', () => {
            const list = this._list(); if (!list || this.syncing) return;
            const v = parseInt(this.$('inspListStart').value, 10);
            this.history.attr(list, 'start', v > 1 ? String(v) : null, 'List start');
            this.sync();
        });

        this._select('inspShadow', 'boxShadow', (v) => SHADOWS[v] || '');
        // X and Y are the element's place on the slide; the move is written as the difference to where the deck puts it.
        this._field('inspX', (el, v) => { const o = getOffset(el), r = this.deck.stageRect(el); setOffset(el, o.x + ((+v || 0) - Math.round(r.x)), o.y); }, 'Move');
        this._field('inspY', (el, v) => { const o = getOffset(el), r = this.deck.stageRect(el); setOffset(el, o.x, o.y + ((+v || 0) - Math.round(r.y))); }, 'Move');
        this._field('inspRot', (el, v) => setRotation(el, +v || 0), 'Rotate');

        // Animation
        this.deck.animationCssProvider = animationCss;
        // None first, then the presets in alphabetical order of their labels.
        const presets = Object.entries(PRESETS).sort(([, a], [, b]) => a.label.localeCompare(b.label, 'en'));
        this.$('animGrid').innerHTML = '<button data-anim="" class="on">None</button>' + presets.map(([n, p]) => `<button data-anim="${n}">${p.label}${p.loop ? '<i title="Loops">&#8734;</i>' : ''}</button>`).join('');
        this.$('animEase').innerHTML = Object.entries(EASES).map(([v, l]) => `<option value="${escapeAttr(v)}">${l}</option>`).join('');
        this.$('animGrid').addEventListener('click', (e) => {
            const b = e.target.closest('[data-anim]'); if (!b || !this.el) return;
            const name = b.dataset.anim;
            for (const el of this.items) applyPreset(this.history, this.deck, el, name || null, this.revealClasses());
            this.sync();
            if (name) replay(this.deck, null);
        });
        const timing = () => {
            for (const el of this.items) setTiming(this.history, el, { duration: this.$('animDur').value, delay: this.$('animDelay').value, ease: this.$('animEase').value });
        };
        ['animDur', 'animDelay'].forEach(id => { this.$(id).addEventListener('change', () => { if (!this.syncing) { timing(); replay(this.deck, null); } }); });
        this.$('animEase').addEventListener('change', () => { if (!this.syncing) { timing(); replay(this.deck, null); } });
        this._field('animIndex', (el, v) => { if (v === '') el.style.removeProperty('--i'); else el.style.setProperty('--i', v); }, 'Delay index');
        // Code: CSS of the user's own for the element (data-css), applied through the override block at once.
        const codeChange = (label, fn) => {
            if (this.syncing || !this.el) return;
            this.history.begin(label);
            for (const el of this.items) fn(el);
            this.history.end();
            this.deck.refreshAnimations();
            this.sync();
        };
        this.$('inspCodeCss').addEventListener('change', () => {
            // Left as the deck's own declarations (the starting text), it is nothing of the element's.
            const v = this.$('inspCodeCss').value.trim();
            if (this.el && !this.el.hasAttribute('data-css') && v === (this._codeStart || '').trim()) return;
            this.$('inspCodeCss').blur();                                    // so the sync after the change refills the box
            codeChange('Element CSS', (el) => {
                if (v && !el.hasAttribute('data-id')) this.history.attr(el, 'data-id', uniqueId(this.deck.doc), 'Element CSS');
                this.history.attr(el, 'data-css', v || null, 'Element CSS');
            });
        });
        this.$('inspCodeCss').addEventListener('input', () => this.$('inspCodeCss').classList.remove('insp-code-start'));
        // The markup, changed: the element is replaced by what was typed (one element), and selected again.
        this.$('inspCodeHtml').addEventListener('change', () => {
            if (this.syncing || !this.el) return;
            const el = this.el, doc = this.deck.doc, html = this.$('inspCodeHtml').value.trim();
            if (!html || html === el.outerHTML.replace(/\sdata-ed-ground=""/g, '')) return;
            const svgChild = el.namespaceURI === 'http://www.w3.org/2000/svg' && el.tagName.toLowerCase() !== 'svg';
            const tpl = doc.createElement('template');
            tpl.innerHTML = svgChild ? '<svg>' + html + '</svg>' : html;
            const root = svgChild ? tpl.content.firstElementChild : tpl.content;
            const nodes = root ? Array.from(root.childNodes).filter(n => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())) : [];
            if (nodes.length !== 1 || nodes[0].nodeType !== 1) { this.app.toast('The HTML has to be one element (with whatever is inside it)', { error: true }); this.$('inspCodeHtml').blur(); this._syncCode(el); return; }
            const fresh = nodes[0];
            for (const n of [fresh, ...fresh.querySelectorAll('*')]) { n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck'); n.removeAttribute('data-ed-ground'); }
            this.$('inspCodeHtml').blur();
            this.history.begin('Edit HTML');
            this.history.insert(fresh, el.parentNode, el, 'Edit HTML');
            this.history.remove(el, 'Edit HTML');
            this.history.end();
            this.deck.refreshAnimations();
            this.selection.select(fresh);
        });
        this.$('inspCodeHtml').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this._syncCode(this.el); this.$('inspCodeHtml').blur(); } });
        // The rules cell is read-only: Ctrl+A selects its text (the editor's Ctrl+A leaves it alone).
        for (const id of ['inspCodeRules']) {
            this.$(id).addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
                    e.preventDefault(); e.stopPropagation();
                    const r = document.createRange(); r.selectNodeContents(this.$(id));
                    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
                }
            });
        }
        this.$('inspCodeLive').addEventListener('change', () => codeChange('Element CSS', (el) => this.history.attr(el, 'data-css-live', this.$('inspCodeLive').checked ? '' : null, 'Element CSS')));
        this.$('inspCode').addEventListener('toggle', () => { this._codeOpen = this.$('inspCode').open; if (this._codeOpen && this.el) this._syncCode(this.el); });
        this.$('inspName').addEventListener('change', () => {
            if (this.syncing || !this.el) return;
            const v = this.$('inspName').value.trim();
            this.history.begin('Rename');
            for (const el of this.items) this.history.attr(el, 'data-name', v || null, 'Rename');
            this.history.end();
            this.sync();
        });
        this.$('inspName').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); this.$('inspName').blur(); } });
        this.$('animMorph').addEventListener('change', () => {
            if (this.syncing || !this.el) return;
            const el = this.el, prev = this._prevSlide();
            const v = this.$('animMorph').value;
            const source = v === '' ? null : this._morphCandidates(prev)[+v];
            if (v !== '' && !source) return;
            this.history.begin('Morph from');
            let id;
            if (source) {
                // The one chosen keeps (or gets) its id; this element takes the same, and no other element here has it.
                id = source.getAttribute('data-id') || this._uniqueId();
                if (!source.hasAttribute('data-id')) this.history.attr(source, 'data-id', id, 'Morph from');
                for (const other of this.deck.currentSlide.querySelectorAll('[data-id]')) if (other !== el && other.getAttribute('data-id') === id) this.history.attr(other, 'data-id', this._uniqueId(), 'Morph from');
            } else {
                id = this._uniqueId();          // its own id again: linked to nothing on the previous slide
            }
            this.history.attr(el, 'data-id', id, 'Morph from');
            this.history.end();
            this.sync();
        });
        this.$('animFragment').addEventListener('change', () => {
            if (this.syncing) return;
            const on = this.$('animFragment').checked;
            for (const el of this.items) setFragment(this.history, this.deck, el, on, this.$('animFragIndex').value, this.revealClasses());
            this.sync();
        });
        this.$('animFragIndex').addEventListener('change', () => {
            if (this.syncing) return;
            const v = this.$('animFragIndex').value;
            this.history.begin('Fragment order');
            for (const el of this.items) if (el.hasAttribute('data-fragment')) this.history.attr(el, 'data-fragment-index', v === '' ? null : String(+v), 'Fragment order');
            this.history.end();
            this.sync();
        });
        this.$('inspShowMaster').addEventListener('change', () => {
            if (this.syncing) return;
            const s = this.deck.currentSlide; if (!s) return;
            const show = this.$('inspShowMaster').checked;
            this.history.attr(s, 'data-no-master', show ? null : '', show ? 'Show master on slide' : 'Hide master on slide');
            this.deck.refreshAnimations();      // the override block carries the rule that hides it
        });
        this.$('inspAutoAnimate').addEventListener('change', () => {
            if (this.syncing) return;
            const s = this.deck.currentSlide; if (!s) return;
            const on = this.$('inspAutoAnimate').checked;
            this.history.begin(on ? 'Auto-animate on' : 'Auto-animate off');
            this.history.attr(s, 'data-auto-animate', on ? '' : null, 'Auto-animate');
            if (on) this._assignIds(s);
            this.history.end();
            this.app.toast(on ? 'Elements got data-id tags. Duplicate this slide (Ctrl+D) and rearrange the copy.' : 'Auto-animate removed from this slide', { ms: 4000 });
        });

        this.$('inspPick').addEventListener('input', () => this.applyColour(this.$('inspPick').value, false));
        this.$('inspPick').addEventListener('change', () => this.applyColour(this.$('inspPick').value, true));
        this.$('inspHex').addEventListener('change', () => {
            let v = this.$('inspHex').value.trim();
            if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
            if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(v)) this.applyColour(v, true); else this.sync();
        });
        this.$('inspHex').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.$('inspHex').blur(); } });

        // Slide section
        this.$('inspSlideBg').addEventListener('input', () => this.applySlideBg(this.$('inspSlideBg').value, false));
        this.$('inspSlideBg').addEventListener('change', () => this.applySlideBg(this.$('inspSlideBg').value, true));
        this.$('inspSlideBgHex').addEventListener('change', () => {
            let v = this.$('inspSlideBgHex').value.trim();
            if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
            if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(v)) this.applySlideBg(v, true); else this.sync();
        });
        r.querySelector('#inspSlideSwatches').addEventListener('click', (e) => {
            const sw = e.target.closest('.insp-swatch'); if (sw) this.applySlideBg(sw.dataset.c, true);
        });
        this.$('inspSlideName').addEventListener('change', () => {
            const s = this.deck.currentSlide; if (!s) return;
            const v = this.$('inspSlideName').value.trim();
            this.history.attr(s, 'data-name', v || null, 'Rename slide');
            this.app.strip.renumber(); this.app.strip.refreshCurrent();
        });
        this.$('inspSlideName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
        this.$('inspSection').addEventListener('change', () => {
            const s = this.deck.currentSlide; if (!s) return;
            const v = this.$('inspSection').value.trim();
            if ((s.getAttribute('data-section') || '') === v) return;      // blur after a change fires again with the same value
            this.history.attr(s, 'data-section', v || null, v ? 'Start section' : 'Remove section');
            this.app.strip.syncStructure();
        });
        this.$('inspSection').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
        // Running by itself: this slide's wait, the deck's, and the loop.
        const advance = (id, target) => this.$(id).addEventListener('change', () => {
            if (this.syncing) return;
            const v = this.$(id).value.trim();
            const el = target === 'deck' ? this.deck.stage : this.deck.currentSlide;
            if (!el) return;
            this.history.attr(el, 'data-auto-advance', v ? String(+v) : null, 'Runs on');
            this.sync();
        });
        advance('inspAdvance', 'slide'); advance('inspAdvanceDeck', 'deck');
        this.$('inspLoop').addEventListener('change', () => {
            if (this.syncing || !this.deck.stage) return;
            this.history.attr(this.deck.stage, 'data-loop', this.$('inspLoop').checked ? '' : null, 'Start again at the end');
            this.sync();
        });
        this.$('inspAlt').addEventListener('change', () => { if (!this.syncing) this.setAlt(this.$('inspAlt').value); });
        // Picture: fit and focus (object-fit / object-position), flip (the scale property, which
        // nothing else uses on a picture), grayscale (a filter term), and another file in the box.
        this._field('inspFit', (el, v) => { el.style.objectFit = v; }, 'Fit');
        this.$('inspFitText').addEventListener('change', () => {
            if (this.syncing) return;
            const on = this.$('inspFitText').checked;
            this.history.begin(on ? 'Shrink to fit' : 'No shrink to fit');
            for (const el of this.items) {
                if (on) {
                    this.history.attr(el, 'data-fit-size', el.style.fontSize || '', 'Shrink to fit');
                    this.history.attr(el, 'data-fit', 'shrink', 'Shrink to fit');
                    this.history.style(el, () => fitText(el), { label: 'Shrink to fit' });
                } else {
                    const base = el.getAttribute('data-fit-size') || '';
                    this.history.style(el, () => { el.style.fontSize = base; }, { label: 'No shrink to fit' });
                    this.history.attr(el, 'data-fit', null, 'No shrink to fit');
                    this.history.attr(el, 'data-fit-size', null, 'No shrink to fit');
                }
            }
            this.history.end();
            this.sync();
        });
        this.$('inspFocus').addEventListener('click', (e) => {
            const b = e.target.closest('[data-focus]'); if (!b) return;
            this._commitStyle('Focus', (el) => { el.style.objectPosition = b.dataset.focus === 'center center' ? '' : b.dataset.focus; });
        });
        this.$('inspFlip').addEventListener('click', (e) => {
            const b = e.target.closest('[data-flip]'); if (!b) return;
            this._commitStyle('Flip', (el) => {
                const f = Inspector.flipOf(el);
                if (b.dataset.flip === 'x') f.x = !f.x; else f.y = !f.y;
                el.style.scale = f.x || f.y ? `${f.x ? -1 : 1} ${f.y ? -1 : 1}` : '';
            });
        });
        this._field('inspGray', (el, v) => { Inspector.setGray(el, +v || 0); this.$('inspGrayV').textContent = (+v || 0) + '%'; }, 'Grayscale');
        this.$('inspAlt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
        this.$('inspHref').addEventListener('change', () => { if (!this.syncing) this.setLink(this.$('inspHref').value); });
        this.$('inspHref').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
        this.$('inspTransition').addEventListener('change', () => {
            if (this.syncing) return;
            const s = this.deck.currentSlide; if (!s) return;
            const v = this.$('inspTransition').value;
            this.history.attr(s, 'data-transition', v || null, 'Slide transition');
            this.sync();
        });
        this.$('inspTransitionDeck').addEventListener('change', () => {
            if (this.syncing) return;
            const v = this.$('inspTransitionDeck').value;
            this.history.attr(this.deck.stage, 'data-transition', v || null, 'Deck transition');
            this.sync();
        });
        this.$('animTextFx').innerHTML = Object.entries(TEXT_EFFECTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
        this.$('animTextFx').addEventListener('change', () => {
            if (this.syncing) return;
            const kind = this.$('animTextFx').value;
            for (const el of this.items) if (isEditableText(el) || el.matches('ul, ol')) setTextEffect(this.history, this.deck, el, kind, this.revealClasses());
            this.sync();
            if (kind && !replay(this.deck, this.el)) this.app.toast('Text effects run in the presentation: add the presentation features (Presenter menu) to see them here and in the saved file.', { ms: 6000 });
        });
        this.$('inspNotes').addEventListener('change', () => this.applyNotes(this.$('inspNotes').value));
        this.deck.addEventListener('slide', () => { if (!this.el) this.sync(); });
        // Enter commits and leaves the field so keyboard shortcuts work again.
        r.querySelectorAll('input[type=number]').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } }));
    }

    /* A numeric field bound to one style property. `inline` marks the ones that can apply to
       part of the text (see typePart) rather than the whole element. */
    _num(id, prop, unit, after, inline = false) {
        const label = 'Change ' + prop.replace(/([A-Z])/g, ' $1').toLowerCase();
        this._field(id, (el, v) => { el.style[prop] = v === '' ? '' : v + unit; if (after) after(el); }, label,
            inline ? (v) => ({ [prop]: v === '' ? '' : v + unit }) : null);
    }
    _select(id, prop, map) {
        const i = this.$(id);
        i.addEventListener('change', () => {
            if (this.syncing) return;
            const v = map ? map(i.value) : i.value;
            this._commitStyle('Change ' + prop.replace(/([A-Z])/g, ' $1').toLowerCase(), (el) => { el.style[prop] = v; });
        });
    }
    /* apply(el, value) runs on every selected element on input; the change is committed on
       change/blur. With `inline(value)` given, a selected part of the text takes it instead. */
    _field(id, apply, label, inline = null) {
        const i = this.$(id);
        const run = (commit) => {
            if (this.syncing) return;
            if (inline && this._typeSelection(inline(i.value))) return;
            this._preview(label, (el) => apply(el, i.value));
            if (commit) this._commit();
        };
        i.addEventListener('input', () => run(false));
        i.addEventListener('change', () => run(true));
        i.addEventListener('blur', () => this._commit());
    }

    /* ------------------------------------------------------------
       Applying changes: preview (pending) and commit (history)
       ------------------------------------------------------------ */
    _preview(label, fn) {
        const items = this.items; if (!items.length) return;
        if (!this.pending || this.pending.items.some((p, i) => p.el !== items[i]) || this.pending.items.length !== items.length) {
            this._commit();
            this.pending = { label, items: items.map(el => { this.history.remember(el); return { el, before: el.getAttribute('style') }; }) };
        }
        this.deck.withoutTransitions(() => items.forEach(fn));
        this.selection.refresh();
    }
    _commit() {
        const p = this.pending; if (!p) return;
        this.pending = null;
        const changed = p.items.filter(({ el, before }) => el.getAttribute('style') !== before);
        if (!changed.length) { this.sync(); return; }
        this.history.begin(p.label);
        for (const { el, before } of changed) this.history.push(styleCmd(el, before, el.getAttribute('style'), p.label));
        this.history.end();
        this.sync();
    }
    _commitStyle(label, fn) { this._preview(label, fn); this._commit(); }

    _clear(prop) {
        if (prop === 'listStyleType' || prop === '_start') {
            const list = this._list(); if (!list) return;
            if (prop === '_start') this.history.attr(list, 'start', null, 'List start');
            else this.history.style(list, clearMarker, { label: 'List marker' });
            this.sync();
            return;
        }
        // On part of the text, the x takes that property off the span around it.
        if (INLINE_PROPS[prop] && this._typeSelection(INLINE_PROPS[prop])) return;
        if (prop === '_href') { this.setLink(''); return; }
        if (prop === '_alt') { this.setAlt(''); return; }
        if (prop === '_advance' || prop === '_advanceDeck') {
            const el = prop === '_advance' ? this.deck.currentSlide : this.deck.stage;
            if (el) { this.history.attr(el, 'data-auto-advance', null, 'Runs on'); this.sync(); }
            return;
        }
        if (prop === '_grayscale') { this._commitStyle('Grayscale', (el) => Inspector.setGray(el, 0)); return; }
        this._commitStyle('Clear ' + prop.replace(/^_/, '').replace(/([A-Z])/g, ' $1').toLowerCase(), (el) => {
            if (prop === '_x') { const o = getOffset(el); setOffset(el, 0, o.y); }
            else if (prop === '_y') { const o = getOffset(el); setOffset(el, o.x, 0); }
            else if (prop === 'rotate') setRotation(el, 0);
            else if (prop === 'borderWidth') { el.style.borderWidth = ''; el.style.borderStyle = ''; }
            else if (prop === 'fontStyle') { el.style.fontStyle = ''; el.style.textTransform = ''; }
            else if (prop === 'width' || prop === 'height') { el.style[prop] = ''; if (el.tagName === 'IMG') { el.style.maxWidth = ''; el.style.maxHeight = ''; } afterResize(el); }
            else el.style[prop] = '';
        });
    }

    _act(act) {
        const sel = this.selection;
        switch (act) {
            case 'parent': sel.selectParent(); break;
            case 'child': sel.selectChild(); break;
            case 'text': if (this.el) sel.dispatchEvent(new CustomEvent('edit-text', { detail: { el: this.el } })); break;
            case 'hide': sel.hide(); break;
            case 'lock': sel.lock(!this.items.every(isLocked)); this.sync(); break;
            case 'reset': sel.resetStyles(); this.sync(); break;
            case 'unhide': { const n = sel.unhideAll(); this.app.toast(n ? n + ' hidden element(s) restored' : 'Nothing is hidden on this slide'); break; }
            case 'nocolour': this.applyColour('', true); break;
            case 'slidebg-none': this.applySlideBg('', true); break;
            case 'anim-play': if (!replay(this.deck, null)) this.app.toast('Text effects need the presentation features script (Presenter menu).', { ms: 5000 }); break;
            case 'front': this.app.editops.layer('front'); break;
            case 'back': this.app.editops.layer('back'); break;
            case 'forward': this.app.editops.layer('forward'); break;
            case 'backward': this.app.editops.layer('backward'); break;
            case 'delete': this.app.editops.remove(); break;
            case 'choose-image': case 'replace-image': if (this.el) window.dispatchEvent(new CustomEvent('editor:choose-image', { detail: pictureOf(this.el) || this.el })); break;
            case 'crop': if (this.el) this.app.cropper.start(this.el); break;
            case 'uncrop': if (this.el) this.app.cropper.uncrop(this.el); break;
            case 'row-add': { const t = this._table(); if (t) this.app.insert.tableAddRow(t); break; }
            case 'row-del': { const t = this._table(); if (t) this.app.insert.tableRemoveRow(t); break; }
            case 'col-add': { const t = this._table(); if (t) this.app.insert.tableAddColumn(t); break; }
            case 'col-del': { const t = this._table(); if (t) this.app.insert.tableRemoveColumn(t); break; }
        }
    }

    _table() { return this.el ? this.el.closest('table') : null; }
    /* The list the section works on: the one the selection is in (the list itself, or an item
       of it), or the single list inside it - a text box whose lines were made into a list is
       still a text box, with the list in it. */
    _list() {
        if (!this.el) return null;
        const up = this.el.closest('ul, ol');
        if (up) return up;
        const inside = Array.from(this.el.querySelectorAll('ul, ol'))
            .filter(l => { const p = l.parentElement && l.parentElement.closest('ul, ol'); return !p || !this.el.contains(p); });
        return inside.length === 1 ? inside[0] : null;
    }
    /* ------------------------------------------------------------
       Typography on part of the text. While text is edited in place with
       part of it selected, Font, Size, Weight, Style and Spacing change
       that part (a <span> around it) instead of the whole element, the way
       the colour fields already did. No history call: the change is inside
       the edit, which is one step when it commits.
       ------------------------------------------------------------ */
    /* The element the type fields show: the formatting of the selected part while editing,
       else the element selected on the slide. */
    typePart() {
        const te = this.app.textEdit;
        return te && te.active ? te.selectionElement() : null;
    }
    /* Put inline properties on the selected part; false when no part is selected. */
    _typeSelection(props) {
        const te = this.app.textEdit;
        return !!te && te.active && te.styleSelection(props);
    }

    /* A link on the selected elements: data-href, opened by the deck runtime on click. */
    setLink(url) {
        const v = normaliseUrl(url);
        if (!this.items.length) return;
        if (this.items.every(el => (el.getAttribute('data-href') || '') === v)) return;
        this.history.begin(v ? 'Link' : 'Remove link');
        for (const el of this.items) this.history.attr(el, 'data-href', v || null, 'Link');
        this.history.end();
        this.sync();
    }
    promptLink() {
        if (!this.el) return;
        const url = prompt('Link address (empty removes the link):', this.el.getAttribute('data-href') || 'https://');
        if (url === null) return;
        this.setLink(url === 'https://' ? '' : url);
    }


    /* Stable identities for auto-animate matching: data-id on the slide's elements that lack one. */
    _assignIds(slide) {
        for (const el of this._morphCandidates(slide)) {
            if (el.getAttribute('data-id')) continue;
            this.history.attr(el, 'data-id', this._uniqueId(), 'Auto-animate');
        }
    }
    /* What auto-animate can move: the leaves of a slide (text blocks, pictures, shapes, charts). */
    _morphCandidates(slide) {
        if (!slide) return [];
        const els = Array.from(slide.querySelectorAll('h1, h2, h3, h4, p, li, img, svg, div:empty, [data-edit], [data-fig], [data-svg], [data-id]')).filter(el => !el.closest(DRAWN) || el.matches(DRAWN));
        return els.filter(el => !(el.querySelector('[data-edit], h1, h2, h3, p, li') && !el.matches('[data-edit], h1, h2, h3, h4, p, li')));   // leaves only
    }
    _uniqueId() { return uniqueId(this.deck.doc); }
    _prevSlide() {
        const i = this.deck.current;
        return i > 0 ? this.deck.slides[i - 1] : null;
    }
    /* The Code section's read-only half: the element's markup, and every rule in the deck's own
       stylesheets that matches it (in sheet order, the later ones winning), with the @keyframes
       those rules or the computed style name. */
    _syncCode(el) {
        const $ = this.$, doc = this.deck.doc;
        if (document.activeElement !== $('inspCodeHtml')) $('inspCodeHtml').value = el.outerHTML.replace(/\sdata-ed-ground=""/g, '');
        // Every style rule in the deck's sheets, in order, then which match: as things are, and as
        // they are when presenting (the editing class off <html> for the check: a deck often keeps
        // its animations for the show, `html:not(.deck-editing) .marquee span { animation }`).
        const all = [], keyframes = {};
        // `off`: inside an @media that does not apply now (print, say): listed, but not taken into the box.
        const walk = (list, where, off) => {
            for (const r of Array.from(list)) {
                if (r.cssRules && !r.selectorText) {
                    if (r.name) { keyframes[r.name] = r.cssText; continue; }
                    const media = r.media && r.conditionText ? !this.deck.win.matchMedia(r.conditionText).matches : false;
                    walk(r.cssRules, where + (r.conditionText ? ' @' + r.conditionText : ''), off || media); continue;
                }
                if (!r.selectorText || /^(\*|::?[a-z-]+|\*::?[a-z-]+)(\s*,\s*(\*|::?[a-z-]+|\*::?[a-z-]+))*$/.test(r.selectorText)) continue;   // resets on everything: noise
                all.push({ r, where, off });
            }
        };
        for (const sheet of Array.from(doc.styleSheets)) {
            const node = sheet.ownerNode;
            if (node && node.id === 'deck-editor-host') continue;
            let list; try { list = sheet.cssRules; } catch (e) { continue; }
            walk(list, node && node.id === 'deck-editor-overrides' ? '(the editor\'s override block)' : node && node.tagName === 'LINK' ? '(' + (node.getAttribute('href') || 'linked sheet') + ')' : '');
        }
        // The element and what is inside it (an effect often sits on a child: the marquee's
        // scrolling is on the span in the band): each rule is tested against all of them, as
        // things are and as they are when presenting.
        const inside = Array.from(el.querySelectorAll('*')).filter(d => !d.closest('[data-fig]') || d === el).slice(0, 200);
        const targets = [el, ...inside];
        const matchAll = () => all.map(({ r }) => targets.map(t => { try { return t.matches(r.selectorText); } catch (e) { return false; } }));
        const now = matchAll();
        const root = doc.documentElement, editing = root.classList.contains('deck-editing');
        if (editing) root.classList.remove('deck-editing');
        const shown = matchAll();
        if (editing) root.classList.add('deck-editing');
        const tagOf = (t) => t.tagName.toLowerCase() + Array.from(t.classList).filter(c => !/^(reveal|reveal-img|reveal-right|active|visible)$/.test(c)).slice(0, 2).map(c => '.' + c).join('');
        // A shorthand with var() and one of its longhands after it (`transition: opacity var(--dur)`
        // then `transition-delay`) is serialised as empty longhands: its text is read from the sheet's source.
        const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
        const sourceOf = (r) => {
            const out = new Map(), node = r.parentStyleSheet && r.parentStyleSheet.ownerNode;
            if (!node || node.tagName !== 'STYLE') return out;
            const m = new RegExp(norm(r.selectorText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ?\\{([^}]*)\\}').exec(norm(node.textContent));
            if (m) for (const d of m[1].split(';')) { const kv = /^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i.exec(d); if (kv) out.set(kv[1], kv[2]); }
            return out;
        };
        const declOf = (r) => {
            const out = []; let src = null;
            for (const d of r.style.cssText.split(/;\s*(?=[a-z-]+\s*:|$)/)) {
                const m = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(d);
                if (!m) continue;
                if (m[2]) { out.push([m[1], m[2]]); continue; }
                if (!src) src = sourceOf(r);
                const short = m[1].split('-')[0];
                if (src.has(short) && !out.some(([p]) => p === short)) out.push([short, src.get(short)]);
            }
            return out;
        };
        const animOf = (r) => { const a = r.style.getPropertyValue('animation-name') || r.style.getPropertyValue('animation'); return a ? a.split(',').map(n => n.trim().split(/\s+/)[0]) : []; };
        const rules = [], want = new Set(), decl = new Map(), nested = new Map(), changing = new Set();
        all.forEach(({ r, where, off }, i) => {
            // The editor's own block is not the deck's, but for the rule of the element's preset (its animation).
            const preset = where.startsWith('(the editor') && /\[data-anim=/.test(r.selectorText);
            if (where.startsWith('(the editor') && !preset) return;
            targets.forEach((t, j) => {
                if (!now[i][j] && !shown[i][j]) return;
                if (preset && j > 0) return;
                if (j > 0 && targets.slice(0, j).some((u, k) => (now[i][k] || shown[i][k]) && tagOf(u) === tagOf(t))) return;   // the same rule on the same kind of thing, once
                const note = [preset ? '(the Animation section)' : where, j > 0 ? '(on the ' + tagOf(t) + ' inside)' : '', now[i][j] && !shown[i][j] ? '(while editing only)' : !now[i][j] && shown[i][j] ? '(when presenting)' : ''].filter(Boolean).join(' ');
                rules.push((note ? note + '\n' : '') + r.cssText);
                animOf(r).forEach(n => want.add(n));
                if (preset || off) return;                                    // a preset's animation comes into the box as values, below
                // The element's declarations as the sheet serialises them (shorthands kept), later rules
                // winning as in the cascade; of what is inside, the effects (animations, transitions),
                // as nested rules on that kind of element. Rules for the editor only stay out, and so
                // do what rules for a state (the slide shown, a reveal) set: written on the element,
                // they would hold in every state and the deck's reveal would stop.
                if (j === 0) {
                    if (now[i][j] && !shown[i][j]) return;
                    if (STATE_SEL.test(r.selectorText)) { for (const [p] of declOf(r)) changing.add(p); return; }
                    for (const [p, v] of declOf(r)) decl.set(p, v);
                }
                else if (/^(animation|transition)/m.test(Array.from(r.style).join('\n'))) {
                    const key = '& ' + tagOf(t);
                    if (!nested.has(key)) nested.set(key, new Map());
                    for (const [p, v] of declOf(r)) if (/^(animation|transition)/.test(p)) nested.get(key).set(p, v);
                }
            });
        });
        for (const t of targets) { const a = this.deck.win.getComputedStyle(t).animationName; if (a && a !== 'none') a.split(',').forEach(n => want.add(n.trim())); }
        for (const p of changing) decl.delete(p);
        // A preset's animation with the element's values, to change in the box: the keyframes
        // copied there are the element's own (renamed for it when written).
        const a = describeAnimation(el, this.revealClasses());
        if (a.kind === 'preset') {
            for (const p of Array.from(decl.keys())) if (/^animation/.test(p)) decl.delete(p);
            decl.set('animation', `de-${a.preset} ${a.duration}s ${a.ease} ${a.delay}s ${a.loop ? 'infinite' : '1 backwards'}`);
            want.add('de-' + a.preset);
        }
        const frames = Array.from(want).filter(n => keyframes[n]).map(n => keyframes[n]);
        $('inspCodeRules').textContent = rules.concat(frames).length ? rules.concat(frames).join('\n\n') : '(no rule of the deck\'s own matches this element; its look comes from inherited styles and inline style)';
        // The box: the element's own CSS, else the deck's declarations for it as a start (dimmed
        // until edited), the effects on what is inside as nested rules, and the keyframes they
        // use, so an effect can be changed where it is read.
        this._codeStart = Array.from(decl, ([p, v]) => p + ': ' + v + ';')
            .concat(Array.from(nested, ([key, m]) => key + ' {\n' + Array.from(m, ([p, v]) => '    ' + p + ': ' + v + ';').join('\n') + '\n}'))
            .concat(frames).join('\n');
        const own = el.getAttribute('data-css');
        if (document.activeElement !== $('inspCodeCss')) {
            $('inspCodeCss').value = own != null ? own : this._codeStart;
            $('inspCodeCss').classList.toggle('insp-code-start', own == null && !!this._codeStart);
        }
        $('inspCodeLive').checked = el.hasAttribute('data-css-live');
    }
    /* The Morph from row: shown when the previous slide auto-animates into this one, listing its
       elements; the one this element is linked to (same data-id) is selected. */
    _syncMorph(el) {
        const $ = this.$, prev = this._prevSlide();
        const on = !!(prev && prev.hasAttribute('data-auto-animate') && !isMaster(el));
        $('animMorphRow').hidden = $('animMorphHint').hidden = !on;
        if (!on) return;
        const id = el.getAttribute('data-id');
        // Named by the user, else by what they are; two called the same get their ids after.
        const cands = this._morphCandidates(prev), names = cands.map(nameOf);
        const opts = cands.map((e, i) => {
            const twice = names.some((n, j) => j !== i && n === names[i]);
            const label = names[i] + (twice && e.getAttribute('data-id') ? ' · ' + e.getAttribute('data-id') : '');
            return `<option value="${i}"${id && e.getAttribute('data-id') === id ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        });
        $('animMorph').innerHTML = '<option value="">(nothing: it fades in)</option>' + opts.join('');
    }

    revealClasses() {
        if (!this._revealClasses || this._revealDoc !== this.deck.doc) { this._revealClasses = deckRevealClasses(this.deck.doc); this._revealDoc = this.deck.doc; }
        return this._revealClasses;
    }
    _syncAnimation(el) {
        const $ = this.$;
        const a = describeAnimation(el, this.revealClasses());
        const grid = $('animGrid');
        grid.querySelectorAll('[data-anim]').forEach(b => b.classList.toggle('on', a.kind === 'preset' ? b.dataset.anim === a.preset : b.dataset.anim === ''));
        $('animTiming').hidden = a.kind !== 'preset';
        $('animDeckRow').hidden = a.kind !== 'deck';
        if (a.kind === 'preset') {
            const own = OWN_ANIM(el.getAttribute('data-css') || '');
            $('animNow').textContent = PRESETS[a.preset].label + (a.loop ? ' (loops)' : ' entrance') + ', ' + a.duration + 's' + (a.loop ? ' per cycle' : '') + (a.delay ? ', after ' + a.delay + 's' : '')
                + (own ? '. Its own CSS (Code, below) sets the animation, so these fields do not change it.' : '');
            $('animNow').dataset.short = PRESETS[a.preset].label;
            $('animDurLabel').textContent = a.loop ? 'Cycle' : 'Duration';
            $('animDur').parentElement.title = a.loop ? 'Seconds for one cycle: lower is faster' : '';
            $('animDur').value = a.duration; $('animDelay').value = a.delay;
            $('animEase').value = a.ease;
            if ($('animEase').value !== a.ease) { const o = document.createElement('option'); o.value = a.ease; o.textContent = a.ease; $('animEase').appendChild(o); $('animEase').value = a.ease; }
        } else if (a.kind === 'deck') {
            $('animNow').textContent = 'The deck\'s own entrance, number ' + a.index + ' in the reveal. Pick a preset to replace it.';
            $('animNow').dataset.short = 'the deck\'s entrance';
            $('animIndex').value = a.index;
        } else {
            $('animNow').textContent = 'No entrance animation.';
            $('animNow').dataset.short = '';
        }
        const textable = isEditableText(el) || el.matches('ul, ol');
        $('animTextRow').hidden = !textable;
        $('animTextFx').value = el.getAttribute('data-text-effect') || '';
        const f = fragmentOf(el);
        $('animFragment').checked = !!f;
        $('animFragIndexField').hidden = !f;
        $('animFragIndex').value = f ? f.index : '';
        const n = this.deck.currentSlide ? this.deck.currentSlide.querySelectorAll('[data-fragment]').length : 0;
        $('animFragHint').textContent = f ? `Revealed on Space, in order; ${n} on this slide.` : '';
        this._syncMorph(el);
    }

    /* ------------------------------------------------------------
       Slide: background and notes
       ------------------------------------------------------------ */
    applySlideBg(value, final) {
        const s = this.deck.currentSlide; if (!s) return;
        if (!this.pendingSlide) { this.history.remember(s); this.pendingSlide = { el: s, before: s.getAttribute('style') }; }
        s.style.background = value;
        if (final) {
            const p = this.pendingSlide; this.pendingSlide = null;
            const after = s.getAttribute('style');
            if (after !== p.before) this.history.push(styleCmd(s, p.before, after, 'Slide background'));
            if (value && !value.startsWith('var(')) this._remember(value);
            this.sync();
        }
    }
    /* Notes live in <aside class="notes"> inside the slide (created on first edit). A comment
       right before the section is read as a fallback but never written. */
    static notesOf(slide) {
        const aside = slide.querySelector(':scope > aside.notes, :scope > .notes');
        if (aside) return notesText(aside);
        let n = slide.previousSibling;
        while (n && n.nodeType === 3 && !n.textContent.trim()) n = n.previousSibling;
        if (n && n.nodeType === 8) {
            // Divider comments ("===== SLIDE 3 - Title =====", "SLIDES 5-8 - Gates") are section markers, not notes.
            const text = n.textContent.split('\n').map(l => l.replace(/^[\s=\-*#]+|[\s=\-*#]+$/g, '')).filter(Boolean).join('\n').trim();
            if (text && !/^slides?\s*\d+(\s*[-\u2013\u2014]\s*\d+)?\b/i.test(text)) return text;
        }
        return '';
    }
    /* The aside carries the `hidden` attribute so it never renders, whatever the deck's
       CSS says; it is read by the presenter view only (and by reveal-style tooling). */
    applyNotes(text) {
        const s = this.deck.currentSlide; if (!s) return;
        let aside = s.querySelector(':scope > aside.notes, :scope > .notes');
        text = text.trim();
        this.history.begin(aside ? 'Edit notes' : 'Add notes');
        if (aside) {
            if (notesText(aside) !== text) {
                const before = aside.innerHTML;
                aside.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');       // history.html records an applied change
                this.history.html(aside, before, aside.innerHTML, 'Edit notes');
            }
            if (!aside.hasAttribute('hidden')) this.history.attr(aside, 'hidden', '', 'Hide notes');
        } else if (text) {
            aside = this.deck.doc.createElement('aside');
            aside.className = 'notes';
            aside.setAttribute('hidden', '');
            aside.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
            this.history.insert(aside, s, null, 'Add notes');
        }
        this.history.end();
        window.dispatchEvent(new CustomEvent('editor:notes'));
    }

    /* ------------------------------------------------------------
       Colour
       ------------------------------------------------------------ */
    /* The picture's flips, from its scale property ("-1 1": left to right). */
    static flipOf(el) {
        const p = (el.style.scale || '').trim().split(/\s+/);
        return { x: p[0] === '-1', y: (p.length > 1 ? p[1] : p[0]) === '-1' };
    }
    static grayOf(el) { const m = /grayscale\(\s*([\d.]+)%?\s*\)/.exec(el.style.filter || ''); return m ? (el.style.filter.includes('%') || +m[1] > 1 ? +m[1] : +m[1] * 100) : 0; }
    static setGray(el, pct) {
        const rest = (el.style.filter || '').replace(/grayscale\([^)]*\)\s*/g, '').trim();
        el.style.filter = ((pct > 0 ? `grayscale(${pct}%)` : '') + (rest ? ' ' + rest : '')).trim();
    }
    colourProp(el) {
        const t = this.colourTarget;
        if (isShape(el)) return t === 'text' ? 'fill' : 'stroke';
        return t === 'text' ? 'color' : t === 'fill' ? 'backgroundColor' : 'borderColor';
    }
    applyColour(value, final) {
        const label = 'Colour';
        // While text is being edited with part of it selected, the Text colour goes on that part
        // only (a span round the selection), the way bold does; the edit stays open.
        if (this.colourTarget === 'text' && this.app.textEdit.colourSelection(value)) { if (final && value && !value.startsWith('var(')) this._remember(value); return; }
        this._preview(label, (el) => {
            const p = this.colourProp(el);
            el.style[p] = value;
            if (p === 'borderColor' && value) {
                const cs = css(el);
                if (cs.borderStyle === 'none' || parseFloat(cs.borderTopWidth) === 0) { el.style.borderStyle = 'solid'; if (!el.style.borderWidth) el.style.borderWidth = '2px'; }
            }
            if (p === 'backgroundColor' && value) el.style.backgroundImage = 'none';
        });
        if (final) { this._commit(); if (value && !value.startsWith('var(')) this._remember(value); this.sync(); }
    }
    _remember(hex) {
        const list = this._recent().filter(c => c !== hex); list.unshift(hex);
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10))); } catch (e) { /* storage blocked */ }
    }
    _recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }

    /* Alt text. An <img> or <video> carries it as alt; an inline <svg> (a shape, an icon) as
       aria-label with role="img". A [data-svg] host (an <img> the deck inlines at load) is the
       deck's own construct: its alt is the <img>'s in the file, edited in the Code section. */
    static altTarget(el) {
        if (cropBoxOf(el)) return 'alt';                   // a cropped picture: the <img> in the box
        const t = el.tagName.toLowerCase();
        if (t === 'img' || t === 'video') return 'alt';
        if (t === 'svg' && !el.closest('[data-fig], [data-svg]')) return 'aria-label';
        return null;
    }
    static altOf(el) { const a = Inspector.altTarget(el); return a ? ((pictureOf(el) || el).getAttribute(a) || '') : ''; }
    setAlt(value) {
        const v = value.trim();
        this.history.begin(v ? 'Alt text' : 'Remove alt text');
        for (const el of this.items) {
            const a = Inspector.altTarget(el); if (!a) continue;
            this.history.attr(a === 'alt' ? (pictureOf(el) || el) : el, a, v || null, 'Alt text');
            if (a === 'aria-label') this.history.attr(el, 'role', v ? 'img' : null, 'Alt text');
        }
        this.history.end();
        this.sync();
    }

    /* ------------------------------------------------------------
       Deck-derived lists: theme colours and fonts (cached per deck)
       ------------------------------------------------------------ */
    themeSwatches() {
        if (!this.swatches) this.swatches = this.deck.isOpen ? this.deck.themeColours() : [];
        return this.swatches;
    }

    /* ------------------------------------------------------------
       Reflect the primary element in the fields
       ------------------------------------------------------------ */
    sync() {
        const el = this.el;
        const open = this.deck.isOpen;
        this.root.querySelector('[data-when=none]').hidden = !!el || open;
        this.root.querySelector('[data-when=slide]').hidden = !!el || !open;
        this.root.querySelector('[data-when=some]').hidden = !el;
        this.syncing = true;
        try {
            if (el && this.deck.doc.contains(el)) this._sync(el);
            else if (open) this._syncSlide();
        } finally { this.syncing = false; }
    }
    _syncSlide() {
        const $ = this.$, s = this.deck.currentSlide; if (!s) return;
        $('inspSlideNo').textContent = (this.deck.current + 1) + ' of ' + this.deck.slides.length;
        $('inspSlideName').value = s.dataset.name || '';
        $('inspSection').value = s.dataset.section || '';
        $('inspTransition').value = s.getAttribute('data-transition') || '';
        $('inspTransitionDeck').value = this.deck.stage.getAttribute('data-transition') || '';
        const eff = s.getAttribute('data-transition') || this.deck.stage.getAttribute('data-transition') || 'none';
        const hasRuntime = !!(this.deck.win.deckRuntime && this.deck.win.deckRuntime.playTransition);
        $('inspTransitionHint').textContent = hasRuntime ? '' : 'Needs the presentation features script (Presenter menu).';
        $('inspAutoAnimate').checked = s.hasAttribute('data-auto-animate');
        $('inspMasterRow').hidden = !this.deck.masterElements.length;
        $('inspShowMaster').checked = !s.hasAttribute('data-no-master');
        const current = toHex(css(s).backgroundColor);
        setSwatches($('inspSlideSwatches'), this.themeSwatches().map(c => swatchButton(`var(--${c.name})`, c.value, colourName(c.name), toHex(c.value) === current)).join(''));
        $('inspSlideBg').value = current || '#ffffff';
        $('inspSlideBgHex').value = current || '';
        $('inspSlideColour').classList.toggle('set', !!s.style.background || !!s.style.backgroundColor);
        const adv = s.getAttribute('data-auto-advance') || '', deckAdv = (this.deck.stage && this.deck.stage.getAttribute('data-auto-advance')) || '';
        $('inspAdvance').value = adv; $('inspAdvanceDeck').value = deckAdv;
        this.root.querySelector('.insp-field[data-prop="_advance"]').classList.toggle('set', !!adv);
        this.root.querySelector('.insp-field[data-prop="_advanceDeck"]').classList.toggle('set', !!deckAdv);
        $('inspLoop').checked = !!(this.deck.stage && this.deck.stage.hasAttribute('data-loop'));
        $('inspLoopRow').hidden = !(adv || deckAdv);
        this._summary('timing', adv ? adv + ' s' : deckAdv ? deckAdv + ' s, as all slides' : 'off');
        if (document.activeElement !== $('inspNotes')) $('inspNotes').value = Inspector.notesOf(s);
    }
    _sync(el) {
        const $ = this.$, cs = css(el), st = el.style;
        const d = describe(el);
        if (document.activeElement !== $('inspName')) $('inspName').value = d.name;
        $('inspName').placeholder = d.role.charAt(0).toUpperCase() + d.role.slice(1) + (this.items.length > 1 ? ` (+${this.items.length - 1})` : '');
        $('inspRole').textContent = [isMaster(el) ? 'on every slide' : '', el.hasAttribute('data-locked') ? 'locked' : isLocked(el) ? 'in a locked element' : ''].filter(Boolean).join(' · ');
        $('inspLock').textContent = this.items.every(isLocked) ? 'Unlock' : 'Lock';
        $('inspText').textContent = d.text;
        this.root.querySelector('[data-act=text]').hidden = !isEditableText(el) && !el.matches('ul, ol, pre, table');
        // Shrink to fit: for text with a box of its own (a width or a height set on it).
        const fitAble = isEditableText(el) && !isShape(el) && !!(st.height || st.width);
        $('inspFitRow').hidden = !fitAble;
        $('inspFitText').checked = el.getAttribute('data-fit') === 'shrink';
        // Picture: alt text on images and videos, aria-label on inline SVG (with role="img").
        const pic = Inspector.altTarget(el);
        $('inspPicture').hidden = !pic;
        if (pic) { $('inspAlt').value = Inspector.altOf(el); this.root.querySelector('.insp-field[data-prop="_alt"]').classList.toggle('set', !!Inspector.altOf(el)); }
        const media = pic === 'alt';
        $('inspMediaRows').hidden = !media;
        if (media) {
            const src = (pictureOf(el) || el).getAttribute('src') || '';
            $('inspSrc').textContent = src.split('/').pop().slice(0, 28);
            $('inspSrc').title = src;
            // A picture crops by hand; a cropped one has no Fit (the box is the crop).
            const cropped = !!cropBoxOf(el);
            $('inspCropRow').hidden = !canCrop(el);
            $('inspUncrop').hidden = !cropped;
            $('inspFitRow2').hidden = cropped;
            $('inspFit').value = st.objectFit || '';
            this.root.querySelector('.insp-field[data-prop="objectFit"]').classList.toggle('set', !!st.objectFit);
            $('inspFocusRow').hidden = cropped || !st.objectFit || st.objectFit === 'fill';
            const pos = st.objectPosition || 'center center';
            this.root.querySelectorAll('#inspFocus button').forEach(b => b.classList.toggle('on', b.dataset.focus === pos || (pos === '50% 50%' && b.dataset.focus === 'center center')));
            const f = Inspector.flipOf(el);
            this.root.querySelector('#inspFlip [data-flip="x"]').classList.toggle('on', f.x);
            this.root.querySelector('#inspFlip [data-flip="y"]').classList.toggle('on', f.y);
            const g = Inspector.grayOf(el);
            $('inspGray').value = g; $('inspGrayV').textContent = g + '%';
            this.root.querySelector('.insp-field[data-prop="_grayscale"]').classList.toggle('set', g > 0);
        }
        $('inspHref').value = el.getAttribute('data-href') || '';
        this._summary('link', (el.getAttribute('data-href') || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 28));
        this.root.querySelector('.insp-field[data-prop="_href"]').classList.toggle('set', el.hasAttribute('data-href'));
        $('inspChooseImage').hidden = !el.hasAttribute('data-placeholder');
        $('inspTable').hidden = !el.closest('table');
        this.chart.sync(el);
        this.math.sync(el);
        this.chem.sync(el);
        const list = this._list();
        $('inspList').hidden = !list;
        if (list) {
            const kind = list.tagName.toLowerCase();
            this.root.querySelectorAll('#inspListKind button').forEach(b => b.classList.toggle('on', b.dataset.v === kind));
            const marker = list.style.listStyleType || '';
            $('inspListMarker').innerHTML = LIST_MARKERS[kind].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
            $('inspListMarker').value = LIST_MARKERS[kind].some(([v]) => v === marker) ? marker : '';
            $('inspListStartRow').hidden = kind !== 'ol';
            $('inspListStart').value = list.getAttribute('start') || 1;
            this.root.querySelector('.insp-field[data-prop="listStyleType"]').classList.toggle('set', !!marker);
            this.root.querySelector('.insp-field[data-prop="_start"]').classList.toggle('set', !!list.getAttribute('start'));
        }
        const n = this.items.length;
        this.root.querySelectorAll('[data-distribute]').forEach(b => b.disabled = n < 3);
        $('inspAlignSlide').disabled = n < 2;
        $('inspAlignHint').textContent = n < 2 ? '(one element always aligns to the slide)' : n < 3 ? '' : '';

        const noText = pic === 'alt' || (isShape(el) && !el.matches('text, tspan')) || (el.matches('svg') && !el.querySelector('text') && !chartOf(el));
        $('inspType').hidden = noText;
        $('inspUnhide').hidden = !(this.deck.currentSlide && this.deck.currentSlide.querySelector('[data-hidden]'));

        // Colour
        const shape = isShape(el);
        this.root.querySelectorAll('#inspColourTarget button').forEach(b => {
            b.classList.toggle('on', b.dataset.t === this.colourTarget);
            b.hidden = shape && b.dataset.t === 'border';
            if (shape) b.textContent = b.dataset.t === 'text' ? 'Fill' : 'Stroke';
            else b.textContent = b.dataset.t === 'text' ? 'Text' : b.dataset.t === 'fill' ? 'Fill' : 'Border';
        });
        if (shape && this.colourTarget === 'border') this.colourTarget = 'fill';
        const prop = this.colourProp(el);
        const current = toHex(cs[prop === 'borderColor' ? 'borderTopColor' : prop]);
        const swatches = this.themeSwatches();
        setSwatches($('inspSwatches'), swatches.map(s => swatchButton(`var(--${s.name})`, s.value, colourName(s.name), toHex(s.value) === current)).join('')
            || '<span class="insp-hint insp-state">This deck defines no theme colours.</span>');
        const recent = this._recent();
        setSwatches($('inspRecent'), recent.length ? '<span class="insp-hint insp-state">Recent</span>' + recent.map(c => swatchButton(c, c, '', c === current)).join('') : '');
        $('inspPick').value = current || '#000000';
        $('inspHex').value = current || '';
        this.root.querySelector('.insp-colour').classList.toggle('set', !!st[prop]);

        // Text. While part of the text is selected, these show that part's formatting and
        // change that part only; everything else in the panel stays on the element.
        const part = this.typePart();
        const tst = part ? part.style : st, tcs = part ? css(part) : cs;
        this.$('inspType').classList.toggle('on-part', !!part);
        const fam = firstFamily(tcs.fontFamily);
        $('inspFont').textContent = fam;
        $('inspFont').style.fontFamily = tcs.fontFamily;
        $('inspFont').title = (isGoogleFamily(fam) ? 'Google Fonts: ' : '') + tcs.fontFamily + (/^var\(/.test(tst.fontFamily || '') ? ' (the deck\'s font)' : '');
        $('inspSize').value = tst.fontSize ? parseFloat(tst.fontSize) : Math.round(parseFloat(tcs.fontSize));
        const avail = availableWeights(this.deck, fam);
        const weights = new Set(avail ? [...avail.weights, ...avail.italics] : ALL_WEIGHTS);
        if (tst.fontWeight && /^\d+$/.test(tst.fontWeight)) weights.add(+tst.fontWeight);
        $('inspWeight').innerHTML = '<option value="">default (' + tcs.fontWeight + ')</option>' + [...weights].sort((a, b) => a - b).map(w => `<option value="${w}">${w}${WEIGHT_NAMES[w] ? ' ' + WEIGHT_NAMES[w] : ''}</option>`).join('');
        $('inspWeight').value = tst.fontWeight || '';
        this.root.querySelectorAll('#inspStyle button').forEach(b => b.classList.toggle('on', b.dataset.v === 'italic' ? tcs.fontStyle === 'italic' : tcs.textTransform === b.dataset.v));
        const lh = parseFloat(cs.lineHeight), fs = parseFloat(cs.fontSize);
        $('inspLine').value = st.lineHeight ? parseFloat(st.lineHeight) : (isNaN(lh) ? '' : +(lh / fs).toFixed(2));
        $('inspTrack').value = tst.letterSpacing ? parseFloat(tst.letterSpacing) : (tcs.letterSpacing === 'normal' ? 0 : +parseFloat(tcs.letterSpacing).toFixed(1));
        this.root.querySelectorAll('#inspAlign button').forEach(b => b.classList.toggle('on', b.dataset.v === (st.textAlign || cs.textAlign)));

        // Box
        const r = this.deck.stageRect(el);
        $('inspW').value = st.width ? parseFloat(st.width) : Math.round(r.w);
        $('inspH').value = st.height ? parseFloat(st.height) : Math.round(r.h);
        $('inspPad').value = st.padding ? parseFloat(st.padding) : Math.round(parseFloat(cs.paddingTop)) || 0;
        $('inspRadius').value = st.borderRadius ? parseFloat(st.borderRadius) : Math.round(parseFloat(cs.borderTopLeftRadius)) || 0;
        $('inspBorder').value = st.borderWidth ? parseFloat(st.borderWidth) : Math.round(parseFloat(cs.borderTopWidth)) || 0;
        const shadow = this.shadowKeys.find(([, raw, norm]) => raw === st.boxShadow || norm === st.boxShadow);
        $('inspShadow').value = shadow ? shadow[0] : '';
        $('inspOpacity').value = cs.opacity; $('inspOpacityV').textContent = Math.round(cs.opacity * 100) + '%';
        this._summary('box', `${$('inspW').value} × ${$('inspH').value}`);

        // Position
        const o = getOffset(el);
        $('inspX').value = Math.round(r.x); $('inspY').value = Math.round(r.y); $('inspRot').value = o.r;
        const size = `${this.deck.stageW} x ${this.deck.stageH}`;
        $('inspPosHint').textContent = (o.x || o.y) ? `Moved ${fmt(o.x)}, ${fmt(o.y)} px from where the deck puts it; the x takes it back.` : '';
        this._summary('pos', `${Math.round(r.x)}, ${Math.round(r.y)}` + (o.r ? `, ${o.r}°` : ''));
        this._summary('align', this.items.length > 1 ? this.items.length + ' selected' : '');

        // Animation
        this._syncAnimation(el);
        this._summary('anim', $('animNow').dataset.short || '');
        // Code
        $('inspCode').open = !!this._codeOpen;
        if (this._codeOpen) this._syncCode(el);

        // Override highlights
        const has = (p) => !!st[p];
        const hasT = (p) => !!tst[p];
        const flags = {
            fontFamily: hasT('fontFamily'), fontSize: hasT('fontSize'), fontWeight: hasT('fontWeight'), lineHeight: has('lineHeight'), fontStyle: hasT('fontStyle') || hasT('textTransform'),
            letterSpacing: hasT('letterSpacing'), textAlign: has('textAlign'), width: has('width'), height: has('height'),
            padding: has('padding'), borderRadius: has('borderRadius'), borderWidth: has('borderWidth'), boxShadow: has('boxShadow'),
            opacity: has('opacity'), _x: o.x !== 0, _y: o.y !== 0, rotate: o.r !== 0, zIndex: has('zIndex'),
        };
        this.root.querySelectorAll('.insp-field[data-prop]').forEach(f => f.classList.toggle('set', !!flags[f.dataset.prop]));
    }
}

/* --- small helpers ------------------------------------------------ */
/* "example.com/x" -> "https://example.com/x"; mail and hash addresses pass; empty stays empty. */
function normaliseUrl(s) {
    s = String(s || '').trim();
    if (!s || /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(s)) return s;
    return 'https://' + s;
}
function fmt(n) { return (n > 0 ? '+' : '') + (Math.round(n * 10) / 10); }
export function toHex(c) {
    if (!c) return '';
    c = c.trim();
    if (c[0] === '#') return c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('').toLowerCase() : c.slice(0, 7).toLowerCase();
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (!m) return '';
    if (m[4] !== undefined && +m[4] === 0) return '';
    return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
}
const WEIGHT_NAMES = { 100: 'thin', 200: 'extra light', 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extra bold', 900: 'black' };
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

/* A colour swatch: a button (Tab reaches it, Enter or Space applies it) named by its colour. */
function swatchButton(value, colour, name, on) {
    const label = escapeAttr(name ? `${name} ${colour}` : colour);
    return `<button type="button" class="insp-swatch${on ? ' on' : ''}" data-c="${escapeAttr(value)}" title="${label}" aria-label="${label}" style="background:${escapeAttr(colour)}"></button>`;
}

/* Plain text of a notes element: <br> and block ends become line breaks. */
export function notesText(aside) {
    const html = aside.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
    const t = aside.ownerDocument.createElement('div');
    t.innerHTML = html;
    return t.textContent.replace(/\r/g, '').split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
