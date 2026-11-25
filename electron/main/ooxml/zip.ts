import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

/**
 * Pembaca/penulis ZIP minimal tanpa dependensi (hanya node:zlib).
 * Entri yang tidak diubah ditulis ulang dengan data terkompresi ASLI (byte-per-byte),
 * sehingga gambar, styles, tema, dsb. tidak pernah dikompres ulang atau berubah.
 */
export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  flags: number;
  time: number;
  date: number;
  crc: number;
  compSize: number;
  size: number;
  raw: Buffer; // data terkompresi
}

const MAX_ENTRY = 120 * 1024 * 1024;
const MAX_TOTAL = 400 * 1024 * 1024;

let table: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
export function crc32(buf: Uint8Array): number {
  const native = (zlib as any).crc32 as ((b: Uint8Array) => number) | undefined;
  if (native) return native(buf) >>> 0;
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const sha256 = (buf: Uint8Array) => createHash('sha256').update(buf).digest('hex');

function dosNow(): { time: number; date: number } {
  const d = new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

export class Zip {
  entries: ZipEntry[] = [];

  static read(buf: Buffer): Zip {
    if (buf.length < 22) throw new Error('Berkas ZIP terlalu kecil.');
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Bukan berkas ZIP yang valid.');
    const count = buf.readUInt16LE(eocd + 10);
    const cdOff = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOff === 0xffffffff) throw new Error('ZIP64 tidak didukung.');
    const zip = new Zip();
    let p = cdOff;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Direktori ZIP rusak.');
      const flags = buf.readUInt16LE(p + 8);
      const method = buf.readUInt16LE(p + 10);
      const time = buf.readUInt16LE(p + 12);
      const date = buf.readUInt16LE(p + 14);
      const crc = buf.readUInt32LE(p + 16);
      const compSize = buf.readUInt32LE(p + 20);
      const size = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      const localOff = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (flags & 1) throw new Error('Berkas dilindungi sandi dan tidak dapat dibaca.');
      if (size > MAX_ENTRY || (total += size) > MAX_TOTAL) throw new Error('Isi berkas terlalu besar untuk diproses.');
      if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('Entri ZIP rusak.');
      const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
      if (start + compSize > buf.length) throw new Error('Entri ZIP terpotong.');
      zip.entries.push({ name, method, flags: flags & ~0x08 & ~0x01, time, date, crc, compSize, size, raw: buf.subarray(start, start + compSize) });
    }
    return zip;
  }

  has(name: string) { return this.entries.some((e) => e.name === name); }
  entry(name: string) { return this.entries.find((e) => e.name === name); }
  names() { return this.entries.map((e) => e.name); }

  data(name: string): Buffer | undefined {
    const e = this.entry(name);
    if (!e) return undefined;
    let out: Buffer;
    if (e.method === 0) out = Buffer.from(e.raw);
    else if (e.method === 8) out = zlib.inflateRawSync(e.raw, { maxOutputLength: MAX_ENTRY });
    else throw new Error(`Metode kompresi tidak didukung (${e.method}).`);
    return out;
  }
  text(name: string): string | undefined { return this.data(name)?.toString('utf8'); }

  /** Ganti isi entri (atau tambah baru). Entri lain tidak tersentuh. */
  set(name: string, content: Buffer | string) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const raw = zlib.deflateRawSync(data, { level: 6 });
    const { time, date } = dosNow();
    const e: ZipEntry = { name, method: 8, flags: 0x0800, time, date, crc: crc32(data), compSize: raw.length, size: data.length, raw };
    const i = this.entries.findIndex((x) => x.name === name);
    if (i >= 0) this.entries[i] = { ...e, time: this.entries[i].time, date: this.entries[i].date, flags: this.entries[i].flags | 0x0800 };
    else this.entries.push(e);
  }

  remove(name: string) { this.entries = this.entries.filter((e) => e.name !== name); }

  clone(): Zip {
    const z = new Zip();
    z.entries = this.entries.map((e) => ({ ...e }));
    return z;
  }

  toBuffer(): Buffer {
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const e of this.entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const flags = e.flags | 0x0800;
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(e.method, 8);
      lh.writeUInt16LE(e.time, 10); lh.writeUInt16LE(e.date, 12); lh.writeUInt32LE(e.crc >>> 0, 14);
      lh.writeUInt32LE(e.compSize, 18); lh.writeUInt32LE(e.size, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
      chunks.push(lh, nameBuf, e.raw);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(e.method, 10);
      ch.writeUInt16LE(e.time, 12); ch.writeUInt16LE(e.date, 14); ch.writeUInt32LE(e.crc >>> 0, 16);
      ch.writeUInt32LE(e.compSize, 20); ch.writeUInt32LE(e.size, 24); ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt32LE(offset, 42);
      central.push(ch, nameBuf);
      offset += 30 + nameBuf.length + e.raw.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, cd, end]);
  }
}
