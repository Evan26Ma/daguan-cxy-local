(() => {
  const key = 'daguan_ai_drawer_width_v1';
  let normalWidth = 400, expanded = false, expandedRatio = .55;
  try { normalWidth = Number(localStorage.getItem(key)) || 400; } catch {}
  function bounds() {
    const available = document.getElementById('app-main')?.getBoundingClientRect().width || window.innerWidth;
    const max = expanded && window.innerWidth > 1024
      ? Math.max(340, Math.min(available * .7, available - 360))
      : window.innerWidth > 1024 ? Math.max(340, Math.min(620, available - 360)) : Math.min(620, window.innerWidth - 24);
    return {available, min: Math.min(340, max), max};
  }
  function update() {
    const main = document.getElementById('app-main');
    if (!main) return;
    document.documentElement.style.setProperty('--learning-content-top', `${main.getBoundingClientRect().top}px`);
    const {available, min, max} = bounds();
    const width = Math.round(Math.max(min, Math.min(max, expanded && window.innerWidth > 1024 ? available * expandedRatio : normalWidth)));
    document.documentElement.style.setProperty('--ai-drawer-width', `${width}px`);
    const panel = document.getElementById('ai-panel'), handle = panel?.querySelector('.ai-panel-resize');
    handle?.setAttribute('aria-valuemin', String(Math.round(min)));
    handle?.setAttribute('aria-valuemax', String(Math.round(max)));
    handle?.setAttribute('aria-valuenow', String(width));
    handle?.setAttribute('aria-valuetext', `${width} 像素`);
    const button = panel?.querySelector('#ai-expand-btn');
    if (button) {
      button.textContent = expanded ? '收回' : '展开';
      button.setAttribute('aria-pressed', String(expanded));
      button.disabled = window.innerWidth <= 1024;
    }
    panel?.classList.toggle('ai-expanded', expanded);
    window.DaguanAIReading?.fitInput(panel);
  }
  function setWidth(value) {
    const {available, min, max} = bounds();
    const width = Math.round(Math.max(min, Math.min(max, Number(value) || 400)));
    if (expanded && window.innerWidth > 1024) expandedRatio = width / available;
    else {
      normalWidth = width;
      try { localStorage.setItem(key, String(width)); } catch {}
    }
    update();
  }
  function bind(panel) {
    const handle = panel.querySelector('.ai-panel-resize');
    if (!handle || handle.bound) return;
    handle.bound = true; update();
    panel.querySelector('#ai-expand-btn')?.addEventListener('click', () => {
      expanded = !expanded;
      if (expanded) expandedRatio = .55;
      update();
    });
    handle.addEventListener('pointerdown', event => {
      if (window.innerWidth <= 672 || event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX, startWidth = Number(handle.getAttribute('aria-valuenow'));
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('ai-panel-resizing');
      const move = e => setWidth(startWidth + startX - e.clientX);
      const end = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end); handle.removeEventListener('lostpointercapture', end);
        document.body.classList.remove('ai-panel-resizing');
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
    });
    handle.addEventListener('keydown', event => {
      if (window.innerWidth <= 672 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const {min, max} = bounds(), width = Number(handle.getAttribute('aria-valuenow'));
      setWidth(event.key === 'Home' ? min : event.key === 'End' ? max : width + (event.key === 'ArrowLeft' ? 16 : -16));
    });
  }
  window.addEventListener('resize', update);
  document.addEventListener('DOMContentLoaded', () => {
    update();
    const main = document.getElementById('app-main');
    if (main) {
      new MutationObserver(() => {
        if (main.querySelector(':scope > .question-layout')) main.scrollTop = 0;
        update();
      }).observe(main, {childList:true});
      new ResizeObserver(update).observe(main);
    }
  });
  window.DaguanAIPanelLayout = {bind, update};
})();
