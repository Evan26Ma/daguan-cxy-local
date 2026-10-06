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
    function clean(html, mode, nativeHtml = false) {
      if (!purifier?.isSupported) return escape(html);
      phase = mode;
      return purifier.sanitize(String(html), {
        USE_PROFILES: mode === 'svg' ? { svg: true } : { html: true, mathMl: true, svg: true },
        FORBID_TAGS: mode === 'svg' ? forbidden.filter(tag => tag !== 'use') : forbidden,
        ADD_TAGS: mode === 'svg' ? ['use'] : [],
        FORBID_ATTR: mode === 'svg' ? ['name'] : ['id', 'name'],
        // MinerU 原生 MathML 携带 <annotation encoding="application/x-tex"> 源码；
        // DOMPurify 默认只去掉 annotation 标签本身、留下其中的原始 TeX 文本，会和公式重复显示。
        // 这里连同 annotation/annotation-xml 的内容一并丢弃，只保留原生结构排版。
        ADD_FORBID_CONTENTS: nativeHtml ? ['annotation', 'annotation-xml'] : [],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: mode !== 'raw',
        ALLOW_UNKNOWN_PROTOCOLS: false,
      });
    }
    // MinerU 片段可能把公式转成 MathML，也可能留下独立的 $$...$$/$...$/\[...\]/\(...\) 文本。
    // 这两类混排必须分开处理：只把纯文本节点里的定界 TeX 交给 KaTeX 渲染，绝不把整段原生 HTML
    // 丢给 marked/KaTeX，也不改动已有 MathML/表格/图片 URL。
    const texSkipTags = new Set(['MATH', 'SVG', 'CODE', 'PRE', 'SCRIPT', 'STYLE']);
    // 关闭定界符必须跳过被反斜杠转义的字符：TeX 里的 `\\]`、`\\)`、`\$$` 等不是公式结束符，
    // 用带转义感知的扫描替代盲目的 indexOf，避免在转义序列处提前截断。
    function findClosing(text, token, from) {
      for (let at = text.indexOf(token, from); at !== -1; at = text.indexOf(token, at + 1)) {
        let escapes = 0;
        for (let k = at - 1; k >= 0 && text[k] === '\\'; k -= 1) escapes += 1;
        if (escapes % 2 === 0) return at;
      }
      return -1;
    }
    function tokenizeTex(text) {
      const out = [];
      let buffer = '';
      let index = 0;
      const length = text.length;
      const flush = () => { if (buffer) { out.push({ type: 'text', value: buffer }); buffer = ''; } };
      while (index < length) {
        const char = text[index];
        if (char === '\\' && index + 1 < length) {
          const next = text[index + 1];
          if (next === '[' || next === '(') {
            const close = next === '[' ? '\\]' : '\\)';
            const end = findClosing(text, close, index + 2);
            if (end !== -1) {
              const tex = text.slice(index + 2, end);
              if (tex.trim()) {
                flush();
                out.push({ type: 'tex', tex, display: next === '[', raw: text.slice(index, end + 2) });
                index = end + 2;
                continue;
              }
            }
          } else if (next === '$') {
            // 转义定界符：按字面量处理，不参与公式识别。
            buffer += '$';
            index += 2;
            continue;
          } else {
            buffer += char + next;
            index += 2;
            continue;
          }
        } else if (char === '$') {
          if (text[index + 1] === '$') {
            const end = findClosing(text, '$$', index + 2);
            if (end !== -1) {
              const tex = text.slice(index + 2, end);
              if (tex.trim()) {
                flush();
                out.push({ type: 'tex', tex, display: true, raw: text.slice(index, end + 2) });
                index = end + 2;
                continue;
              }
            }
            buffer += '$$';
            index += 2;
            continue;
          }
          let cursor = index + 1;
          let close = -1;
          while (cursor < length) {
            if (text[cursor] === '\\') { cursor += 2; continue; }
            if (text[cursor] === '$') { close = cursor; break; }
            cursor += 1;
          }
          if (close !== -1) {
            const tex = text.slice(index + 1, close);
            if (tex.trim()) {
              flush();
              out.push({ type: 'tex', tex, display: false, raw: text.slice(index, close + 1) });
              index = close + 1;
              continue;
            }
          }
        }
        buffer += char;
        index += 1;
      }
      flush();
      return out;
    }
    function renderTexNodes(fragment) {
      const doc = root.document;
      if (!doc || !root.katex) return false;
      const targets = [];
      (function walk(node) {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) targets.push(child);
          else if (child.nodeType === 1) {
            if (texSkipTags.has(child.tagName.toUpperCase())) continue;
            if (child.classList && child.classList.contains('katex')) continue;
            walk(child);
          }
        }
      })(fragment);
      let changed = false;
      for (const node of targets) {
        const segments = tokenizeTex(node.nodeValue || '');
        if (!segments.some(segment => segment.type === 'tex')) continue;
        const replacement = doc.createDocumentFragment();
        for (const segment of segments) {
          if (segment.type === 'text') {
            if (segment.value) replacement.appendChild(doc.createTextNode(segment.value));
            continue;
          }
          let markup = null;
          try {
            // MinerU may wrap inline TeX across lines and double-escape HTML
            // entities. Decode only literal entities inside the TeX token;
            // the original native HTML and existing MathML stay unchanged.
            const tex = segment.tex.replace(/&(lt|gt|amp|quot|apos);/g, (_, name) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name]));
            markup = root.katex.renderToString(tex, { displayMode: segment.display, throwOnError: false, strict: 'ignore', trust: false });
          } catch { markup = null; }
          if (markup) {
            const holder = doc.createElement('template');
            holder.innerHTML = markup;
            replacement.appendChild(holder.content);
          } else {
            replacement.appendChild(doc.createTextNode(segment.raw));
          }
        }
        node.parentNode.replaceChild(replacement, node);
        changed = true;
      }
      return changed;
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
    // html：题库原生解析片段（MinerU 转出的 MathML / 表格 / data: 图片）。
    // 先用 raw 配置整体清洗：保留 MathML、表格与内嵌图片，去掉脚本、事件、动作属性、内联样式，
    // 并丢弃 annotation/annotation-xml 内容。随后仅在普通文本节点（跳过已有 math/SVG/KaTeX 与
    // code/pre/script/style）里识别定界 TeX，用 trust:false 的 KaTeX 生成可信排版，最后走 final
    // 配置再清洗一次。绝不把整段原生 HTML 交给 marked/KaTeX，也不改动已有 MathML、表格或图片 URL。
    function html(value) {
      const sanitized = clean(value, 'raw', true);
      if (!purifier?.isSupported || !root.document || !root.katex) return sanitized;
      try {
        const holder = root.document.createElement('div');
        holder.innerHTML = sanitized;
        if (!renderTexNodes(holder)) return sanitized;
        return clean(holder.innerHTML, 'final', true);
      } catch { return sanitized; }
    }
    return Object.freeze({ markdown, html, svg: html => {
      svgPrefix = 'daguan-svg-' + Math.random().toString(36).slice(2) + '-';
      return clean(html, 'svg');
    } });
  }
  root.DaguanSafeRender = Object.freeze({ create });
})(window);
