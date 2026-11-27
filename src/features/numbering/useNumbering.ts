import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import type { NumberRecord, NumberRef, NumberingContext } from '@shared/numbering';

export interface NumberingState {
  templateId: string | null; ctx: NumberingContext | null; record: NumberRecord | null; refs: Record<string, NumberRecord | null>; loading: boolean; error: string;
  refList: NumberRef[]; setRef: (key: string, rec: NumberRecord | null) => void;
  /** Pilih (atau ganti) nomor dari Bank Nomor. Nomor lama dilepas dan yang baru ditugaskan secara atomik. */
  select: (rec: NumberRecord) => Promise<void>;
  /** Lepas nomor terpilih kembali ke Bank Nomor (hanya bila draf belum tersimpan). */
  clear: () => Promise<void>;
  markUsed: () => void; retry: () => void;
}

/**
 * Memuat konfigurasi penomoran template. TIDAK membuat atau memesan nomor secara otomatis:
 * nomor hanya dipilih pengguna dari Bank Nomor. Bila formulir ditinggalkan tanpa menyimpan,
 * nomor terpilih dikembalikan ke AVAILABLE (nomor tidak dibatalkan).
 */
export function useNumbering(templateId: string | null, _initialDate?: string): NumberingState {
  const [ctx, setCtx] = useState<NumberingContext | null>(null);
  const [record, setRecord] = useState<NumberRecord | null>(null);
  const [refs, setRefs] = useState<Record<string, NumberRecord | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const used = useRef(false);
  const current = useRef<string | null>(null);

  useEffect(() => {
    setCtx(null); setRecord(null); setRefs({}); setError(''); used.current = false; current.current = null;
    if (!templateId) return;
    let alive = true;
    setLoading(true);
    api.numbering.forTemplate(templateId)
      .then((c) => { if (alive) setCtx(c); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => {
      alive = false;
      const id = current.current;
      if (id && !used.current) void api.numbering.releaseDraft(id).catch(() => undefined);
    };
  }, [templateId, tick]);

  const select = useCallback(async (rec: NumberRecord) => {
    if (!templateId) return;
    const n = await api.numbering.assign(templateId, rec.id, current.current);
    current.current = n.id; setRecord(n);
  }, [templateId]);
  const clear = useCallback(async () => {
    const id = current.current;
    if (!id) return;
    await api.numbering.releaseDraft(id);
    current.current = null; setRecord(null);
  }, []);
  const setRef = useCallback((key: string, rec: NumberRecord | null) => setRefs((r) => ({ ...r, [key]: rec })), []);
  const refList = Object.entries(refs).filter(([, v]) => v).map(([key, v]) => ({ key, record_id: (v as NumberRecord).id }));
  return { templateId, ctx, record, refs, loading, error, refList, setRef, select, clear, markUsed: () => { used.current = true; }, retry: () => setTick((t) => t + 1) };
}
