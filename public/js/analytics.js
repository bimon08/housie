/**
 * PostHog Analytics Integration
 *
 * Loads the PostHog JS library from CDN and initializes it
 * using the POSTHOG_KEY from the server /api/config endpoint.
 */

window.Analytics = (() => {
  let isInitialized = false;

  // Load the actual PostHog JS library from CDN
  function loadPostHogLibrary(apiHost) {
    return new Promise((resolve, reject) => {
      // If posthog is already loaded (not just a stub), resolve immediately
      if (window.posthog && window.posthog.__loaded) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.async = true;
      script.src = apiHost.replace(/\/$/, '') + '/static/array.js';
      script.onload = () => {
        console.log('[Analytics] PostHog library loaded from CDN');
        resolve();
      };
      script.onerror = (e) => {
        console.warn('[Analytics] Failed to load PostHog library from CDN:', e);
        reject(e);
      };
      document.head.appendChild(script);
    });
  }

  // Initialize: fetch config, load library, then call posthog.init()
  try {
    fetch('/api/config')
      .then((res) => res.json())
      .then(async (config) => {
        const key = config.posthogKey || window.POSTHOG_KEY;
        const host = config.posthogHost || window.POSTHOG_HOST || 'https://us.i.posthog.com';

        if (!key) {
          console.log('[Analytics] No PostHog key configured, skipping init');
          return;
        }

        console.log('[Analytics] PostHog key found, loading library...');

        // Load the real PostHog JS library from CDN
        await loadPostHogLibrary(host);

        if (window.posthog && typeof window.posthog.init === 'function') {
          window.posthog.init(key, {
            api_host: host,
            person_profiles: 'identified_only',
            capture_pageview: true,
            capture_pageleave: true,
            // Enable session recording
            disable_session_recording: false,
          });
          isInitialized = true;
          console.log('[Analytics] PostHog initialized successfully');
        } else {
          console.warn('[Analytics] PostHog library loaded but init function not available');
        }
      })
      .catch((e) => {
        console.warn('[Analytics] Failed to fetch config:', e);
      });
  } catch (e) {
    console.warn('[Analytics] Analytics init failed:', e);
  }

  function track(eventName, properties = {}) {
    try {
      if (window.posthog && typeof window.posthog.capture === 'function') {
        window.posthog.capture(eventName, properties);
      }
    } catch (e) {}
  }

  function identify(userId, traits = {}) {
    try {
      if (window.posthog && typeof window.posthog.identify === 'function') {
        window.posthog.identify(userId, traits);
      }
    } catch (e) {}
  }

  return {
    track,
    identify,
  };
})();
