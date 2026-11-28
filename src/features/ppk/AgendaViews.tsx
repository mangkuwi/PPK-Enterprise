import { useEffect, useRef } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Clock, ExternalLink, MapPin, Pencil, Trash2, Video } from 'lucide-react';
import { Input } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { api } from '@/services/api';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatDateID } from '@shared/date';
import { agendaDisplay, calendarDays, dayName, joinLabel, layoutDay, liveState, shiftCursor, type Agenda, type CalendarView } from '@shared/ppk/agenda';

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
export function AgendaCalendar({ view, setView, cursor, setCursor, today, agendas, selected, onSelect, onOpen, compact, hideHeader }: {
  view: CalendarView; setView: (v: CalendarView) => void; cursor: string; setCursor: (c: string) => void; today: string;
  agendas: Agenda[]; selected: string | null; onSelect: (d: string | null) => void; onOpen: (a: Agenda) => void;
  /** Kolom sempit: sel bulan memakai titik, bukan judul. */ compact?: boolean; /** Navigasi dan tab sudah ada di luar. */ hideHeader?: boolean;
}) {
  const days = calendarDays(view, cursor);
  const on = (d: string) => agendas.filter((a) => a.agenda_date === d);
  const month = cursor.slice(0, 7);
  return (
    <div>
      {!hideHeader && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
      </div>}

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
/** Hapus agenda dengan konfirmasi dan alasan wajib. Agenda bisa dikembalikan dari filter "Terhapus". */
export function useDeleteAgenda(onDone: (a: Agenda) => void) {
  const { toast, confirm } = useFeedback();
  const reason = useRef('');
  return async (a: Agenda) => {
    reason.current = '';
    const ok = await confirm({ title: `Hapus "${a.title}"?`, destructive: true, confirmLabel: 'Hapus agenda',
      message: <div><p className="mb-2">Agenda hilang dari jadwal, beranda, dan daftar. Admin PPK atau Pejabat PPK bisa mengembalikannya lewat filter "Terhapus".</p>
        <Input autoFocus placeholder="Alasan hapus (wajib), mis. dobel dengan agenda lain" onChange={(e) => { reason.current = e.target.value; }} /></div> });
    if (!ok) return;
    try { const r = await api.ppk.agendas.remove(a.id, reason.current); toast('Agenda dihapus.', 'success'); onDone(r); } catch (e) { toast(errMsg(e), 'error'); }
  };
}

export function AgendaRow({ a, onOpen, onEdit, onDelete, showDate, today, now }: { a: Agenda; onOpen: (a: Agenda) => void; onEdit?: (a: Agenda) => void; onDelete?: (a: Agenda) => void; showDate?: boolean; today?: string; now?: string }) {
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
          <div className="text-xs text-slate-500">{a.pic ? `PIC: ${a.pic.name}` : 'Belum ada PIC'}{a.support.length > 0 && ` · +${a.support.length} staf`}</div>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <div className="flex gap-1">{live && <Badge tone={live === 'berlangsung' ? 'green' : 'amber'}>{live === 'berlangsung' ? 'Sedang berlangsung' : 'Segera mulai'}</Badge>}<Badge tone={st.tone}>{st.label}</Badge></div>
        {online && <a href={a.meeting_url} target="_blank" rel="noreferrer" aria-label={`${joinLabel(a.meeting_url)}: ${a.title}`}
          className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold', live ? 'bg-green-700 text-white hover:bg-green-800' : 'border border-navy-300 text-navy-800 hover:bg-navy-50')}>
          <Video size={15} /> {joinLabel(a.meeting_url)}</a>}
        {(onEdit || onDelete) && !a.deleted_at && <div className="flex gap-1">
          {onEdit && a.status !== 'dibatalkan' && <Button size="sm" variant="ghost" aria-label={`Ubah ${a.title}`} onClick={() => onEdit(a)}><Pencil size={14} /> Ubah</Button>}
          {onDelete && <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" aria-label={`Hapus ${a.title}`} onClick={() => onDelete(a)}><Trash2 size={14} /> Hapus</Button>}
        </div>}
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
    ['PIC', a.pic?.name ?? 'Belum ditentukan'], ['Staf yang ikut', a.support.map((x) => x.name).join(', ')],
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

const HOUR_PX = 64;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Kartu agenda di grid jam: ikon, judul, jam, peserta, tombol gabung. */
function GridCard({ a, onOpen, live, narrow }: { a: Agenda; onOpen: (a: Agenda) => void; live: ReturnType<typeof liveState>; narrow?: boolean }) {
  const people = [...(a.pic ? [{ ...a.pic, role: 'PIC' }] : []), ...a.support.map((s) => ({ ...s, role: 'Ikut' }))];
  const online = !!a.meeting_url && a.status === 'terjadwal';
  return (
    <div className={cn('flex h-full flex-col overflow-hidden rounded-lg border bg-white p-2 text-left shadow-sm', live === 'berlangsung' ? 'border-green-400 ring-1 ring-green-300' : 'border-slate-200',
      a.status !== 'terjadwal' && 'opacity-60')}>
      <button onClick={() => onOpen(a)} className="flex min-w-0 items-start gap-2 text-left">
        {!narrow && <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', online ? 'bg-violet-100 text-violet-700' : 'bg-navy-100 text-navy-700')}>{online ? <Video size={14} /> : <MapPin size={14} />}</span>}
        <span className="min-w-0">
          <span className={cn('block font-semibold text-navy-900 hover:underline', narrow ? 'line-clamp-2 text-xs leading-tight' : 'truncate text-sm')}>{a.title}</span>
          <span className="flex flex-wrap items-center gap-x-1 text-[11px] text-slate-500">{!narrow && <Clock size={11} />} {timeText(a)}{live === 'berlangsung' && <b className="text-green-700">berlangsung</b>}</span>
        </span>
      </button>
      {people.length > 0 && <div className="mt-1.5 flex items-center gap-1" title={people.map((p) => `${p.name} (${p.role})`).join(', ')}>
        {people.slice(0, narrow ? 2 : 4).map((p) => <span key={p.id} className={cn('grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold', p.role === 'PIC' ? 'bg-navy-700 text-white' : 'bg-slate-200 text-slate-700')}>{initials(p.name)}</span>)}
        {!narrow && <span className="truncate text-[11px] text-slate-500">{people[0].name}{people.length > 1 && ` +${people.length - 1}`}</span>}
      </div>}
      {!people.length && <div className="mt-1 text-[11px] text-amber-700">{narrow ? 'Belum ada PIC' : 'Belum ada PIC'}</div>}
      {online && <a href={a.meeting_url} target="_blank" rel="noreferrer" aria-label={`${joinLabel(a.meeting_url)}: ${a.title}`}
        className={cn('mt-auto flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white', live ? 'bg-green-700 hover:bg-green-800' : 'bg-violet-700 hover:bg-violet-800')}>
        {narrow ? 'Gabung' : joinLabel(a.meeting_url)} <ArrowRight size={12} /></a>}
    </div>
  );
}

/** Grid jam (Senin–Minggu atau satu hari): kartu ditempatkan menurut jam mulai dan lamanya; jadwal beririsan dibagi lajur. */
export function TimeGrid({ days, agendas, today, now, onOpen }: { days: string[]; agendas: Agenda[]; today: string; now: string; onOpen: (a: Agenda) => void }) {
  const timed = agendas.filter((a) => a.start_time);
  const startHour = Math.min(7, ...timed.map((a) => Number(a.start_time.slice(0, 2))));
  const endHour = Math.max(18, ...timed.map((a) => Math.ceil((Number((a.end_time || a.start_time).slice(0, 2)) * 60 + Number((a.end_time || a.start_time).slice(3, 5)) + (a.end_time ? 0 : 60)) / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const allDay = agendas.filter((a) => !a.start_time);
  const nowTop = (Number(now.slice(0, 2)) * 60 + Number(now.slice(3, 5)) - startHour * 60) * HOUR_PX / 60;
  const cols = days.length === 1 ? 'grid-cols-[56px_minmax(0,1fr)]' : 'grid-cols-[56px_repeat(7,minmax(190px,1fr))]';
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { // minggu ini: geser agar kolom hari ini terlihat
    const el = box.current; const col = el?.querySelector<HTMLElement>('[data-today]');
    if (el && col) el.scrollLeft = Math.max(0, col.offsetLeft - 56 - col.offsetWidth);
  }, [days[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className="overflow-x-auto rounded-lg border border-slate-200">
      <div className={cn('grid min-w-0', cols)}>
        <div className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white" />
        {days.map((d) => (
          <div key={d} data-today={d === today || undefined} className={cn('border-b border-r border-slate-200 px-2 py-2 text-center text-sm', d === today ? 'bg-navy-50' : 'bg-white')}>
            <span className="text-slate-500">{dayName(d)} </span><b className={cn('text-lg', d === today ? 'text-navy-800' : 'text-navy-900')}>{Number(d.slice(8))}</b>
          </div>))}
        {allDay.length > 0 && <>
          <div className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white px-1 py-2 text-[10px] text-slate-500">Tanpa jam</div>
          {days.map((d) => <div key={d} className="space-y-1 border-b border-r border-slate-200 p-1">{allDay.filter((a) => a.agenda_date === d).map((a) => (
            <button key={a.id} onClick={() => onOpen(a)} className="block w-full truncate rounded bg-navy-100 px-2 py-1 text-left text-xs text-navy-900 hover:bg-navy-200">{a.title}</button>))}</div>)}
        </>}
        <div className="sticky left-0 z-20 border-r border-slate-200 bg-white">
          {hours.map((h) => <div key={h} style={{ height: HOUR_PX }} className="pr-2 pt-1 text-right text-[11px] text-slate-400">{String(h).padStart(2, '0')}.00</div>)}
        </div>
        {days.map((d) => (
          <div key={d} className={cn('relative border-r border-slate-200', d === today && 'bg-navy-50/40')} style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h, i) => <div key={h} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ top: i * HOUR_PX }} />)}
            {d === today && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && <div className="pointer-events-none absolute inset-x-0 border-t-2 border-red-400" style={{ top: nowTop }} aria-label={`Sekarang ${now}`} />}
            {layoutDay(timed.filter((a) => a.agenda_date === d), startHour).map(({ item, top, height, lane, lanes }) => (
              <div key={item.id} className="absolute z-10 p-0.5" style={{ top: top * HOUR_PX / 60, height: Math.max(height * HOUR_PX / 60, item.meeting_url ? 124 : 64), left: `${(lane / lanes) * 100}%`, width: `${100 / lanes}%` }}>
                <GridCard a={item} onOpen={onOpen} live={liveState(item, today, now)} narrow={lanes > 1 && days.length > 1} />
              </div>))}
          </div>))}
      </div>
    </div>
  );
}

/** Ringkasan minggu: 7 kolom yang selalu muat lebar layar; tiap hari berisi kartu kecil urut jam. */
export function WeekColumns({ days, agendas, today, now, onOpen }: { days: string[]; agendas: Agenda[]; today: string; now: string; onOpen: (a: Agenda) => void }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const list = agendas.filter((a) => a.agenda_date === d).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
        return (
          <div key={d} className={cn('min-h-40 min-w-0 rounded-lg p-2', d === today ? 'bg-navy-50 ring-2 ring-navy-400' : 'bg-slate-50')}>
            <div className={cn('mb-2 text-xs font-semibold', d === today ? 'text-navy-800' : 'text-slate-500')}>{dayName(d).slice(0, 3)} {Number(d.slice(8))}{d === today && ' · hari ini'}</div>
            <ul className="space-y-1.5">{list.map((a) => {
              const live = liveState(a, today, now); const online = !!a.meeting_url && a.status === 'terjadwal';
              return (
                <li key={a.id} className={cn('rounded-md border-l-4 bg-white px-2 py-1.5 text-xs shadow-sm', live === 'berlangsung' ? 'border-green-600' : online ? 'border-violet-600' : 'border-navy-700', a.status !== 'terjadwal' && 'opacity-60')}>
                  <button onClick={() => onOpen(a)} className="block w-full text-left">
                    <span className="line-clamp-2 font-semibold text-navy-900 hover:underline">{a.title}</span>
                    <span className="block truncate text-slate-500">{a.start_time || 'Tanpa jam'}{online ? ' · daring' : a.location && ` · ${a.location}`}</span>
                  </button>
                  {!a.pic && a.status === 'terjadwal' && <span className="text-[11px] text-amber-700">Belum ada PIC</span>}
                </li>);
            })}</ul>
          </div>);
      })}
    </div>
  );
}
