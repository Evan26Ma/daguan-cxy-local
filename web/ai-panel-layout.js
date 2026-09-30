(() => {
  const key = 'daguan_ai_drawer_width_v1';
  let width = 400;
  try { width = Number(localStorage.getItem(key)) || 400; } catch {}
  function setWidth(value, persist = true) {
    width = Math.round(Math.max(340, Math.min(620, window.innerWidth - 24, Number(value) || 400)));
    document.documentElement.style.setProperty('--ai-drawer-width', `${width}px`);
    if (persist) try { localStorage.setItem(key, String(width)); } catch {}
    const handle = document.querySelector('.ai-panel-resize');
    handle?.setAttribute('aria-valuemin', '340'); handle?.setAttribute('aria-valuemax', String(Math.min(620, window.innerWidth - 24)));
    handle?.setAttribute('aria-valuenow', String(width)); handle?.setAttribute('aria-valuetext', `${width} 像素`);
  }
  function update() {
    const main = document.getElementById('app-main');
    if (!main) return;
    document.documentElement.style.setProperty('--learning-content-top', `${main.getBoundingClientRect().top}px`);
    setWidth(width, false);
  }
  function bind(panel) {
    const handle = panel.querySelector('.ai-panel-resize');
    if (!handle || handle.bound) return;
    handle.bound = true; update();
    handle.addEventListener('pointerdown', event => {
      if (window.innerWidth <= 672 || event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX, startWidth = width;
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
      event.preventDefault(); setWidth(event.key === 'Home' ? 340 : event.key === 'End' ? 620 : width + (event.key === 'ArrowLeft' ? 16 : -16));
    });
  }
  window.addEventListener('resize', update);
  document.addEventListener('DOMContentLoaded', () => {
    update();
    const main = document.getElementById('app-main');
    if (main) new MutationObserver(() => {
      if (main.querySelector(':scope > .question-layout')) main.scrollTop = 0;
      update();
    }).observe(main, {childList:true});
  });
  window.DaguanAIPanelLayout = {bind, update};
})();
