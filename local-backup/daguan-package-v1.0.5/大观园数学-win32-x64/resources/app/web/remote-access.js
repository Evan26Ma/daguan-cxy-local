(() => {
  if (location.protocol !== 'https:') return;
  fetch('/__remote/status', { cache: 'no-store' }).then(response => {
    if (!response.ok) return;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '退出远程登录';
    button.title = '退出当前浏览器的远程会话';
    Object.assign(button.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '999999', padding: '9px 13px', borderRadius: '9px', border: '1px solid #ddd', background: '#fff', color: '#9c251e', cursor: 'pointer', boxShadow: '0 3px 14px #0002' });
    button.onclick = async () => {
      try { await fetch('/__remote/logout', { method: 'POST', cache: 'no-store' }); }
      finally { location.replace('/__remote/login'); }
    };
    document.body.appendChild(button);
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(items => Promise.all(items.map(item => item.unregister()))).catch(() => {});
  }).catch(() => {});
})();
