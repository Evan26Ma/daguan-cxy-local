const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;

function imageError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function rasterHeader(bytes, type) {
  if (type === 'png') {
    return bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR'
      && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
  }
  if (type === 'jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (type === 'gif') return bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
    && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes[bytes.length - 1] === 59;
  if (type === 'webp') return bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
  return false;
}

export function validateQuestionImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > 4) throw imageError('题目图片最多支持 4 张');
  let total = 0;
  return images.map(value => {
    if (typeof value !== 'string') throw imageError('题目图片必须是栅格图片数据');
    if (value.length > MAX_IMAGE_LENGTH) throw imageError('单张题目图片不能超过 2 MiB', 413);
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) throw imageError('题目图片只接受 PNG、JPEG、GIF 或 WebP 数据');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw imageError('单张题目图片不能超过 2 MiB', 413);
    if (bytes.toString('base64') !== match[2] || !rasterHeader(bytes, match[1])) throw imageError('题目图片内容与图片类型不符');
    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw imageError('题目图片合计不能超过 6 MiB', 413);
    return value;
  });
}

export function replayableHistory(messages, includePrivate, legacyHistoryTruncated = false) {
  // A full legacy history may have lost the turn that introduced private context.
  let privateContext = legacyHistoryTruncated;
  return (Array.isArray(messages) ? messages : []).filter(message => {
    if (!message || !['user', 'assistant'].includes(message.role)) return false;
    if (includePrivate) return true;
    if (message.includePrivate === false) {
      privateContext = false;
      return true;
    }
    if (message.includePrivate === true || (message.role === 'user' && /(?:^|\n\n)本地批注：\n/.test(String(message.content || '')))) privateContext = true;
    // Legacy replies can inherit private context from any earlier turn.
    return !privateContext;
  });
}
