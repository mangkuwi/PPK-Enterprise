/** Metrik tata letak dari PDF hasil render (LibreOffice) untuk perbandingan Original vs Generated. Murni data; tanpa kanvas. */
export interface TextBox { str: string; x: number; y: number; w: number; h: number }
export interface PageMetrics { page: number; width: number; height: number; images: number; text: TextBox[] }
export interface LayoutFinding { level: 'info' | 'warn'; code: string; page: number | null; message: string }
export interface LayoutReport { pages_original: number; pages_generated: number; findings: LayoutFinding[]; material: boolean }

export async function extractMetrics(pdf: Uint8Array): Promise<PageMetrics[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = lib.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const out: PageMetrics[] = [];
  const imgOps = new Set([lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageMaskXObject, lib.OPS.paintJpegXObject].filter((x) => x !== undefined));
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const ops = await page.getOperatorList();
    const text: TextBox[] = [];
    for (const it of tc.items) {
      if (!('str' in it) || !String(it.str).trim()) continue;
      const t = it.transform as number[];
      text.push({ str: String(it.str).trim(), x: t[4], y: vp.height - t[5], w: it.width, h: it.height });
    }
    out.push({ page: i, width: vp.width, height: vp.height, images: ops.fnArray.filter((f: number) => imgOps.has(f)).length, text });
  }
  await task.destroy();
  return out;
}

const key = (t: TextBox) => t.str;

/** Bandingkan metrik render template (nilai asli) dengan dokumen hasil. */
export function compareLayout(orig: PageMetrics[], gen: PageMetrics[]): LayoutReport {
  const f: LayoutFinding[] = [];
  const add = (level: 'info' | 'warn', code: string, page: number | null, message: string) => f.push({ level, code, page, message });
  if (gen.length > orig.length) add('warn', 'extra_pages', gen.length, `Dokumen hasil ${gen.length} halaman, template ${orig.length} halaman (halaman tambahan: isi lebih panjang atau tata letak bergeser).`);
  else if (gen.length < orig.length) add('info', 'fewer_pages', gen.length, `Dokumen hasil ${gen.length} halaman, template ${orig.length} halaman.`);
  const n = Math.min(orig.length, gen.length);
  for (let i = 0; i < n; i++) {
    const o = orig[i]; const g = gen[i]; const p = i + 1;
    if (Math.abs(o.width - g.width) > 1 || Math.abs(o.height - g.height) > 1) add('warn', 'page_size', p, `Ukuran halaman ${p} berubah.`);
    if (g.images < o.images) add('warn', 'missing_images', p, `Halaman ${p}: gambar berkurang (${o.images} → ${g.images}).`);
    const top = (m: PageMetrics) => m.text.filter((t) => t.y < m.height * 0.14); const bot = (m: PageMetrics) => m.text.filter((t) => t.y > m.height * 0.9);
    for (const [name, a, b] of [['Header', top(o), top(g)], ['Footer', bot(o), bot(g)]] as const) {
      for (const t of a) {
        const m = b.find((x) => key(x) === key(t));
        if (!m) { if (!/\d/.test(t.str)) add('warn', 'hf_missing', p, `${name} halaman ${p}: teks "${t.str.slice(0, 40)}" tidak ditemukan.`); }
        else if (Math.abs(m.x - t.x) > 3 || Math.abs(m.y - t.y) > 3) add('warn', 'hf_displaced', p, `${name} halaman ${p}: "${t.str.slice(0, 40)}" bergeser (${Math.round(m.x - t.x)}, ${Math.round(m.y - t.y)} pt).`);
      }
    }
    // tata letak tabel/kolom: teks statis yang sama harus tetap di posisi x yang sama
    const mid = (m: PageMetrics) => m.text.filter((t) => t.y >= m.height * 0.14 && t.y <= m.height * 0.9);
    const gm = mid(g); let shifted = 0;
    for (const t of mid(o)) { const m = gm.find((x) => key(x) === key(t) && Math.abs(x.y - t.y) < 400); if (m && Math.abs(m.x - t.x) > 6) shifted++; }
    if (shifted >= 3) add('warn', 'layout_shift', p, `Halaman ${p}: ${shifted} teks bergeser horizontal — kemungkinan tata letak tabel/kolom berubah.`);
    const right = g.width - 20;
    const over = g.text.filter((t) => t.x + t.w > right || t.y > g.height - 8);
    if (over.length) add('warn', 'overflow', p, `Halaman ${p}: ${over.length} teks melewati batas halaman (overflow).`);
  }
  return { pages_original: orig.length, pages_generated: gen.length, findings: f, material: f.some((x) => x.level === 'warn') };
}
