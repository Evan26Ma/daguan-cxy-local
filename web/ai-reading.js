// New UI only: disclosure controls and reading position never replace the chat DOM.
(() => {
  const panelElement = () => document.getElementById('ai-panel');
  function fitInput(panel = panelElement()) {
    const input = panel?.querySelector('#ai-input');
    if (!input || !input.isConnected) return;
    input.style.height = 'auto';
    const style = getComputedStyle(input), line = parseFloat(style.lineHeight) || 24;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    input.style.height = `${Math.min(input.scrollHeight + 2, line * 5 + padding + 2)}px`;
    const actions = panel.querySelector('.ai-reading-actions');
    if (actions) actions.style.bottom = `${panel.querySelector('.ai-input-area').offsetHeight + 12}px`;
    const menu = panel.querySelector('#ai-panel-settings');
    if (menu) menu.style.top = `${panel.querySelector('.ai-header').offsetHeight + 4}px`;
  }
  function syncLatest(panel) {
    const button = panel.querySelector('#ai-latest-btn');
    if (button) button.hidden = panel.reading.follow;
  }
  function toLatest(panel = panelElement()) {
    if (!panel?.reading) return;
    panel.reading.follow = true;
    const messages = panel.querySelector('#ai-messages');
    messages.scrollTop = messages.scrollHeight;
    syncLatest(panel);
  }
  // Capture the scroll decision BEFORE changing height, including the final Markdown paint.
  function paintMessages(panel, paint) {
    if (!panel?.reading) { paint(); return; }
    const messages = panel.querySelector('#ai-messages');
    const top = messages.scrollTop, follow = panel.reading.follow;
    paint();
    messages.scrollTop = follow ? messages.scrollHeight : top;
    syncLatest(panel);
  }
  function refreshSections(panel = panelElement()) {
    const nav = panel?.querySelector('#ai-section-nav');
    if (!nav) return;
    const response = [...panel.querySelectorAll('.ai-message.assistant')].at(-1);
    const allHeadings = response ? [...response.querySelectorAll('h1,h2,h3,h4,h5,h6')] : [];
    const topLevel = Math.min(...allHeadings.map(heading => Number(heading.tagName.slice(1))));
    const headings = allHeadings.filter(heading => Number(heading.tagName.slice(1)) === topLevel);
    nav.replaceChildren();
    nav.hidden = !headings.length;
    headings.forEach((heading, index) => {
      // Only the current answer is in the navigation; historical heading IDs stay unique.
      if (!heading.id) heading.id = `ai-section-${panel.reading.sectionId++}`;
      heading.tabIndex = -1;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = heading.textContent;
      button.addEventListener('click', () => {
        panel.reading.follow = false;
        const messages = panel.querySelector('#ai-messages');
        messages.scrollTop += heading.getBoundingClientRect().top - messages.getBoundingClientRect().top - 16;
        heading.focus({preventScroll: true});
        syncLatest(panel);
      });
      nav.appendChild(button);
    });
  }
  function closeSettings(panel, restoreFocus = false) {
    const menu = panel?.querySelector('#ai-panel-settings');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    const button = panel.querySelector('#ai-settings-btn');
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  }
  function bind(panel) {
    panel.reading = {follow: true, sectionId: 0};
    const messages = panel.querySelector('#ai-messages');
    messages.addEventListener('scroll', () => {
      panel.reading.follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
      syncLatest(panel);
    });
    panel.querySelector('#ai-latest-btn').addEventListener('click', () => toLatest(panel));
    panel.querySelector('#ai-input').addEventListener('input', () => fitInput(panel));
    const menu = panel.querySelector('#ai-panel-settings'), settings = panel.querySelector('#ai-settings-btn');
    settings.addEventListener('click', () => {
      if (!menu.hidden) { closeSettings(panel, true); return; }
      menu.hidden = false;
      settings.setAttribute('aria-expanded', 'true');
      menu.querySelector('select').focus();
    });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault(); event.stopPropagation(); closeSettings(panel, true);
      }
    });
    const privacy = panel.querySelector('#ai-include-private-new');
    try { privacy.checked = sessionStorage.getItem('daguan_new_ai_private') === '1'; } catch {}
    const syncPrivacy = () => {
      panel.querySelector('#ai-private-status').hidden = !privacy.checked;
      try { sessionStorage.setItem('daguan_new_ai_private', privacy.checked ? '1' : '0'); } catch {}
    };
    privacy.addEventListener('change', syncPrivacy); syncPrivacy();
    fitInput(panel);
  }
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('#ai-panel-settings, #ai-settings-btn')) closeSettings(panelElement());
  });
  document.addEventListener('focusin', event => {
    if (!event.target.closest('#ai-panel-settings, #ai-settings-btn')) closeSettings(panelElement());
  });
  window.DaguanAIReading = {bind, fitInput, paintMessages, refreshSections, toLatest};
})();
