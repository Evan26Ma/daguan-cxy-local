(function (root) {
  'use strict';
  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  // Base64 expands by 4/3; leave room for question text in the 10 MiB API body.
  const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
  const IMAGE_TIMEOUT_MS = 10_000;
  const imageName = /^[0-9a-f]{64}\.(png|jpe?g|gif|webp)$/i;
  const sourceName = /^[0-9a-f]{64}(?:\.(png|jpe?g|gif|webp))?$/i;
  const imageMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

  function sameApp(url, page) {
    // URL.origin is "null" for custom schemes, including daguan://app.
    return url.protocol === page.protocol && url.host === page.host && !url.username && !url.password;
  }

  function safeReference(value) {
    return typeof value === 'string' && value.length > 0 && !/[\s\\%?#\u0000-\u001f\u007f]/.test(value)
      && !value.startsWith('//') && !/(?:^|\/)\.\.(?:\/|$)/.test(value);
  }

  function resolveImage(ref, { page, assets, aliases, assetUrl }) {
    const source = String(ref || '').trim();
    if (!safeReference(source)) return null;
    const original = new URL(source, page);
    if (!sameApp(original, page)) return null;
    // Accept the old assets/<hash> spelling before mapping, but never API paths
    // or external URLs that a mapper might otherwise turn into a local image.
    const prefix = [assets.pathname, aliases.pathname].find(value => original.pathname.startsWith(value));
    if (!prefix || !sourceName.test(original.pathname.slice(prefix.length))) return null;
    const mapped = assetUrl(source);
    if (!safeReference(mapped)) return null;
    const url = new URL(mapped, page);
    if (!sameApp(url, page) || !url.pathname.startsWith(assets.pathname)) return null;
    return imageName.test(url.pathname.slice(assets.pathname.length)) ? url : null;
  }

  function hasImageSignature(bytes, mime) {
    const starts = signature => signature.every((value, index) => bytes[index] === value);
    if (mime === 'image/png') return starts([137, 80, 78, 71, 13, 10, 26, 10]);
    if (mime === 'image/jpeg') return starts([255, 216, 255]);
    if (mime === 'image/gif') return starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97]);
    return mime === 'image/webp' && starts([82, 73, 70, 70]) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
  }

  async function cancelBody(response) {
    try { await response.body?.cancel(); } catch {}
  }

  async function readBounded(response, limit, signal) {
    if (!response.body?.getReader) { await cancelBody(response); return null; }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    let complete = false;
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (signal.aborted) return null;
        if (done) { complete = true; break; }
        if (!(value instanceof Uint8Array) || value.byteLength > limit - size) return null;
        size += value.byteLength;
        chunks.push(value);
      }
      if (!complete || !size) return null;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (!complete) cancel();
      reader.releaseLock();
    }
  }

  function encodeImage(bytes, mime, signal) {
    return new Promise(resolve => {
      const reader = new root.FileReader();
      const finish = value => { signal.removeEventListener('abort', abort); resolve(value); };
      const abort = () => { reader.abort(); finish(''); };
      reader.onload = () => finish(String(reader.result || ''));
      reader.onerror = reader.onabort = () => finish('');
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else reader.readAsDataURL(new root.Blob([bytes], { type: mime }));
    });
  }

  async function collect({ question, assetUrl, fetch, location, signal }) {
    if (!question || signal?.aborted) return [];
    const page = new URL(location.href);
    if (!['http:', 'https:', 'daguan:'].includes(page.protocol)) return [];
    const context = { page, assets: new URL('./data/assets/', page), aliases: new URL('./assets/', page), assetUrl };
    const options = Array.isArray(question.options) ? question.options : [];
    const source = `${question.stem || question.question || ''}\n${options.map(option => option?.content_md || '').join('\n')}\n${question.answer || ''}\n${question.explanation || ''}`;
    const refs = [...source.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/gi)]
      .map(match => match[1] || match[2]).filter(Boolean).slice(0, MAX_IMAGES);
    const images = [];
    let total = 0;
    for (const ref of refs) {
      if (signal?.aborted || total >= MAX_TOTAL_BYTES) break;
      let url;
      try { url = resolveImage(ref, context); } catch { continue; }
      if (!url) continue;
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
      try {
        const response = await fetch(url, { redirect: 'error', credentials: 'same-origin', signal: controller.signal });
        const mime = String(response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        const limit = Math.min(MAX_IMAGE_BYTES, MAX_TOTAL_BYTES - total);
        const length = Number(response.headers.get('Content-Length'));
        if (!response.ok || response.redirected || !imageMimes.has(mime) || length > limit || controller.signal.aborted) {
          await cancelBody(response);
          continue;
        }
        const bytes = await readBounded(response, limit, controller.signal);
        if (!bytes || !hasImageSignature(bytes, mime) || controller.signal.aborted) continue;
        const data = await encodeImage(bytes, mime, controller.signal);
        if (data && !controller.signal.aborted) { images.push(data); total += bytes.byteLength; }
      } catch {
        // A missing or rejected image must not prevent the text question being sent.
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
    return signal?.aborted ? [] : images;
  }

  root.DaguanAIQuestionImages = Object.freeze({ collect });
})(window);
