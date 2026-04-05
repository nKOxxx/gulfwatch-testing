/**
 * Gulf Watch — Internationalization (i18n)
 * Supports English and Arabic with RTL layout switching.
 */

(function () {
  'use strict';

  var PREF_KEY = 'gw_lang';
  var SUPPORTED = ['en', 'ar'];

  function I18n() {
    this._lang = 'en';
    this._strings = {};
    this._loaded = {};
  }

  /**
   * Initialise: load saved preference (or default to 'en') and apply.
   */
  I18n.prototype.init = function () {
    var saved = localStorage.getItem(PREF_KEY);
    this._lang = (saved && SUPPORTED.indexOf(saved) !== -1) ? saved : 'en';
    return this.setLanguage(this._lang);
  };

  /**
   * Switch language.
   * @param {string} lang  'en' | 'ar'
   */
  I18n.prototype.setLanguage = function (lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = 'en';
    this._lang = lang;
    localStorage.setItem(PREF_KEY, lang);

    var self = this;
    return this._load(lang).then(function (strings) {
      self._strings = strings;
      self._applyTranslations();
      self._applyDirection(lang);
      self._updateToggle(lang);
    });
  };

  /**
   * Translate a single key. Falls back to the key itself.
   */
  I18n.prototype.t = function (key) {
    return this._strings[key] || key;
  };

  /**
   * Get current language code.
   */
  I18n.prototype.getLang = function () {
    return this._lang;
  };

  /* ── Private ─────────────────────────────────────────── */

  I18n.prototype._load = function (lang) {
    if (this._loaded[lang]) return Promise.resolve(this._loaded[lang]);
    var self = this;
    return fetch('/i18n/' + lang + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('i18n load failed');
        return r.json();
      })
      .then(function (data) {
        self._loaded[lang] = data;
        return data;
      })
      .catch(function () {
        // Return empty so page still works
        return {};
      });
  };

  I18n.prototype._applyTranslations = function () {
    var strings = this._strings;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (strings[key]) {
        // Support placeholder translations
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = strings[key];
        } else {
          el.textContent = strings[key];
        }
      }
    });
    // Also handle data-i18n-title
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (strings[key]) el.title = strings[key];
    });
  };

  I18n.prototype._applyDirection = function (lang) {
    var html = document.documentElement;
    if (lang === 'ar') {
      html.setAttribute('dir', 'rtl');
      html.setAttribute('lang', 'ar');
      this._loadRTLSheet();
    } else {
      html.setAttribute('dir', 'ltr');
      html.setAttribute('lang', 'en');
      this._removeRTLSheet();
    }
  };

  I18n.prototype._loadRTLSheet = function () {
    if (document.getElementById('rtl-stylesheet')) return;
    var link = document.createElement('link');
    link.id = 'rtl-stylesheet';
    link.rel = 'stylesheet';
    link.href = '/css/rtl.css';
    document.head.appendChild(link);
  };

  I18n.prototype._removeRTLSheet = function () {
    var el = document.getElementById('rtl-stylesheet');
    if (el) el.remove();
  };

  I18n.prototype._updateToggle = function (lang) {
    var btn = document.getElementById('lang-toggle');
    if (btn) {
      btn.textContent = lang === 'ar' ? 'EN' : 'AR';
      btn.title = lang === 'ar' ? 'Switch to English' : 'Switch to Arabic';
    }
  };

  /* ── Expose ──────────────────────────────────────────── */
  window.I18n = I18n;
})();
