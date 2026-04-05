/**
 * Gulf Watch — Classification Marking System
 * Handles data classification banners and data source indicators.
 */

(function () {
  'use strict';

  const CLASSIFICATION_LEVELS = {
    UNCLASSIFIED_FOUO: 'UNCLASSIFIED // FOR OFFICIAL USE ONLY',
    UNCLASSIFIED: 'UNCLASSIFIED',
    CONFIDENTIAL: 'CONFIDENTIAL',
    SECRET: 'SECRET',
  };

  const DATA_SOURCE_STYLES = {
    LIVE:      { color: '#00ff88', bg: 'rgba(0,255,136,0.12)', border: 'rgba(0,255,136,0.3)', label: 'LIVE' },
    MOCK:      { color: '#ffd600', bg: 'rgba(255,214,0,0.12)',  border: 'rgba(255,214,0,0.3)',  label: 'MOCK' },
    SIMULATED: { color: '#ff9800', bg: 'rgba(255,152,0,0.12)',  border: 'rgba(255,152,0,0.3)',  label: 'SIMULATED' },
    DEMO:      { color: '#90a4ae', bg: 'rgba(144,164,174,0.12)',border: 'rgba(144,164,174,0.3)',label: 'DEMO' },
  };

  /* ── State ─────────────────────────────────────────────── */
  let classificationState = {
    level: CLASSIFICATION_LEVELS.UNCLASSIFIED_FOUO,
    defaultDataSource: 'DEMO',
  };

  /* ── Public API ────────────────────────────────────────── */

  /**
   * Initialise the classification system: inject banners and
   * apply data-source badges to any existing incident cards.
   */
  function initClassification(opts) {
    if (opts && opts.level) classificationState.level = opts.level;
    if (opts && opts.defaultDataSource) classificationState.defaultDataSource = opts.defaultDataSource;

    addClassificationBanner();

    // Badge any cards already on screen
    document.querySelectorAll('.incident-card').forEach(function (card) {
      if (!card.querySelector('.data-source-badge')) {
        var src = card.dataset.source || classificationState.defaultDataSource;
        card.insertAdjacentHTML('afterbegin', getDataSourceBadge(src));
      }
    });
  }

  /**
   * Return an HTML string for a data-source badge.
   * @param {string} source  LIVE | MOCK | SIMULATED | DEMO
   */
  function getDataSourceBadge(source) {
    var s = DATA_SOURCE_STYLES[source] || DATA_SOURCE_STYLES.DEMO;
    return (
      '<span class="data-source-badge" style="' +
        'display:inline-flex;align-items:center;gap:4px;' +
        'font-size:10px;font-weight:700;letter-spacing:0.5px;' +
        'padding:2px 8px;border-radius:3px;' +
        'color:' + s.color + ';' +
        'background:' + s.bg + ';' +
        'border:1px solid ' + s.border + ';' +
      '">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + s.color + ';"></span>' +
        s.label +
      '</span>'
    );
  }

  /**
   * Inject top and bottom classification banners into the page.
   */
  function addClassificationBanner() {
    // Remove existing banners to avoid duplicates
    document.querySelectorAll('.classification-banner').forEach(function (el) { el.remove(); });

    var bannerCSS =
      'width:100%;text-align:center;padding:4px 0;font-size:11px;font-weight:700;' +
      'letter-spacing:1.5px;font-family:"JetBrains Mono",monospace;z-index:9999;' +
      'background:#1a5e1a;color:#66ff66;border-bottom:1px solid #33cc33;';

    var topBanner = document.createElement('div');
    topBanner.className = 'classification-banner classification-banner--top';
    topBanner.setAttribute('style', bannerCSS + 'position:fixed;top:0;left:0;');
    topBanner.textContent = classificationState.level;

    var bottomBanner = document.createElement('div');
    bottomBanner.className = 'classification-banner classification-banner--bottom';
    bottomBanner.setAttribute('style',
      bannerCSS.replace('border-bottom', 'border-top') +
      'position:fixed;bottom:0;left:0;'
    );
    bottomBanner.textContent = classificationState.level;

    document.body.prepend(topBanner);
    document.body.appendChild(bottomBanner);

    // Offset body so top banner does not obscure content
    document.body.style.paddingTop = '28px';
    document.body.style.paddingBottom = '28px';
  }

  /**
   * Get current classification level — useful for export headers.
   */
  function getClassificationLevel() {
    return classificationState.level;
  }

  /**
   * Change classification level at runtime.
   */
  function setClassificationLevel(level) {
    classificationState.level = level;
    document.querySelectorAll('.classification-banner').forEach(function (el) {
      el.textContent = level;
    });
  }

  /* ── Expose on window ──────────────────────────────────── */
  window.GulfWatchClassification = {
    init: initClassification,
    getDataSourceBadge: getDataSourceBadge,
    addClassificationBanner: addClassificationBanner,
    getLevel: getClassificationLevel,
    setLevel: setClassificationLevel,
    LEVELS: CLASSIFICATION_LEVELS,
    DATA_SOURCES: DATA_SOURCE_STYLES,
  };
})();
