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
    closeBlockMenu(panel);
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
  // 回答里的每个段落都能点开追问：四个入口都按考研视角提问。
  const BLOCK_QUESTIONS = [
    {label: '这个是怎么来的', prompt: '这一段是怎么来的？请从考研复习的角度说明它的来源：用到了哪条定义、定理或公式，又是根据题干（或上一步）的哪条信息得到它的。'},
    {label: '什么意思', prompt: '这一段是什么意思？请用更直白的中文解释一遍，并说明它在考研题里通常怎么用、对应哪类题型。'},
    {label: '什么知识点', prompt: '这一段涉及什么知识点？请说明它在考研大纲中的位置与要求层次（了解／理解／掌握）、历年真题里的常见考法，以及卷面上常见的形式。'},
    {label: '你有什么想法', prompt: '关于这一段，你有什么想法或补充？请从考研解题和得分的角度，谈谈值得注意的地方、可以推广的结论或常见陷阱。'},
  ];
  const BLOCK_SELECTOR = 'p, li, td, th, blockquote, pre, h1, h2, h3, h4, h5, h6';
  const BLOCK_TEXT_LIMIT = 600;
  function blockOf(target, bubble) {
    const block = target?.closest?.(BLOCK_SELECTOR);
    return block && bubble.contains(block) ? block : null;
  }
  function blockText(block) {
    const text = String(block?.innerText || block?.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > BLOCK_TEXT_LIMIT ? `${text.slice(0, BLOCK_TEXT_LIMIT)}…` : text;
  }
  function closeBlockMenu(panel = panelElement()) {
    const menu = panel?.querySelector?.('.ai-block-menu');
    if (menu) menu.hidden = true;
    panel?.querySelectorAll?.('.ai-block-active').forEach(el => el.classList.remove('ai-block-active'));
  }
  function openBlockMenu(panel, block) {
    const menu = panel.querySelector('.ai-block-menu');
    if (!menu) return;
    panel.querySelectorAll('.ai-block-active').forEach(el => el.classList.remove('ai-block-active'));
    block.classList.add('ai-block-active');
    panel.reading.blockTarget = block;
    menu.hidden = false;
    menu.style.left = '8px'; menu.style.top = '8px';
    const panelBox = panel.getBoundingClientRect(), blockBox = block.getBoundingClientRect(), menuBox = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, panel.clientWidth - menuBox.width - 8);
    const left = Math.min(Math.max(blockBox.left - panelBox.left, 8), maxLeft);
    let top = blockBox.bottom - panelBox.top + 6;
    if (top + menuBox.height > panel.clientHeight - 8) top = Math.max(8, blockBox.top - panelBox.top - menuBox.height - 6);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }
  function askAboutBlock(panel, item) {
    const snippet = blockText(panel.reading.blockTarget);
    closeBlockMenu(panel);
    const input = panel.querySelector('#ai-input');
    if (input) {
      input.value = snippet ? `关于你上面回答里的这一段：\n「${snippet}」\n\n${item.prompt}` : item.prompt;
      fitInput(panel);
    }
    // 正在生成时留在输入框里，等这一轮结束再让用户发送，避免打断流式回答。
    if (document.getElementById('ai-current-response')) return;
    window.App?.sendAIMessage?.();
  }
  function buildBlockMenu(panel) {
    let menu = panel.querySelector('.ai-block-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'ai-block-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '针对这一段的追问');
    menu.hidden = true;
    BLOCK_QUESTIONS.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.addEventListener('click', () => askAboutBlock(panel, item));
      menu.appendChild(button);
    });
    panel.appendChild(menu);
    return menu;
  }
  function bind(panel) {
    panel.reading = {follow: true, sectionId: 0, blockTarget: null};
    const messages = panel.querySelector('#ai-messages');
    messages.addEventListener('scroll', () => {
      panel.reading.follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
      closeBlockMenu(panel);
      syncLatest(panel);
    });
    buildBlockMenu(panel);
    messages.addEventListener('click', event => {
      if (event.target.closest('a, button, img')) return;
      const bubble = event.target.closest('.ai-message.assistant .ai-message-bubble');
      const block = bubble && blockOf(event.target, bubble);
      if (!block) { closeBlockMenu(panel); return; }
      const selection = window.getSelection?.();
      if (selection && !selection.isCollapsed && String(selection).trim()) return;
      openBlockMenu(panel, block);
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
      if (event.key !== 'Escape') return;
      if (!menu.hidden) {
        event.preventDefault(); event.stopPropagation(); closeSettings(panel, true); return;
      }
      const blockMenu = panel.querySelector('.ai-block-menu');
      if (blockMenu && !blockMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeBlockMenu(panel); }
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
    if (!event.target.closest('.ai-block-menu')) closeBlockMenu(panelElement());
  });
  document.addEventListener('focusin', event => {
    if (!event.target.closest('#ai-panel-settings, #ai-settings-btn')) closeSettings(panelElement());
  });
  window.DaguanAIReading = {bind, fitInput, paintMessages, refreshSections, toLatest};
})();
