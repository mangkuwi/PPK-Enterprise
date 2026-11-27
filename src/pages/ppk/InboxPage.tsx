import { useSearchParams } from 'react-router-dom';
import { MessageCircle, Paperclip, Upload } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { PpkGate } from '@/features/ppk/PpkGate';
import { api } from '@/services/api';
import { cn, formatDateTime } from '@/lib/utils';
import { INVITATION_STATUS_LABEL, type InvitationStatus } from '@shared/ppk/agenda';

const FILTERS: Array<[InvitationStatus | '', string]> = [['', 'Semua pesan'], ['baru', 'Undangan baru'], ['diproses', 'Sedang diproses'],
  ['menunggu_verifikasi', 'Menunggu verifikasi'], ['dikonversi', 'Berhasil dikonversi'], ['gagal', 'Gagal diproses'], ['diarsipkan', 'Diarsipkan']];
const TONE: Record<InvitationStatus, 'navy' | 'amber' | 'green' | 'red' | 'slate'> = {
  baru: 'navy', diproses: 'slate', menunggu_verifikasi: 'amber', dikonversi: 'green', gagal: 'red', ditolak: 'slate', diarsipkan: 'slate'
};

/** Kotak masuk undangan (WhatsApp dan unggah manual). Verifikasi dan penerimaan webhook dibangun di fase berikutnya. */
export default function InboxPage() {
  const [q, setQ] = useSearchParams();
  const status = (q.get('status') ?? '') as InvitationStatus | '';
  const list = useAsync(() => api.ppk.invitations.list(status || undefined), [status]);
  return (
    <Page>
      <PpkGate>
        <PageHeader title="Kotak Masuk WhatsApp" subtitle="Undangan yang diteruskan staf ke nomor WhatsApp Business kantor, dan undangan yang diunggah manual." />
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          Penerima WhatsApp (Gateway) belum terpasang, jadi belum ada pesan yang masuk otomatis. Daftar ini akan terisi setelah Gateway dan nomor WhatsApp Business dihubungkan.
        </div>
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Saring status">
          {FILTERS.map(([v, l]) => <button key={v || 'semua'} role="tab" aria-selected={status === v} onClick={() => setQ(v ? { status: v } : {})}
            className={cn('rounded-full border px-3 py-1 text-sm', status === v ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-100')}>{l}</button>)}
        </div>
        {list.error && <Empty>{list.error}</Empty>}
        {list.data && !list.data.length && <Empty>Tidak ada pesan{status ? ` berstatus "${INVITATION_STATUS_LABEL[status]}"` : ''}.</Empty>}
        <div className="space-y-2">{list.data?.map((i) => (
          <Card key={i.id} className="flex flex-wrap items-start gap-3 p-3 text-sm">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-100 text-navy-800">{i.source === 'whatsapp' ? <MessageCircle size={16} /> : <Upload size={16} />}</div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-navy-900">{i.sender_name || i.sender_phone || 'Unggah manual'}</div>
              <div className="text-xs text-slate-500">Diterima {formatDateTime(i.received_at)}{i.file_count > 0 && <> · <Paperclip size={11} className="inline" /> {i.file_count} lampiran</>}</div>
              {i.message_text && <div className="mt-1 line-clamp-2 text-slate-700">{i.message_text}</div>}
              {i.error_message && <div className="mt-1 text-red-700">{i.error_message}</div>}
            </div>
            <Badge tone={TONE[i.status]}>{INVITATION_STATUS_LABEL[i.status]}</Badge>
          </Card>))}
        </div>
      </PpkGate>
    </Page>
  );
}
