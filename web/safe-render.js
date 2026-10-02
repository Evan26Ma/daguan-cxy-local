// Local DOMPurify + marked + KaTeX. No content may add application actions.
(function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const forbidden = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'audio', 'video', 'source', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set', 'use'];
  function create({ assetUrl = value => value } = {}) {
    const purifier = typeof root.DOMPurify === 'function' ? root.DOMPurify(root) : null;
    let phase = 'raw';
    let svgPrefix = '';
    const fragment = value => /^#[\w:.-]+$/.test(value) ? '#' + svgPrefix + value.slice(1) : null;
    purifier?.addHook('uponSanitizeAttribute', (node, data) => {
      const name = data.attrName.toLowerCase();
      const value = data.attrValue.trim();
      if (/^on|^data-/.test(name) || ['name', 'srcset', 'formaction', 'action'].includes(name)) data.keepAttr = false;
      if (name === 'id') {
        if (phase === 'svg' && /^[\w:.-]+$/.test(value)) data.attrValue = svgPrefix + value;
        else data.keepAttr = false;
      }
      if (phase === 'raw' && ['style', 'class', 'role', 'tabindex'].includes(name)) data.keepAttr = false;
      if (phase === 'svg' && name === 'style') {
        // Matplotlib uses presentation styles. Transfer only literal, safe SVG values.
        for (const declaration of value.split(';')) {
          const match = declaration.trim().match(/^(fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|fill-opacity|stroke-opacity|opacity|font-size|text-anchor)\s*:\s*([\w#.,% ()-]+)$/);
          if (match && !/url|expression|var\s*\(/i.test(match[2])) node.setAttribute(match[1], match[2]);
        }
      }
      if (phase === 'svg' || node.namespaceURI === 'http://www.w3.org/2000/svg') {
        if (name === 'style' || name === 'src') data.keepAttr = false;
        if (name.endsWith('href')) {
          const target = phase === 'svg' && fragment(value);
          if (target) data.attrValue = target;
          else data.keepAttr = false;
        }
      }
      if (/url\s*\(/i.test(value)) {
        const match = phase === 'svg' && value.match(/^url\((#[\w:.-]+)\)$/);
        if (match) data.attrValue = `url(${fragment(match[1])})`;
        else data.keepAttr = false;
      }
      if (name === 'href' && phase !== 'svg') {
        try {
          const url = new URL(value, root.location.href);
          const local = url.protocol === root.location.protocol && url.host === root.location.host;
          if ((!local && !['https:', 'http:', 'mailto:'].includes(url.protocol)) || url.username || url.password) data.keepAttr = false;
        } catch { data.keepAttr = false; }
      }
      if (name === 'src') {
        try {
          const mapped = assetUrl(value);
          const url = new URL(mapped, root.location.href);
          const local = url.protocol === root.location.protocol && url.host === root.location.host;
          if (local || /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(mapped)) data.attrValue = mapped;
          else data.keepAttr = false;
        } catch { data.keepAttr = false; }
      }
    });
    purifier?.addHook('afterSanitizeAttributes', node => {
      if (node.nodeName.toLowerCase() === 'img') {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('decoding', 'async');
        node.setAttribute('tabindex', '0');
        node.setAttribute('role', 'button');
        node.setAttribute('title', '点击放大图片');
        if (!node.getAttribute('alt')) node.setAttribute('alt', '题目配图');
      }
      if (node.nodeName.toLowerCase() === 'a') node.setAttribute('rel', 'noopener noreferrer');
    });
    function clean(html, mode) {
      if (!purifier?.isSupported) return escape(html);
      phase = mode;
      return purifier.sanitize(String(html), {
        USE_PROFILES: mode === 'svg' ? { svg: true } : { html: true, mathMl: true, svg: true },
        FORBID_TAGS: mode === 'svg' ? forbidden.filter(tag => tag !== 'use') : forbidden,
        ADD_TAGS: mode === 'svg' ? ['use'] : [],
        FORBID_ATTR: mode === 'svg' ? ['name'] : ['id', 'name'],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: mode !== 'raw',
        ALLOW_UNKNOWN_PROTOCOLS: false,
      });
    }
    function markdown(value) {
      const raw = String(value ?? '');
      if (!purifier?.isSupported) return escape(raw).replace(/\n/g, '<br>');
      const slots = [];
      const token = 'DAGUANMATH' + Math.random().toString(36).slice(2) + 'SLOT';
      const slot = (tex, display) => { slots.push({ tex, display }); return `${token}${slots.length - 1}END`; };
      let source = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => slot(tex, true))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => slot(tex, true))
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => slot(tex, false))
        .replace(/\$([^$\n]+?)\$/g, (_, tex) => slot(tex, false));
      try {
        source = root.marked ? root.marked.parse(source, { breaks: true }) : escape(source).replace(/\n/g, '<br>');
        // Remove untrusted styles/actions before introducing trusted KaTeX markup.
        source = clean(source, 'raw');
        source = source.replace(new RegExp(`${token}(\\d+)END`, 'g'), (_, index) => {
          const item = slots[Number(index)];
          try {
            return root.katex ? root.katex.renderToString(item.tex, { displayMode: item.display, throwOnError: false, strict: 'ignore', trust: false }) : escape(item.display ? `$$${item.tex}$$` : `$${item.tex}$`);
          } catch { return escape(item.tex); }
        });
        return clean(source, 'final');
      } catch { return escape(raw).replace(/\n/g, '<br>'); }
    }
    return Object.freeze({ markdown, svg: html => {
      svgPrefix = 'daguan-svg-' + Math.random().toString(36).slice(2) + '-';
      return clean(html, 'svg');
    } });
  }
  root.DaguanSafeRender = Object.freeze({ create });
})(window);
