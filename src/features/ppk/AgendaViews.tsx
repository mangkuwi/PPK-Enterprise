import { ChevronLeft, ChevronRight, ExternalLink, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatDateID } from '@shared/date';
import { agendaDisplay, calendarDays, dayName, shiftCursor, type Agenda, type CalendarView } from '@shared/ppk/agenda';

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
export function AgendaCalendar({ view, setView, cursor, setCursor, today, agendas, selected, onSelect, onOpen }: {
  view: CalendarView; setView: (v: CalendarView) => void; cursor: string; setCursor: (c: string) => void; today: string;
  agendas: Agenda[]; selected: string | null; onSelect: (d: string | null) => void; onOpen: (a: Agenda) => void;
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
          <span className="ml-2 font-semibold text-navy-900">{title(view, cursor, days)}</span>
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
                className={cn('min-h-[64px] min-w-0 border-b border-r border-slate-100 p-1 text-left align-top hover:bg-navy-50 sm:min-h-[84px]',
                  d.slice(0, 7) !== month && 'bg-slate-50/60 text-slate-400', selected === d && 'bg-navy-50 ring-2 ring-inset ring-navy-400')}>
                <span className={cn('inline-grid h-6 w-6 place-items-center rounded-full', d === today && 'bg-navy-800 font-bold text-white')}>{Number(d.slice(8))}</span>
                <div className="mt-0.5 space-y-0.5">
                  {list.slice(0, 2).map((a) => <div key={a.id} className={cn('truncate rounded px-1', a.status === 'dibatalkan' ? 'bg-red-50 text-red-700 line-through' : 'bg-navy-100 text-navy-900')}>{a.start_time && `${a.start_time} `}{a.title}</div>)}
                  {list.length > 2 && <div className="px-1 text-slate-500">+{list.length - 2} lagi</div>}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={cn('grid gap-2', view === 'minggu' && '2xl:grid-cols-7')}>
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

/** Satu baris agenda: jam, judul, penyelenggara, lokasi, staf, status. */
export function AgendaRow({ a, onOpen, showDate }: { a: Agenda; onOpen: (a: Agenda) => void; showDate?: boolean }) {
  const st = agendaDisplay(a);
  return (
    <li>
      <button onClick={() => onOpen(a)} className="flex w-full items-start gap-3 py-2 text-left hover:bg-slate-50">
        <div className="w-[88px] shrink-0 text-xs font-semibold text-navy-800">{showDate && <div className="font-normal text-slate-500">{shortDate(a.agenda_date)}</div>}{timeText(a)}</div>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium text-navy-900">{a.title}</div>
          <div className="text-xs text-slate-600">{[a.organizer, a.location || (a.meeting_url && 'Daring')].filter(Boolean).join(' · ') || '—'}</div>
          <div className="text-xs text-slate-500">{a.pic ? `PJ: ${a.pic.name}` : 'Belum ada penanggung jawab'}{a.support.length > 0 && ` · +${a.support.length} staf`}</div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </button>
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
      footer={canEdit && a.status === 'terjadwal' ? <Button onClick={onEdit}><Pencil size={14} /> Ubah agenda</Button> : undefined}>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[140px_1fr]">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="min-w-0 break-words text-slate-900">{v}</dd></div>)}
      </dl>
    </DialogContent>
  );
}
