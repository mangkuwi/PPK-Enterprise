/** Rupiah selalu bilangan bulat (number aman sampai ±9.007.199.254.740.991 ≈ Rp9.000 triliun). Tidak pernah float. */

export function assertRupiah(n: unknown, label = 'Nilai'): asserts n is number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new Error(`${label} harus berupa bilangan bulat rupiah.`);
}

const fmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** 1234567 → "Rp1.234.567"; -5000 → "-Rp5.000". */
export function formatRupiah(n: number): string {
  assertRupiah(n);
  return `${n < 0 ? '-' : ''}Rp${fmt.format(Math.abs(n))}`;
}

/**
 * Teks isian pengguna → rupiah. Menerima "Rp 1.234.567", "1.234.567,00", "1234567", "-5.000".
 * Menolak sen selain ",00" dan teks lain, agar salah ketik tidak diam-diam dibulatkan.
 */
export function parseRupiah(text: string): number {
  const t = text.replace(/\s/g, '').replace(/^(-?)rp\.?/i, '$1');
  const m = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(t);
  if (!m) throw new Error(`"${text}" bukan nilai rupiah yang valid.`);
  if (m[3] && /[1-9]/.test(m[3])) throw new Error(`"${text}" memiliki sen; nilai rupiah harus bulat.`);
  const n = Number(m[2].replace(/\./g, '')) * (m[1] ? -1 : 1);
  assertRupiah(n);
  return n === 0 ? 0 : n;
}

const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
const SKALA = ['', 'ribu', 'juta', 'miliar', 'triliun', 'kuadriliun'];

function ratusan(n: number): string {
  const out: string[] = [];
  const r = Math.floor(n / 100); const sisa = n % 100;
  if (r) out.push(r === 1 ? 'seratus' : `${SATUAN[r]} ratus`);
  if (sisa < 12) { if (sisa) out.push(SATUAN[sisa]); }
  else if (sisa < 20) out.push(`${SATUAN[sisa - 10]} belas`);
  else { out.push(`${SATUAN[Math.floor(sisa / 10)]} puluh`); if (sisa % 10) out.push(SATUAN[sisa % 10]); }
  return out.join(' ');
}

/** 1500000 → "satu juta lima ratus ribu". Tanpa kata "rupiah"; pemanggil menambahkannya. */
export function terbilang(n: number): string {
  assertRupiah(n);
  if (n === 0) return 'nol';
  if (n < 0) return `minus ${terbilang(-n)}`;
  const parts: string[] = [];
  let rest = n; let i = 0;
  while (rest > 0) {
    const grp = rest % 1000;
    if (grp) parts.unshift(i === 1 && grp === 1 ? 'seribu' : `${ratusan(grp)}${SKALA[i] ? ` ${SKALA[i]}` : ''}`);
    rest = Math.floor(rest / 1000); i++;
  }
  return parts.join(' ');
}

/** Pembulatan a/b ke rupiah terdekat (setengah ke atas), dihitung dengan BigInt agar tidak kehilangan presisi. */
export function divRound(a: bigint, b: bigint): number {
  if (b <= 0n) throw new Error('Pembagi harus positif.');
  const q = a >= 0n ? (2n * a + b) / (2n * b) : -((-2n * a + b) / (2n * b));
  const n = Number(q);
  assertRupiah(n, 'Hasil hitung');
  return n;
}
