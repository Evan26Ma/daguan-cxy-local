(() => {
  const completed = new Set();
  let timer;
  window.DaguanSectionCelebration = {
    show(name, id = name) {
      if (completed.has(String(id))) return;
      completed.add(String(id));
      document.querySelector('.section-celebration')?.remove();
      clearTimeout(timer);
      const hint = document.createElement('div');
      hint.className = 'section-celebration';
      hint.setAttribute('role', 'status');
      const label = document.createElement('span');
      label.textContent = `✓ ${name || '本小节'}刷完啦`;
      hint.appendChild(label);
      for (let i = 0; i < 8; i++) {
        const paper = document.createElement('i');
        paper.setAttribute('aria-hidden', 'true');
        paper.style.setProperty('--piece', i);
        hint.appendChild(paper);
      }
      document.body.appendChild(hint);
      timer = setTimeout(() => hint.remove(), 1800);
    },
  };
})();
