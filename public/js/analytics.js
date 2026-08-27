/**
 * PostHog Analytics Integration
 *
 * Automatically loads PostHog JS snippet if POSTHOG_KEY environment
 * variable or window.POSTHOG_KEY is configured.
 */

window.Analytics = (() => {
  let isInitialized = false;

  // Load PostHog snippet asynchronously — only when init() is called with config
  function loadPostHogSnippet() {
    try {
      !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}var u=e;for("undefined"!=typeof a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},p="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getActiveMatchingSurveys getNextSurveyStep onSessionId".split(" "),r=0;r<p.length;r++)g(u,p[r]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    } catch (e) {
      console.warn('PostHog snippet failed to load:', e);
    }
  }

  // Initialize: load stub first, then fetch config and call posthog.init()
  try {
    loadPostHogSnippet();

    fetch('/api/config')
      .then((res) => res.json())
      .then((config) => {
        const key = config.posthogKey || window.POSTHOG_KEY;
        const host = config.posthogHost || window.POSTHOG_HOST || 'https://us.i.posthog.com';

        if (key && window.posthog && typeof window.posthog.init === 'function') {
          window.posthog.init(key, {
            api_host: host,
            person_profiles: 'identified_only',
            capture_pageview: true,
            capture_pageleave: true,
          });
          isInitialized = true;
        }
      })
      .catch(() => {});
  } catch (e) {
    console.warn('Analytics init failed:', e);
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
