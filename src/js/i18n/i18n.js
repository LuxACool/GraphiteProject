/* Graphite i18n: centralized UI translation for English, Indonesian and Japanese. */
(function () {
  const SUPPORTED = ['en', 'id', 'ja', 'de'];
  const LOCALE_MODULES = { en: 'en.js', id: 'id.js', ja: 'ja.js', de: 'de.js' };
  const I18N_BASE = new URL('./js/i18n/locales/', document.baseURI);
  const loaded = {};
  let current = 'en';
  let observer = null;
  let applying = false;

  function normalize(code) {
    const c = String(code || '').toLowerCase().split('-')[0];
    return SUPPORTED.includes(c) ? c : 'en';
  }

  function getSavedLanguage() {
    try { return localStorage.getItem('studyos_language'); } catch (_) { return null; }
  }

  function detectLanguage() {
    const saved = getSavedLanguage();
    if (saved) return normalize(saved);
    const browser = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const lang of browser) {
      const normalized = normalize(lang);
      if (SUPPORTED.includes(normalized)) return normalized;
    }
    return 'en';
  }

  async function loadLocale(locale) {
    locale = normalize(locale);
    if (loaded[locale]) return loaded[locale];
    const url = new URL(LOCALE_MODULES[locale], I18N_BASE).href;
    const mod = await import(url);
    loaded[locale] = mod.default || mod;
    return loaded[locale];
  }

  function lookup(key, fallback) {
    const locale = loaded[current];
    if (!locale || !locale.strings) return fallback == null ? key : fallback;
    return Object.prototype.hasOwnProperty.call(locale.strings, key) ? locale.strings[key] : (fallback == null ? key : fallback);
  }

  function translateText(value) {
    const raw = String(value || '');
    const leading = raw.match(/^\s*/)[0];
    const trailing = raw.match(/\s*$/)[0];
    const core = raw.trim();
    if (!core) return raw;
    const translated = lookup(core, null);
    return translated && translated !== core ? leading + translated + trailing : raw;
  }

  function translateElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.matches('script,style,textarea,[contenteditable="true"],[data-i18n-ignore]')) return;
    if (el.hasAttribute('data-i18n')) {
      const key = el.getAttribute('data-i18n');
      el.textContent = lookup(key, el.getAttribute('data-i18n-default') || el.textContent.trim());
    } else if (el.children.length === 0) {
      const original = el.getAttribute('data-i18n-original');
      if (!original) {
        const text = el.textContent;
        const translated = translateText(text);
        if (translated !== text) {
          el.setAttribute('data-i18n-original', text);
          el.textContent = translated;
        }
      } else {
        const translated = translateText(original);
        if (translated !== el.textContent) el.textContent = translated;
      }
    }
    ['title', 'aria-label', 'placeholder'].forEach(attr => {
      if (!el.hasAttribute(attr) || el.hasAttribute('data-i18n-ignore')) return;
      const marker = 'data-i18n-original-' + attr.replace(/[^a-z]/g, '');
      const original = el.getAttribute(marker) || el.getAttribute(attr);
      if (!el.hasAttribute(marker)) el.setAttribute(marker, original);
      const translated = translateText(original);
      if (translated !== original) el.setAttribute(attr, translated);
    });
  }

  function apply(root) {
    if (applying) return;
    applying = true;
    try {
      const scope = root && root.querySelectorAll ? root : document;
      if (scope.nodeType === 1) translateElement(scope);
      scope.querySelectorAll('*').forEach(translateElement);
      document.documentElement.lang = current;
      document.documentElement.dir = 'ltr';
    } finally { applying = false; }
  }

  async function setLanguage(locale, options) {
    const next = normalize(locale);
    await loadLocale(next);
    current = next;
    try { localStorage.setItem('studyos_language', next); } catch (_) {}
    apply(document);
    syncLanguagePicker();
    document.dispatchEvent(new CustomEvent('graphite:languagechange', { detail: { language: current } }));
    if (!(options && options.silent)) window.dispatchEvent(new Event('resize'));
    return current;
  }

  function syncLanguagePicker() {
    const label = document.getElementById('language-current-label');
    if (label && loaded[current]) label.textContent = loaded[current].name;
    const trigger = document.getElementById('language-select-trigger');
    if (trigger && loaded[current]) {
      trigger.querySelector('[data-language-label]')?.replaceChildren(document.createTextNode(loaded[current].name));
      trigger.setAttribute('aria-label', loaded[current].name);
    }
    document.querySelectorAll('[data-language-option]').forEach(btn => {
      const active = btn.dataset.languageOption === current;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
      const check = btn.querySelector('[data-language-check]');
      if (check) check.textContent = active ? '✓' : '';
    });
  }

  function bindLanguagePicker() {
    const trigger = document.getElementById('language-select-trigger');
    const menu = document.getElementById('language-select-menu');
    if (!trigger || !menu || trigger.dataset.i18nBound === '1') return;
    trigger.dataset.i18nBound = '1';

    // Settings lives inside scrolling/overflow-hidden containers. Portal the
    // menu to <body> and position it from the trigger so it cannot be clipped.
    if (menu.parentElement !== document.body) document.body.appendChild(menu);

    const positionMenu = () => {
      if (!menu.classList.contains('is-open')) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 8;
      const viewportPad = 8;
      const width = Math.max(rect.width, 190);
      const maxWidth = Math.max(160, window.innerWidth - viewportPad * 2);
      const menuWidth = Math.min(width, maxWidth);
      let left = rect.right - menuWidth;
      left = Math.max(viewportPad, Math.min(left, window.innerWidth - menuWidth - viewportPad));
      let top = rect.bottom + gap;
      const menuHeight = menu.offsetHeight;
      if (top + menuHeight > window.innerHeight - viewportPad) {
        const above = rect.top - gap - menuHeight;
        if (above >= viewportPad) top = above;
      }
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.width = `${Math.round(menuWidth)}px`;
    };

    const close = () => {
      menu.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    };

    trigger.addEventListener('click', () => {
      const open = !menu.classList.contains('is-open');
      if (open) {
        menu.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(positionMenu);
      } else {
        close();
      }
    });

    window.addEventListener('resize', positionMenu, { passive: true });
    window.addEventListener('scroll', positionMenu, { passive: true, capture: true });

    menu.querySelectorAll('[data-language-option]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await setLanguage(btn.dataset.languageOption);
        close();
      });
    });
    document.addEventListener('click', e => {
      if (!trigger.contains(e.target) && !menu.contains(e.target)) close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  async function init() {
    current = detectLanguage();
    await loadLocale('en');
    if (current !== 'en') await loadLocale(current);
    apply(document);
    syncLanguagePicker();
    bindLanguagePicker();
    if (!observer) {
      observer = new MutationObserver(mutations => {
        if (applying) return;
        for (const mutation of mutations) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1 && !node.closest?.('[data-i18n-ignore]')) apply(node);
          });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.GraphiteI18n = { t: lookup, apply, setLanguage, getLanguage: () => current, supported: SUPPORTED.slice() };
  }

  window.GraphiteI18nReady = init();
})();
