(() => {
  if (window.__ESOS_MANUAL_OUTREACH_V421__) return;
  window.__ESOS_MANUAL_OUTREACH_V421__ = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => clean([
    el?.innerText,
    el?.textContent,
    el?.getAttribute?.('aria-label'),
    el?.getAttribute?.('title'),
  ].filter(Boolean).join(' '));

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0';
  }

  function platform() {
    const host = location.hostname.toLowerCase();
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('xing.com')) return 'xing';
    return 'unknown';
  }

  function realClick(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {}
    try { el.focus({ preventScroll: true }); } catch (_) {}
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        const EventCtor = type === 'pointerdown' ? PointerEvent : MouseEvent;
        el.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, view: window, pointerType: 'mouse' }));
      } catch (_) {}
    }
    try { HTMLElement.prototype.click.call(el); } catch (_) { try { el.click(); } catch (_) {} }
  }

  function setInputValue(el, value) {
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findClickable(pattern, root = document) {
    const nodes = Array.from(root.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="option"]'))
      .filter(visible);
    const hits = nodes.filter((el) => pattern.test(textOf(el)))
      .sort((a, b) => textOf(a).length - textOf(b).length);
    return hits[0] || null;
  }

  async function waitFor(factory, timeout = 7000, interval = 150) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = factory();
      if (result) return result;
      await sleep(interval);
    }
    return null;
  }

  async function linkedinConnect(note) {
    if (platform() !== 'linkedin') return { success: false, error: 'Kein LinkedIn-Tab geöffnet.' };

    let connect = findClickable(/^(vernetzen|connect)$/i)
      || findClickable(/\b(vernetzen|connect)\b/i);

    if (!connect) {
      const more = findClickable(/^(mehr|more)$/i) || findClickable(/\b(mehr|more)\b/i);
      if (more) {
        realClick(more);
        await sleep(350);
        connect = findClickable(/\b(vernetzen|connect)\b/i);
      }
    }

    if (!connect) {
      const pending = findClickable(/\b(ausstehend|pending)\b/i);
      if (pending) return { success: true, alreadyDone: true, detail: 'Vernetzungsanfrage ist bereits ausstehend.' };
      return { success: false, error: '„Vernetzen“ wurde auf diesem Profil nicht gefunden.' };
    }

    realClick(connect);
    const dialog = await waitFor(() => Array.from(document.querySelectorAll('[role="dialog"],dialog,[aria-modal="true"]')).find(visible), 5000);
    if (!dialog) return { success: false, error: 'LinkedIn-Vernetzungsdialog wurde nicht geöffnet.' };

    const safeNote = String(note || '').trim();
    if (safeNote) {
      let addNote = findClickable(/\b(notiz hinzufügen|add a note|personalisieren|personalize)\b/i, dialog);
      if (addNote) {
        realClick(addNote);
        await sleep(250);
      }
      const textarea = Array.from(dialog.querySelectorAll('textarea,input[type="text"]')).find(visible);
      if (textarea) setInputValue(textarea, safeNote.slice(0, 300));
    }

    const send = findClickable(/^(senden|send|einladung senden|send invitation)$/i, dialog)
      || findClickable(/\b(senden|send invitation|send now)\b/i, dialog);
    if (!send) return { success: false, error: 'Senden-Button im Vernetzungsdialog nicht gefunden.' };
    if (send.disabled || send.getAttribute('aria-disabled') === 'true') {
      return { success: false, error: 'LinkedIn hat den Senden-Button deaktiviert.' };
    }

    realClick(send);
    await sleep(600);
    return { success: true, detail: safeNote ? 'Vernetzungsanfrage mit Notiz gesendet.' : 'Vernetzungsanfrage gesendet.' };
  }

  async function linkedinMessage(subject, body) {
    if (platform() !== 'linkedin') return { success: false, error: 'Kein LinkedIn-Tab geöffnet.' };
    const safeBody = String(body || '').trim();
    const safeSubject = String(subject || '').trim();

    let messageButton = findClickable(/^(nachricht|message)$/i)
      || findClickable(/\b(nachricht senden|message)\b/i);

    if (!messageButton) {
      const more = findClickable(/^(mehr|more)$/i) || findClickable(/\b(mehr|more)\b/i);
      if (more) {
        realClick(more);
        await sleep(300);
        messageButton = findClickable(/\b(nachricht|message|inmail)\b/i);
      }
    }

    if (!messageButton) return { success: false, error: '„Nachricht“ / „InMail“ wurde auf diesem Profil nicht gefunden.' };
    realClick(messageButton);

    const composer = await waitFor(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"],dialog,[aria-modal="true"]')).filter(visible);
      const candidates = dialogs.length ? dialogs : [document];
      return candidates.find((root) => root.querySelector('textarea,[contenteditable="true"]'));
    }, 6000);
    if (!composer) return { success: false, error: 'Nachrichtenfenster wurde nicht geöffnet.' };

    if (safeSubject) {
      const subjectInput = Array.from(composer.querySelectorAll('input')).find((el) =>
        visible(el) && /\b(betreff|subject)\b/i.test(textOf(el) + ' ' + (el.placeholder || ''))
      );
      if (subjectInput) setInputValue(subjectInput, safeSubject);
    }

    const textarea = Array.from(composer.querySelectorAll('textarea')).find(visible);
    if (textarea) {
      setInputValue(textarea, safeBody);
    } else {
      const editor = Array.from(composer.querySelectorAll('[contenteditable="true"]')).find(visible);
      if (!editor) return { success: false, error: 'Nachrichtenfeld wurde nicht gefunden.' };
      editor.focus();
      editor.textContent = safeBody;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: safeBody }));
    }

    const send = findClickable(/^(senden|send)$/i, composer)
      || findClickable(/\b(senden|send)\b/i, composer);
    if (!send) return { success: false, error: 'Senden-Button im Nachrichtenfenster nicht gefunden.' };
    if (send.disabled || send.getAttribute('aria-disabled') === 'true') {
      return { success: false, error: 'LinkedIn hat den Senden-Button deaktiviert.' };
    }

    realClick(send);
    await sleep(500);
    return { success: true, detail: 'Nachricht gesendet.' };
  }

  async function xingMessage(body) {
    if (platform() !== 'xing') return { success: false, error: 'Kein XING-Tab geöffnet.' };
    const safeBody = String(body || '').trim();

    const messageButton = findClickable(/\b(nachricht|message|anschreiben)\b/i);
    if (!messageButton) return { success: false, error: 'XING-Nachrichtenfunktion wurde nicht gefunden.' };
    realClick(messageButton);

    const editor = await waitFor(() =>
      Array.from(document.querySelectorAll('textarea,[contenteditable="true"]')).find(visible),
      5000
    );
    if (!editor) return { success: false, error: 'XING-Nachrichtenfeld wurde nicht gefunden.' };

    if (editor.tagName === 'TEXTAREA') setInputValue(editor, safeBody);
    else {
      editor.focus();
      editor.textContent = safeBody;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: safeBody }));
    }

    const send = findClickable(/\b(senden|send)\b/i);
    if (!send) return { success: false, error: 'XING-Senden-Button wurde nicht gefunden.' };
    realClick(send);
    await sleep(500);
    return { success: true, detail: 'XING-Nachricht gesendet.' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ESOS_MANUAL_OUTREACH_V421') return undefined;

    const mode = String(message.mode || '');
    let task;
    if (mode === 'connect') task = linkedinConnect(message.note || '');
    else if (mode === 'message') {
      task = platform() === 'xing'
        ? xingMessage(message.body || '')
        : linkedinMessage(message.subject || '', message.body || '');
    } else {
      task = Promise.resolve({ success: false, error: 'Unbekannter Outreach-Modus.' });
    }

    task.then(sendResponse).catch((error) => {
      sendResponse({ success: false, error: error?.message || String(error) });
    });
    return true;
  });
})();