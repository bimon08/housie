/**
 * Text-to-Speech Number Announcer
 *
 * Uses pre-generated audio files for natural, consistent voice.
 * Falls back to Web Speech API if audio fails.
 *
 * Audio files: /audio/1.m4a through /audio/90.m4a
 */

const TTS = (() => {
  let enabled = true;
  let currentAudio = null;
  let volume = 0.8; // 0 to 1

  // Preload cache
  const audioCache = new Map();

  /**
   * Preload an audio file into cache.
   */
  function preload(n) {
    if (audioCache.has(n)) return;
    const audio = new Audio(`/audio/${n}.m4a`);
    audio.preload = 'auto';
    audioCache.set(n, audio);
  }

  /**
   * Preload the next few numbers for instant playback.
   */
  function preloadRange(start, count) {
    for (let i = start; i <= Math.min(start + count, 90); i++) {
      preload(i);
    }
  }

  /**
   * Announce a number using pre-generated audio.
   */
  function announceNumber(n) {
    if (!enabled || volume === 0) return;
    if (n < 1 || n > 90) return;

    // Stop any currently playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }

    // Try cached audio first
    let audio = audioCache.get(n);
    if (audio) {
      audio.currentTime = 0;
      audio.volume = volume;
      currentAudio = audio;
      audio.play().catch(() => fallbackSpeak(n));
    } else {
      // Load and play
      audio = new Audio(`/audio/${n}.m4a`);
      audio.volume = volume;
      audioCache.set(n, audio);
      currentAudio = audio;
      audio.play().catch(() => fallbackSpeak(n));
    }
  }

  /**
   * Fallback to Web Speech API if audio file fails.
   */
  function fallbackSpeak(n) {
    if (!enabled) return;
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const text = buildAnnouncement(n);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
  }

  // ── Announcement text (used for fallback) ──────────────────────

  const ones = [
    '', 'one', 'two', 'three', 'four', 'five',
    'six', 'seven', 'eight', 'nine',
  ];

  const teens = [
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
    'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  ];

  const tens = [
    '', '', 'twenty', 'thirty', 'forty', 'fifty',
    'sixty', 'seventy', 'eighty', 'ninety',
  ];

  function numberToWord(n) {
    if (n >= 1 && n <= 9) return ones[n];
    if (n >= 10 && n <= 19) return teens[n - 10];
    if (n % 10 === 0) return tens[n / 10];
    return tens[Math.floor(n / 10)] + ' ' + ones[n % 10];
  }

  function buildAnnouncement(n) {
    if (n >= 1 && n <= 9) return `Number ${ones[n]}!`;
    if (n >= 10 && n <= 19) {
      const d2 = ones[n % 10] || 'zero';
      return `${ones[1]} and ${d2}... ${teens[n - 10]}!`;
    }
    if (n % 10 === 0) return `Number ${tens[n / 10]}!`;
    const d1 = ones[Math.floor(n / 10)];
    const d2 = ones[n % 10];
    return `${d1} and ${d2}... ${numberToWord(n)}!`;
  }

  // ── Public API ─────────────────────────────────────────────────

  return {
    announceNumber,
    buildAnnouncement,
    preloadRange,
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); },
    getVolume() { return volume; },
    toggle() {
      enabled = !enabled;
      if (!enabled && currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      return enabled;
    },
    isEnabled() {
      return enabled;
    },
    setMuted(muted) {
      enabled = !muted;
      if (muted) {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
      }
    },
  };
})();
