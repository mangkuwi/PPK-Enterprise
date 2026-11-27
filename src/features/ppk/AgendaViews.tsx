import { ChevronLeft, ChevronRight, ExternalLink, Pencil, Video } from 'lucide-react';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatDateID } from '@shared/date';
import { agendaDisplay, calendarDays, dayName, joinLabel, liveState, shiftCursor, type Agenda, type CalendarView } from '@shared/ppk/agenda';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const VIEWS: Array<[CalendarView, string]> = [['bulan', 'Bulan'], ['minggu', 'Minggu'], ['hari', 'Hari']];
/** 'Rab, 25 Nov' untuk daftar yang sempit. */
export const shortDate = (d: string) => `${dayName(d).slice(0, 3)}, ${Number(d.slice(8))} ${BULAN[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
export const timeText = (a: Agenda) => (a.start_time ? `${a.start_time}${a.end_time ? `–${a.end_time}` : ''}` : 'Sepanjang hari');

function title(view: CalendarView, cursor: string, days: string[]) {
  if (view === 'bulan') return `${BULAN[Number(cursor.slice(5, 7)) - 1]} ${cursor.slice(0, 4)}`;
  if (view === 'hari') return `${dayName(cursor)}, ${formatDateID(cursor)}`;
  return `${formatDateID(days[0])} – ${formatDateID(days[6])}`;
}

/** Kalender bulan/minggu/hari. Klik tanggal = saring daftar; klik agenda = buka detail. */
export function AgendaCalendar({ view, setView, cursor, setCursor, today, agendas, selected, onSelect, onOpen, compact }: {
  view: CalendarView; setView: (v: CalendarView) => void; cursor: string; setCursor: (c: string) => void; today: string;
  agendas: Agenda[]; selected: string | null; onSelect: (d: string | null) => void; onOpen: (a: Agenda) => void;
  /** Kolom sempit: sel bulan memakai titik, bukan judul. */ compact?: boolean;
}) {
  const days = calendarDays(view, cursor);
  const on = (d: string) => agendas.filter((a) => a.agenda_date === d);
  const month = cursor.slice(0, 7);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Sebelumnya" onClick={() => setCursor(shiftCursor(view, cursor, -1))}><ChevronLeft size={16} /></Button>
          <Button size="icon" variant="ghost" aria-label="Berikutnya" onClick={() => setCursor(shiftCursor(view, cursor, 1))}><ChevronRight size={16} /></Button>
          <Button size="sm" variant="outline" onClick={() => { setCursor(today); onSelect(today); }}>Hari ini</Button>
          <span className={cn('ml-2 font-semibold text-navy-900', compact && 'text-sm')}>{title(view, cursor, days)}</span>
        </div>
        <div className="flex rounded-md border border-slate-200 p-0.5" role="tablist" aria-label="Tampilan kalender">
          {VIEWS.map(([v, l]) => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={cn('rounded px-3 py-1 text-sm', view === v ? 'bg-navy-800 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>)}
        </div>
      </div>

      {view === 'bulan' ? (
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-slate-200 text-xs">
          {HARI.map((h) => <div key={h} className="border-b border-slate-200 bg-slate-50 py-1 text-center font-medium text-slate-500">{h}</div>)}
          {days.map((d) => {
            const list = on(d);
            return (
              <button key={d} onClick={() => onSelect(selected === d ? null : d)} aria-pressed={selected === d} aria-label={`${dayName(d)}, ${formatDateID(d)}: ${list.length} agenda`}
                className={cn('min-w-0 border-b border-r border-slate-100 p-1 text-left align-top hover:bg-navy-50', compact ? 'min-h-[44px] text-center' : 'min-h-[64px] sm:min-h-[84px]',
                  d.slice(0, 7) !== month && 'bg-slate-50/60 text-slate-400', selected === d && 'bg-navy-50 ring-2 ring-inset ring-navy-400')}>
                <span className={cn('inline-grid h-6 w-6 place-items-center rounded-full', d === today && 'bg-navy-800 font-bold text-white')}>{Number(d.slice(8))}</span>
                {compact ? <div className="flex h-2 justify-center gap-0.5">{list.slice(0, 3).map((a) => <span key={a.id} className="h-1.5 w-1.5 rounded-full bg-navy-600" />)}</div> : <div className="mt-0.5 space-y-0.5">
                  {list.slice(0, 2).map((a) => <div key={a.id} className={cn('truncate rounded px-1', a.status === 'dibatalkan' ? 'bg-red-50 text-red-700 line-through' : 'bg-navy-100 text-navy-900')}>{a.start_time && `${a.start_time} `}{a.title}</div>)}
                  {list.length > 2 && <div className="px-1 text-slate-500">+{list.length - 2} lagi</div>}
                </div>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={cn('grid gap-2', view === 'minggu' && !compact && '2xl:grid-cols-7')}>
          {days.map((d) => (
            <div key={d} className={cn('min-w-0 rounded-lg border p-2', d === today ? 'border-navy-400' : 'border-slate-200', selected === d && 'bg-navy-50')}>
              <button className="mb-1 w-full text-left text-xs font-semibold text-slate-600 hover:text-navy-800" onClick={() => onSelect(selected === d ? null : d)}>
                {dayName(d)} {Number(d.slice(8))}{d === today && ' · Hari ini'}
              </button>
              {on(d).length ? on(d).map((a) => (
                <button key={a.id} onClick={() => onOpen(a)} className="mb-1 block w-full rounded bg-navy-100 px-2 py-1 text-left text-xs text-navy-900 hover:bg-navy-200">
                  <div className="font-medium">{timeText(a)}</div><div className="break-words">{a.title}</div>
                </button>)) : <div className="text-xs text-slate-400">—</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Satu agenda: jam, judul, penyelenggara, lokasi, staf, status, dan tombol gabung bila rapat daring. */
export function AgendaRow({ a, onOpen, showDate, today, now }: { a: Agenda; onOpen: (a: Agenda) => void; showDate?: boolean; today?: string; now?: string }) {
  const st = agendaDisplay(a);
  const live = today && now ? liveState(a, today, now) : null;
  const online = !!a.meeting_url && a.status === 'terjadwal' && !a.archived_at;
  return (
    <li className={cn('flex flex-wrap items-start gap-3 py-3', live === 'berlangsung' && '-mx-2 rounded-lg bg-green-50 px-2')}>
      <button onClick={() => onOpen(a)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <div className="w-[92px] shrink-0 text-sm font-semibold text-navy-800">{showDate && <div className="text-xs font-normal text-slate-500">{shortDate(a.agenda_date)}</div>}{timeText(a)}</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-navy-900 hover:underline">{a.title}</div>
          <div className="text-sm text-slate-600">{[a.organizer, a.location, a.meeting_url && !a.location && 'Rapat daring'].filter(Boolean).join(' · ') || '—'}</div>
          <div className="text-xs text-slate-500">{a.pic ? `PJ: ${a.pic.name}` : 'Belum ada penanggung jawab'}{a.support.length > 0 && ` · +${a.support.length} staf`}</div>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <div className="flex gap-1">{live && <Badge tone={live === 'berlangsung' ? 'green' : 'amber'}>{live === 'berlangsung' ? 'Sedang berlangsung' : 'Segera mulai'}</Badge>}<Badge tone={st.tone}>{st.label}</Badge></div>
        {online && <a href={a.meeting_url} target="_blank" rel="noreferrer" aria-label={`${joinLabel(a.meeting_url)}: ${a.title}`}
          className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold', live ? 'bg-green-700 text-white hover:bg-green-800' : 'border border-navy-300 text-navy-800 hover:bg-navy-50')}>
          <Video size={15} /> {joinLabel(a.meeting_url)}</a>}
      </div>
    </li>
  );
}

/** Detail agenda (hanya baca). Ubah membuka formulir bila pengguna boleh menulis. */
export function AgendaDetail({ a, canEdit, onEdit }: { a: Agenda; canEdit: boolean; onEdit: () => void }) {
  const st = agendaDisplay(a);
  const rows: Array<[string, React.ReactNode]> = [
    ['Tanggal', `${dayName(a.agenda_date)}, ${formatDateID(a.agenda_date)} · ${timeText(a)}`],
    ['Penyelenggara', a.organizer], ['Nomor surat', a.letter_number], ['Lokasi', a.location],
    ['Tautan rapat', a.meeting_url && <a href={a.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-navy-700 underline">{a.meeting_url}<ExternalLink size={12} /></a>],
    ['Penanggung jawab', a.pic?.name ?? 'Belum ditentukan'], ['Staf pendukung', a.support.map((x) => x.name).join(', ')],
    ['Agenda', a.agenda_text && <span className="whitespace-pre-line">{a.agenda_text}</span>], ['Catatan', a.notes],
    ['Alasan batal', a.cancel_reason], ['Dibuat oleh', a.created_by]
  ];
  return (
    <DialogContent wide title={a.title} description={st.label}
      footer={<>{a.meeting_url && a.status === 'terjadwal' && <a href={a.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800"><Video size={15} /> {joinLabel(a.meeting_url)}</a>}
        {canEdit && a.status === 'terjadwal' && <Button onClick={onEdit}><Pencil size={14} /> Ubah agenda</Button>}</>}>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[140px_1fr]">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="min-w-0 break-words text-slate-900">{v}</dd></div>)}
      </dl>
    </DialogContent>
  );
}
