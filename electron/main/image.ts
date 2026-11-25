export interface ImageInfo { data: Buffer; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number }

/** Parse data URL gambar dan baca dimensinya (png/jpeg/gif/bmp). null bila tidak didukung. */
export function parseImage(src: string): ImageInfo | null {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  const kind = m[1].toLowerCase();
  try {
    if (kind === 'png') return { data, type: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    if (kind === 'gif') return { data, type: 'gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
    if (kind === 'bmp') return { data, type: 'bmp', width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) };
    let i = 2;
    while (i < data.length) {
      if (data[i] !== 0xff) { i++; continue; }
      const marker = data[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { data, type: 'jpg', height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
      }
      i += 2 + data.readUInt16BE(i + 2);
    }
  } catch { /* jatuh ke ukuran bawaan */ }
  return { data, type: kind === 'png' ? 'png' : kind === 'gif' ? 'gif' : kind === 'bmp' ? 'bmp' : 'jpg', width: 300, height: 200 };
}
