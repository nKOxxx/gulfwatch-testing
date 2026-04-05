/**
 * Gulf Watch — WebSocket Client
 * Real-time incident streaming with auto-reconnect and channel subscriptions.
 */

(function () {
  'use strict';

  var STATUS = { LIVE: 'LIVE', RECONNECTING: 'RECONNECTING', OFFLINE: 'OFFLINE' };

  /**
   * @constructor
   * @param {object} opts
   * @param {string} opts.url          WebSocket endpoint (wss://…)
   * @param {string} [opts.token]      JWT auth token
   * @param {number} [opts.maxDelay]   Maximum reconnect delay in ms (default 30000)
   */
  function GulfWatchWS(opts) {
    opts = opts || {};
    this._url = opts.url || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    this._token = opts.token || null;
    this._maxDelay = opts.maxDelay || 30000;
    this._baseDelay = 1000;
    this._attempt = 0;
    this._ws = null;
    this._channels = {};
    this._listeners = {};
    this._status = STATUS.OFFLINE;
    this._reconnectTimer = null;
    this._destroyed = false;
  }

  /* ── Connection ──────────────────────────────────────── */

  GulfWatchWS.prototype.connect = function () {
    if (this._destroyed) return;
    this._setStatus(STATUS.RECONNECTING);

    var url = this._url;
    if (this._token) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(this._token);
    }

    try {
      this._ws = new WebSocket(url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }

    var self = this;

    this._ws.onopen = function () {
      self._attempt = 0;
      self._setStatus(STATUS.LIVE);
      // Re-subscribe to channels
      Object.keys(self._channels).forEach(function (ch) {
        self._send({ type: 'subscribe', channel: ch });
      });
      self._emit('open');
    };

    this._ws.onmessage = function (evt) {
      var data;
      try { data = JSON.parse(evt.data); } catch (_) { return; }
      self.onMessage(data);
    };

    this._ws.onclose = function () {
      self._setStatus(STATUS.OFFLINE);
      self._emit('close');
      self._scheduleReconnect();
    };

    this._ws.onerror = function () {
      if (self._ws) self._ws.close();
    };
  };

  GulfWatchWS.prototype.disconnect = function () {
    this._destroyed = true;
    clearTimeout(this._reconnectTimer);
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close();
      this._ws = null;
    }
    this._setStatus(STATUS.OFFLINE);
  };

  /* ── Channels ────────────────────────────────────────── */

  GulfWatchWS.prototype.subscribe = function (channel, callback) {
    this._channels[channel] = true;
    if (callback) this.on('channel:' + channel, callback);
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._send({ type: 'subscribe', channel: channel });
    }
  };

  GulfWatchWS.prototype.unsubscribe = function (channel) {
    delete this._channels[channel];
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._send({ type: 'unsubscribe', channel: channel });
    }
  };

  /* ── Message handling ────────────────────────────────── */

  GulfWatchWS.prototype.onMessage = function (data) {
    this._emit('message', data);

    // Route to channel listeners
    if (data.channel) {
      this._emit('channel:' + data.channel, data);
    }

    // Built-in handlers
    if (data.channel === 'incidents' && data.payload) {
      this._handleNewIncident(data.payload);
    }
    if (data.channel === 'alerts' && data.payload) {
      this._handleAlert(data.payload);
    }
  };

  GulfWatchWS.prototype._handleNewIncident = function (incident) {
    // Prepend to incident feed
    var feed = document.getElementById('incident-feed');
    if (feed) {
      var card = this._buildIncidentCard(incident);
      if (card) {
        feed.insertAdjacentHTML('afterbegin', card);
        // Animate
        var first = feed.firstElementChild;
        if (first) {
          first.classList.add('ws-new-incident');
          setTimeout(function () { first.classList.remove('ws-new-incident'); }, 2000);
        }
      }
    }

    // Update counters
    this._incrementCounter('incident-count');
    if (incident.severity) {
      this._incrementCounter('count-' + incident.severity);
    }

    // Flash notification
    this._flashNotification(incident);
  };

  GulfWatchWS.prototype._handleAlert = function (alert) {
    this._flashNotification(alert);
  };

  GulfWatchWS.prototype._buildIncidentCard = function (inc) {
    var badge = '';
    if (window.GulfWatchClassification) {
      badge = window.GulfWatchClassification.getDataSourceBadge(inc.data_source || 'LIVE');
    }
    var severity = (inc.severity || 'medium').toLowerCase();
    return (
      '<div class="incident-card severity-' + severity + '" data-source="' + (inc.data_source || 'LIVE') + '">' +
        badge +
        '<div class="incident-header">' +
          '<span class="incident-type">' + (inc.type || 'unknown') + '</span>' +
          '<span class="incident-time">' + (inc.timestamp ? new Date(inc.timestamp).toLocaleTimeString() : 'now') + '</span>' +
        '</div>' +
        '<div class="incident-title">' + (inc.title || inc.headline || '') + '</div>' +
        '<div class="incident-location">' + (inc.location || inc.country || '') + '</div>' +
      '</div>'
    );
  };

  GulfWatchWS.prototype._flashNotification = function (data) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('Gulf Watch Alert', {
        body: data.title || data.headline || data.message || 'New event',
        icon: '/icons/icon-192.svg',
        tag: 'gw-' + (data.id || Date.now()),
      });
    } catch (_) { /* noop */ }
  };

  GulfWatchWS.prototype._incrementCounter = function (id) {
    var el = document.getElementById(id);
    if (el) {
      var n = parseInt(el.textContent, 10);
      el.textContent = (isNaN(n) ? 0 : n) + 1;
    }
  };

  /* ── Reconnect ───────────────────────────────────────── */

  GulfWatchWS.prototype._scheduleReconnect = function () {
    if (this._destroyed) return;
    var delay = Math.min(this._baseDelay * Math.pow(2, this._attempt), this._maxDelay);
    this._attempt++;
    this._setStatus(STATUS.RECONNECTING);
    var self = this;
    this._reconnectTimer = setTimeout(function () { self.connect(); }, delay);
  };

  /* ── Status indicator ────────────────────────────────── */

  GulfWatchWS.prototype._setStatus = function (status) {
    this._status = status;
    var dot = document.querySelector('.status-dot');
    var label = dot ? dot.nextElementSibling : null;

    if (dot) {
      dot.style.background =
        status === STATUS.LIVE ? '#00ff88' :
        status === STATUS.RECONNECTING ? '#ffd600' : '#ff4444';
      dot.style.boxShadow = '0 0 6px ' + dot.style.background;
    }
    if (label) label.textContent = status;
    this._emit('status', status);
  };

  GulfWatchWS.prototype.getStatus = function () { return this._status; };

  /* ── Event emitter ───────────────────────────────────── */

  GulfWatchWS.prototype.on = function (evt, fn) {
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
  };

  GulfWatchWS.prototype.off = function (evt, fn) {
    var arr = this._listeners[evt];
    if (!arr) return;
    this._listeners[evt] = arr.filter(function (f) { return f !== fn; });
  };

  GulfWatchWS.prototype._emit = function (evt, data) {
    (this._listeners[evt] || []).forEach(function (fn) {
      try { fn(data); } catch (_) { /* noop */ }
    });
  };

  /* ── Helpers ─────────────────────────────────────────── */

  GulfWatchWS.prototype._send = function (obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  };

  /* ── Expose ──────────────────────────────────────────── */
  window.GulfWatchWS = GulfWatchWS;
  window.GW_WS_STATUS = STATUS;
})();
