(() => {
  const root = globalThis.BAKandidaten = globalThis.BAKandidaten || {};

  function clean(value = '') {
    return String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function lines(value = '') {
    return clean(value).split(/\n+/).map(line => line.trim()).filter(Boolean);
  }

  function unique(values = []) {
    const seen = new Set();
    return values.filter(value => {
      const key = clean(value).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function section(text, heading, nextHeadings = []) {
    const all = lines(text);
    const start = all.findIndex(line => line.toLowerCase() === heading.toLowerCase());
    if (start < 0) return [];
    const stops = new Set(nextHeadings.map(item => item.toLowerCase()));
    const output = [];
    for (let index = start + 1; index < all.length; index += 1) {
      if (stops.has(all[index].toLowerCase())) break;
      output.push(all[index]);
    }
    return output;
  }

  function visible(element) {
    if (!element) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    return element.getClientRects?.().length > 0 || Boolean(element.offsetWidth || element.offsetHeight);
  }

  root.normalizers = { clean, lines, unique, section, visible };
})();
