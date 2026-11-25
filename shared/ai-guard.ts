import { placeholderRegex } from './placeholder';

export const AI_SYSTEM_PROMPT = [
  'Anda adalah asisten penyuntingan naskah dinas pemerintahan Indonesia.',
  'Gunakan bahasa Indonesia baku sesuai Pedoman Umum Ejaan Bahasa Indonesia dan tata naskah dinas.',
  'DILARANG mengarang atau menambah: nomor surat, dasar hukum, peraturan, nama pejabat, jabatan, tanggal, nilai anggaran, dan informasi kontraktual.',
  'Pertahankan semua penanda berbentuk [NAMA_PENANDA] persis seperti aslinya.',
  'Jika informasi yang dibutuhkan tidak tersedia, tulis penanda [ISI_KETERANGAN] atau ajukan pertanyaan konfirmasi singkat.',
  'Keluarkan hanya teks hasil, tanpa penjelasan tambahan.'
].join(' ');

export const AI_ACTIONS = {
  improve: 'Perbaiki bahasa, ejaan, dan tanda baca teks berikut tanpa mengubah makna.',
  formalize: 'Ubah teks berikut menjadi bahasa formal kedinasan tanpa mengubah makna.',
  tidy: 'Rapikan paragraf teks berikut agar runtut dan ringkas tanpa menambah informasi baru.',
  outline: 'Susun narasi kedinasan berdasarkan poin-poin berikut. Jangan menambah fakta di luar poin.',
  draft: 'Buat draft awal naskah dinas berdasarkan judul dan tujuan berikut. Gunakan penanda [ISI_...] untuk informasi yang belum diketahui.',
  summarize: 'Ringkas teks berikut menjadi beberapa kalimat inti tanpa menambah informasi baru.'
} as const;
export type AiAction = keyof typeof AI_ACTIONS;

const numbers = (s: string) => new Set(s.match(/\d[\d.,/-]*/g) ?? []);

/** Pemeriksaan heuristik keluaran AI. Mengembalikan daftar peringatan untuk ditinjau pengguna. */
export function checkAiOutput(input: string, output: string): string[] {
  const warnings: string[] = [];
  const outPh = new Set(output.match(placeholderRegex()) ?? []);
  for (const ph of new Set(input.match(placeholderRegex()) ?? [])) {
    if (!outPh.has(ph)) warnings.push(`Placeholder ${ph} hilang dari hasil AI.`);
  }
  const inNums = numbers(input);
  for (const n of numbers(output)) {
    if (!inNums.has(n)) warnings.push(`Angka/tanggal baru yang tidak ada pada teks asli: "${n}". Verifikasi sebelum dipakai.`);
  }
  const law = /\b(Undang-Undang|UU|Peraturan\s+(?:Pemerintah|Presiden|Menteri|Daerah)|Perpres|Permen|Keputusan\s+(?:Menteri|Presiden))\b/gi;
  const inLaw = new Set((input.match(law) ?? []).map((s) => s.toLowerCase()));
  for (const l of new Set(output.match(law) ?? [])) {
    if (!inLaw.has(l.toLowerCase())) warnings.push(`Rujukan peraturan "${l}" tidak ada pada teks asli. AI tidak boleh mengarang dasar hukum.`);
  }
  return warnings;
}

// ---------- draf isi untuk area editable template Word ----------
export interface DraftInput {
  title: string; recipient: string; subject: string; instructions: string; references: string;
  fields: Array<{ key: string; label: string }>;
}
export const AI_DRAFT_SYSTEM = [
  AI_SYSTEM_PROMPT,
  'Anda hanya mengisi bagian isi yang diminta. Keluarkan SATU objek JSON: kunci = KUNCI isian yang diminta, nilai = teks paragraf (gunakan \\n antar paragraf).',
  'Jangan menambah kunci lain. Jangan membuat nomor surat, tanggal, nama, atau rujukan peraturan. Untuk informasi yang tidak tersedia tulis [ISI_...] dan jangan menebak.'
].join(' ');

/** Prompt hanya memuat teks isian yang dikirim pengguna — bukan berkas DOCX. */
export function buildDraftPrompt(d: DraftInput): string {
  return [
    `Judul: ${d.title || '-'}`, `Tujuan surat: ${d.recipient || '-'}`, `Perihal: ${d.subject || '-'}`, `Instruksi: ${d.instructions || '-'}`,
    d.references.trim() ? `Referensi pendukung (teks):\n${d.references.trim()}` : '',
    `Isian yang harus dibuat (kunci — label):\n${d.fields.map((f) => `${f.key} — ${f.label}`).join('\n')}`
  ].filter(Boolean).join('\n\n');
}

export interface DraftResult { values: Record<string, string>; missing: string[]; dropped: string[]; warnings: string[] }
/** Ambil hanya kunci yang diizinkan (area editable); sisanya dibuang dan dilaporkan. */
export function parseDraft(output: string, allowed: string[], source: string): DraftResult {
  const start = output.indexOf('{'); const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Respons AI bukan JSON yang dapat dibaca. Coba lagi atau isi manual.');
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(output.slice(start, end + 1)); } catch { throw new Error('Respons AI bukan JSON yang valid. Coba lagi atau isi manual.'); }
  const res: DraftResult = { values: {}, missing: [], dropped: [], warnings: [] };
  for (const [k, v] of Object.entries(obj)) {
    if (!allowed.includes(k)) { res.dropped.push(k); continue; }
    const text = typeof v === 'string' ? v.trim() : '';
    if (!text) continue;
    res.values[k] = text;
    if (/\[ISI_[A-Z0-9_]*\]/.test(text)) res.missing.push(k);
    for (const w of checkAiOutput(source, text)) res.warnings.push(`${k}: ${w}`);
  }
  return res;
}
