/**
 * Gulf Watch — Auth Guard
 * JWT validation, token refresh, role-based UI, and session management.
 */

(function () {
  'use strict';

  var TOKEN_KEY = 'gw_access_token';
  var REFRESH_KEY = 'gw_refresh_token';
  var ROLE_KEY = 'gw_user_role';

  /* ── Helpers ─────────────────────────────────────────── */

  function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    switch (str.length % 4) {
      case 2: str += '=='; break;
      case 3: str += '='; break;
    }
    return atob(str);
  }

  function decodeJWT(token) {
    try {
      var parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(base64UrlDecode(parts[1]));
    } catch (_) {
      return null;
    }
  }

  function isTokenExpired(token) {
    var payload = decodeJWT(token);
    if (!payload || !payload.exp) return true;
    // 30-second buffer
    return (payload.exp * 1000) < (Date.now() - 30000);
  }

  /* ── AuthGuard Class ─────────────────────────────────── */

  function AuthGuard() {
    this._refreshTimer = null;
  }

  /**
   * Initialise the auth guard.
   * Call on every protected page load.
   * Redirects to login.html if not authenticated.
   */
  AuthGuard.prototype.init = function () {
    var token = localStorage.getItem(TOKEN_KEY);

    if (!token || isTokenExpired(token)) {
      // Attempt silent refresh
      var self = this;
      return this.refreshToken().then(function (ok) {
        if (!ok) {
          self._redirectToLogin();
        } else {
          self._applyRoleUI();
          self._scheduleRefresh();
        }
      });
    }

    this._applyRoleUI();
    this._scheduleRefresh();
    return Promise.resolve();
  };

  /**
   * Is the current session authenticated (valid, non-expired token)?
   */
  AuthGuard.prototype.isAuthenticated = function () {
    var token = localStorage.getItem(TOKEN_KEY);
    return !!token && !isTokenExpired(token);
  };

  /**
   * Get the current user role from the stored token.
   * Returns 'admin' | 'analyst' | 'viewer' | null.
   */
  AuthGuard.prototype.getRole = function () {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    var payload = decodeJWT(token);
    return payload ? (payload.role || payload.user_role || 'viewer') : null;
  };

  /**
   * Get the user's email / subject from the token.
   */
  AuthGuard.prototype.getUser = function () {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    var payload = decodeJWT(token);
    return payload ? { email: payload.email || payload.sub, role: payload.role || 'viewer' } : null;
  };

  /**
   * Get the raw access token (for WebSocket auth, API calls, etc.).
   */
  AuthGuard.prototype.getToken = function () {
    return localStorage.getItem(TOKEN_KEY);
  };

  /**
   * Log out: clear tokens and redirect to login.
   */
  AuthGuard.prototype.logout = function () {
    clearTimeout(this._refreshTimer);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(ROLE_KEY);
    this._redirectToLogin();
  };

  /**
   * Attempt to refresh the access token via the refresh endpoint.
   * Returns a Promise<boolean>.
   */
  AuthGuard.prototype.refreshToken = function () {
    var refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return Promise.resolve(false);

    return fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    .then(function (res) {
      if (!res.ok) return false;
      return res.json().then(function (data) {
        if (data.access_token) {
          localStorage.setItem(TOKEN_KEY, data.access_token);
          if (data.refresh_token) {
            localStorage.setItem(REFRESH_KEY, data.refresh_token);
          }
          return true;
        }
        return false;
      });
    })
    .catch(function () {
      return false;
    });
  };

  /* ── Private ─────────────────────────────────────────── */

  AuthGuard.prototype._redirectToLogin = function () {
    if (location.pathname !== '/login.html') {
      location.href = '/login.html';
    }
  };

  AuthGuard.prototype._scheduleRefresh = function () {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    var payload = decodeJWT(token);
    if (!payload || !payload.exp) return;

    // Refresh 60 seconds before expiry
    var msUntilExpiry = (payload.exp * 1000) - Date.now() - 60000;
    if (msUntilExpiry < 5000) msUntilExpiry = 5000;

    var self = this;
    this._refreshTimer = setTimeout(function () {
      self.refreshToken().then(function (ok) {
        if (ok) self._scheduleRefresh();
        else self.logout();
      });
    }, msUntilExpiry);
  };

  /**
   * Show / hide UI elements based on role.
   *   data-role="admin"    — visible only to admins
   *   data-role="analyst"  — visible to admin + analyst
   *   data-role="viewer"   — visible to everyone (default)
   */
  AuthGuard.prototype._applyRoleUI = function () {
    var role = this.getRole();
    var hierarchy = { admin: 3, analyst: 2, viewer: 1 };
    var userLevel = hierarchy[role] || 1;

    document.querySelectorAll('[data-role]').forEach(function (el) {
      var requiredLevel = hierarchy[el.dataset.role] || 1;
      el.style.display = userLevel >= requiredLevel ? '' : 'none';
    });

    // Store role for quick access
    if (role) localStorage.setItem(ROLE_KEY, role);
  };

  /* ── Expose ──────────────────────────────────────────── */
  window.AuthGuard = AuthGuard;
})();
