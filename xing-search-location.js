// XING search helper for ESOS SocialFinder.
// Applies the real XING "Ort" filter only when the SocialFinder search URL
// explicitly contains a non-empty `location` parameter.

(function () {
  'use strict';

  const MEMBER_SEARCH_PATH = /^\/search\/members\/?$/i;
  const POLL_INTERVAL_MS = 250;
  const INPUT_WAIT_MS = 12000;
  const OPTION_WAIT_MS = 2500;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('de-DE');
  }

  function requestedLocationFromUrl(href) {
    try {
      const url = new URL(href);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      if (!(hostname === 'xing.com' || hostname.endsWith('.xing.com'))) return '';
      if (!MEMBER_SEARCH_PATH.test(url.pathname)) return '';
      return String(url.searchParams.get('location') || '').trim();
    } catch {
      return '';
    }
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findLocationInput() {
    const selectors = [
      'input[placeholder*="München" i]',
      'input[placeholder*="Munich" i]',
      'input[aria-label*="Ort" i]',
      'input[aria-label*="Location" i]',
      'input[name*="location" i]',
      'input[data-qa*="location" i]',
      'input[data-testid*="location" i]'
    ];

    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate && isVisible(candidate)) return candidate;
    }

    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'));
    return inputs.find(input => {
      if (!isVisible(input)) return false;
      const ownText = [
        input.placeholder,
        input.getAttribute('aria-label'),
        input.name,
        input.id
      ].filter(Boolean).join(' ');
      if (/\b(?:ort|location|stadt)\b/i.test(ownText)) return true;

      const nearby = input.closest('label, [role="group"], div');
      const nearbyText = String(nearby?.innerText || '').replace(/\s+/g, ' ').trim();
      return nearbyText.length <= 100 && /\bort\b/i.test(nearbyText) && !/\bplz\b|bundesland/i.test(nearbyText);
    }) || null;
  }

  function setNativeInputValue(input, value) {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;

    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function dispatchEnter(input) {
    const options = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    };
    input.dispatchEvent(new KeyboardEvent('keydown', options));
    input.dispatchEvent(new KeyboardEvent('keypress', options));
    input.dispatchEvent(new KeyboardEvent('keyup', options));
  }

  function findMatchingSuggestion(requestedLocation) {
    const requested = normalizeText(requestedLocation);
    const selectors = [
      '[role="option"]',
      '[data-qa*="suggest" i]',
      '[data-testid*="suggest" i]',
      '[class*="suggestion" i]'
    ];
    const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
    return candidates.find(element => {
      if (!isVisible(element)) return false;
      const text = normalizeText(element.textContent);
      if (!text) return false;
      return text === requested
        || text.startsWith(`${requested},`)
        || text.startsWith(`${requested} `)
        || text.includes(` ${requested},`);
    }) || null;
  }

  async function waitFor(getter, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = getter();
      if (result) return result;
      await sleep(POLL_INTERVAL_MS);
    }
    return null;
  }

  async function applyRequestedXingLocation() {
    const requestedLocation = requestedLocationFromUrl(window.location.href);
    if (!requestedLocation) return false;

    const storageKey = `esos:xing-location:${window.location.pathname}:${normalizeText(requestedLocation)}`;
    if (window.sessionStorage.getItem(storageKey) === 'applied') return true;

    const input = await waitFor(findLocationInput, INPUT_WAIT_MS);
    if (!input) return false;

    input.scrollIntoView({ block: 'center', behavior: 'auto' });
    input.focus();

    if (normalizeText(input.value) !== normalizeText(requestedLocation)) {
      setNativeInputValue(input, requestedLocation);
      await sleep(400);
    }

    const matchingSuggestion = await waitFor(
      () => findMatchingSuggestion(requestedLocation),
      OPTION_WAIT_MS
    );

    if (matchingSuggestion) {
      matchingSuggestion.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      matchingSuggestion.click();
      matchingSuggestion.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    } else {
      dispatchEnter(input);
    }

    await sleep(500);
    window.sessionStorage.setItem(storageKey, 'applied');
    return true;
  }

  let lastHref = window.location.href;
  let scheduled = false;

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      applyRequestedXingLocation().catch(() => {});
    }, 100);
  }

  scheduleApply();

  const observer = new MutationObserver(() => {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    scheduleApply();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleApply);
})();
