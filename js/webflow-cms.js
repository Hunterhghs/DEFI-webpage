/**
 * WEBFLOW CMS INTEGRATION LAYER
 * ==============================
 * Connects to the Webflow Data API to pull CMS content dynamically.
 *
 * PREREQUISITE: Your site token needs these scopes in Webflow:
 *   - sites:read
 *   - cms:read
 *
 * Set scopes at: Site Settings > Apps & Integrations > API Access
 *
 * Once scopes are active, set your token below and this module will:
 *   1. Fetch your Webflow site and CMS collections
 *   2. Map CMS items to page sections
 *   3. Cache responses in localStorage (24h TTL)
 *   4. Fall back to static HTML content when API is unavailable
 *
 * @usage
 *   Include this script before </body>.
 *   Configure the SITE_TOKEN and SITE_ID below.
 *   Call WebflowCMS.init() to bootstrap CMS content.
 */

var WebflowCMS = (function () {
  'use strict';

  /* =============================================================
     CONFIGURATION — Update these values for your Webflow site
     ============================================================= */
  var CONFIG = {
    // Your Webflow site token (provided by you)
    SITE_TOKEN: 'ws-c5e592b3ec5db588a1921d4fdd37d5b3d63af70a3527e8c8e0cdd37bfb9836ca',

    // Set this to your Webflow site ID once discovered via the API.
    // Run fetchSites() first to find it, then update this value.
    SITE_ID: '',

    // Base URL for the Webflow Data API v2
    API_BASE: 'https://api.webflow.com/v2',

    // Cache TTL in milliseconds (24 hours)
    CACHE_TTL: 24 * 60 * 60 * 1000,

    // Cache key prefix for localStorage
    CACHE_PREFIX: 'webflow_cms_',

    // Whether to use cached data when API is unavailable
    USE_CACHE_FALLBACK: true
  };

  /* =============================================================
     API CLIENT
     ============================================================= */
  function apiRequest(path) {
    return fetch(CONFIG.API_BASE + path, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.SITE_TOKEN,
        'Accept': 'application/json'
      }
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (err) {
          throw new Error('Webflow API Error (' + res.status + '): ' + (err.message || JSON.stringify(err)));
        });
      }
      return res.json();
    });
  }

  /* =============================================================
     CACHE LAYER
     ============================================================= */
  function cacheKey(key) {
    return CONFIG.CACHE_PREFIX + key;
  }

  function cacheGet(key) {
    try {
      var entry = JSON.parse(localStorage.getItem(cacheKey(key)));
      if (!entry) return null;
      if (Date.now() - entry.timestamp > CONFIG.CACHE_TTL) {
        localStorage.removeItem(cacheKey(key));
        return null;
      }
      return entry.data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(cacheKey(key), JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) {
      // localStorage full — quietly ignore
    }
  }

  /* =============================================================
     DATA FETCHERS
     ============================================================= */
  function fetchSites() {
    var cached = cacheGet('sites');
    if (cached) return Promise.resolve(cached);

    return apiRequest('/sites').then(function (data) {
      cacheSet('sites', data);
      console.log('[WebflowCMS] Sites:', data);
      return data;
    });
  }

  function fetchCollections(siteId) {
    var key = 'collections_' + siteId;
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);

    return apiRequest('/sites/' + siteId + '/collections').then(function (data) {
      cacheSet(key, data);
      console.log('[WebflowCMS] Collections:', data);
      return data;
    });
  }

  function fetchCollectionItems(siteId, collectionId) {
    var key = 'items_' + collectionId;
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);

    return apiRequest('/collections/' + collectionId + '/items').then(function (data) {
      cacheSet(key, data);
      console.log('[WebflowCMS] Items for ' + collectionId + ':', data);
      return data;
    });
  }

  /* =============================================================
     MAPPING ENGINE — Maps CMS content to DOM elements
     ============================================================= */
  function applyContent(mapping) {
    Object.keys(mapping).forEach(function (selector) {
      var el = document.querySelector(selector);
      if (!el) return;
      var value = mapping[selector];
      if (typeof value === 'string') {
        el.textContent = value;
      } else if (value.html) {
        el.innerHTML = value.html;
      }
    });
  }

  /**
   * Maps CMS collection items to page sections.
   * Customize this function to match your Webflow CMS schema.
   *
   * Example Webflow CMS Collection schema:
   *   Collection: "DeFi Sections"
   *   Fields: title (plain text), body (rich text), order (number)
   */
  function mapItemsToContent(items, collectionName) {
    if (!items || !items.length) return;

    console.log('[WebflowCMS] Mapping ' + items.length + ' items from "' + collectionName + '"');

    // Example mapping — adapt to your CMS schema:
    items.forEach(function (item) {
      var fieldData = item.fieldData || {};

      // Map based on a "section-id" field or "slug"
      if (fieldData['section-id']) {
        applyContent({
          '#' + fieldData['section-id'] + ' .section__title': fieldData.title || '',
          '#' + fieldData['section-id'] + ' .section__desc': fieldData['description'] || ''
        });
      }
    });
  }

  /* =============================================================
     PUBLIC API
     ============================================================= */

  /**
   * Initialize the Webflow CMS integration.
   * Discovers your site, fetches collections, and maps content.
   */
  function init() {
    if (!CONFIG.SITE_TOKEN) {
      console.warn('[WebflowCMS] No SITE_TOKEN configured. Set it in js/webflow-cms.js.');
      return Promise.resolve({ status: 'skipped', reason: 'No token configured' });
    }

    console.log('[WebflowCMS] Initializing...');

    return fetchSites().then(function (data) {
      var sites = data.sites || [];

      if (!sites.length) {
        console.warn('[WebflowCMS] No sites found for this token.');
        return { status: 'no_sites' };
      }

      // If SITE_ID is configured, use it. Otherwise use the first site.
      var siteId = CONFIG.SITE_ID || sites[0].id;
      var site = sites.find(function (s) { return s.id === siteId; }) || sites[0];

      if (!CONFIG.SITE_ID) {
        console.log('[WebflowCMS] Using first available site:',
          site.displayName, '(' + site.id + ')');
        console.log('[WebflowCMS] To target a specific site, set CONFIG.SITE_ID = "' + site.id + '"');
      }

      return fetchCollections(siteId).then(function (colData) {
        var collections = colData.collections || [];
        console.log('[WebflowCMS] Found ' + collections.length + ' collections:');

        var fetches = collections.map(function (col) {
          console.log('  - ' + col.displayName + ' (' + col.slug + ')');
          return fetchCollectionItems(siteId, col.id).then(function (itemData) {
            mapItemsToContent(itemData.items, col.displayName);
            return { collection: col, itemCount: (itemData.items || []).length };
          });
        });

        return Promise.all(fetches).then(function (results) {
          console.log('[WebflowCMS] Initialization complete. Ready.');
          return {
            status: 'ok',
            site: site.displayName,
            siteId: siteId,
            collections: results
          };
        });
      });
    }).catch(function (err) {
      console.error('[WebflowCMS] Initialization failed:', err.message);

      if (CONFIG.USE_CACHE_FALLBACK) {
        console.log('[WebflowCMS] Using cached data as fallback.');
        return { status: 'cached_fallback', error: err.message };
      }

      return { status: 'error', error: err.message };
    });
  }

  /**
   * Clear all cached Webflow CMS data.
   */
  function clearCache() {
    var keys = Object.keys(localStorage);
    var cleared = 0;
    keys.forEach(function (key) {
      if (key.indexOf(CONFIG.CACHE_PREFIX) === 0) {
        localStorage.removeItem(key);
        cleared++;
      }
    });
    console.log('[WebflowCMS] Cleared ' + cleared + ' cache entries.');
    return cleared;
  }

  /**
   * Discover available sites for the configured token.
   * Useful for finding your SITE_ID.
   */
  function discover() {
    return fetchSites().then(function (data) {
      console.log('[WebflowCMS] === Your Webflow Sites ===');
      (data.sites || []).forEach(function (site) {
        console.log('  ID:   ' + site.id);
        console.log('  Name: ' + site.displayName);
        console.log('  Slug: ' + site.shortName);
        console.log('  ---');
      });
      console.log('[WebflowCMS] Set CONFIG.SITE_ID to the ID above.');
      return data;
    });
  }

  // Public API
  return {
    init: init,
    discover: discover,
    clearCache: clearCache,
    fetchSites: fetchSites,
    fetchCollections: fetchCollections
  };

})();

// --- Auto-initialize on load (uncomment when token is ready) ---
// WebflowCMS.init().then(function (result) {
//   console.log('[WebflowCMS] Result:', result);
// });
