(() => {
  const root = globalThis.BAKandidaten = globalThis.BAKandidaten || {};

  function attributeText(element) {
    return [
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('placeholder'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('name'),
      element?.getAttribute?.('id'),
      element?.name,
      element?.id
    ].filter(Boolean).join(' ');
  }

  function contextText(element) {
    const container = element?.closest?.('form, [role="dialog"], section, article, div');
    return String(container?.innerText || '');
  }

  function editorScore(element) {
    const direct = attributeText(element);
    const context = contextText(element);
    let score = 0;
    if (/(nachricht|message|mitteilung|anschreiben)/i.test(direct)) score += 3;
    if (/(nachricht\s+schreiben|nachricht\s+an|empfänger|betreff)/i.test(context)) score += 2;
    return score;
  }

  function findVisibleBaMessageEditor(document, host) {
    const visible = root.normalizers?.visible || (() => true);
    const candidates = [...(document?.querySelectorAll?.('textarea, [contenteditable="true"]') || [])]
      .filter(element => visible(element))
      .filter(element => !host?.contains?.(element))
      .filter(element => !element.disabled && element.getAttribute?.('aria-disabled') !== 'true')
      .map(element => ({ element, score: editorScore(element) }))
      .filter(item => item.score >= 3)
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) return null;
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
    return candidates[0].element;
  }

  root.messageField = { findVisibleBaMessageEditor, editorScore };
})();
