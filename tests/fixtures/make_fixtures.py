"""Membuat sample DOCX untuk uji Smart Template Importer (python-docx). Jalankan: python3 make_fixtures.py"""
import io, struct, zlib
from docx import Document
from docx.shared import Pt, Mm, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

def png(w=120, h=120, color=(20, 40, 100)):
    raw = b''.join(b'\x00' + bytes(color) * w for _ in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

def setup(doc, font='Arial', size=12, margins=(25, 25, 25, 30)):
    st = doc.styles['Normal']; st.font.name = font; st.font.size = Pt(size)
    st.element.rPr.rFonts.set(qn('w:eastAsia'), font)
    s = doc.sections[0]; s.page_width = Mm(210); s.page_height = Mm(297)
    s.top_margin, s.right_margin, s.bottom_margin, s.left_margin = [Mm(m) for m in margins]

def para(doc, text='', bold=False, italic=False, align=None, size=None, after=6, before=0, underline=False, font=None, indent=None):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(after); p.paragraph_format.space_before = Pt(before)
    if align == 'c': p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif align == 'r': p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    elif align == 'j': p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    if indent: p.paragraph_format.left_indent = Cm(indent)
    if text:
        r = p.add_run(text); r.bold = bold; r.italic = italic; r.underline = underline
        if size: r.font.size = Pt(size)
        if font: r.font.name = font
    return p

def split_runs(p, parts):
    """paragraf dengan beberapa run berformat berbeda: parts = [(teks, bold, italic)]"""
    for t, b, i in parts:
        r = p.add_run(t); r.bold = b; r.italic = i
    return p

def tab_line(doc, label, value, stop=Cm(3.2)):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.tab_stops.add_tab_stop(stop)
    p.add_run(f'{label}\t: {value}')
    return p

def borderless(table):
    tblPr = table._tbl.tblPr
    b = OxmlElement('w:tblBorders')
    for k in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement(f'w:{k}'); e.set(qn('w:val'), 'nil'); b.append(e)
    tblPr.append(b)

def kop(doc, with_logo=True):
    t = doc.add_table(rows=1, cols=2); borderless(t)
    t.columns[0].width = Cm(2.6); t.columns[1].width = Cm(13)
    c0, c1 = t.rows[0].cells; c0.width = Cm(2.6); c1.width = Cm(13)
    if with_logo:
        c0.paragraphs[0].add_run().add_picture(io.BytesIO(png()), width=Cm(2.2))
    p = c1.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('KEMENTERIAN KOMUNIKASI DAN DIGITAL'); r.bold = True; r.font.size = Pt(14)
    p2 = c1.add_paragraph(); p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p2.add_run('BADAN AKSESIBILITAS TELEKOMUNIKASI DAN INFORMASI').bold = True
    p3 = c1.add_paragraph(); p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r3 = p3.add_run('Jl. Medan Merdeka Barat No. 9, Jakarta Pusat 10110'); r3.font.size = Pt(9)
    line = doc.add_paragraph(); pPr = line._p.get_or_add_pPr(); bd = OxmlElement('w:pBdr')
    bt = OxmlElement('w:bottom'); bt.set(qn('w:val'), 'double'); bt.set(qn('w:sz'), '6'); bt.set(qn('w:space'), '1'); bt.set(qn('w:color'), '000000')
    bd.append(bt); pPr.append(bd)

def signature(doc, jabatan='Plt. Direktur Infrastruktur,', nama='Ir. Budi Santoso, M.T.', nip='NIP. 197501012000031001', lines=3):
    para(doc, jabatan, align=None, after=0, before=12)
    for _ in range(lines): para(doc, '', after=0)
    para(doc, nama, bold=True, underline=True, after=0)
    para(doc, nip, after=0)

def number_list(doc, items):
    for t in items:
        p = doc.add_paragraph(t, style='List Number'); p.paragraph_format.space_after = Pt(2)

CLOSING = 'Demikian disampaikan, atas perhatian dan kerja sama Bapak/Ibu diucapkan terima kasih.'

def f1_satu_halaman():
    d = Document(); setup(d)
    para(d, 'Jakarta, 23 November 2026', align='r')
    tab_line(d, 'Nomor', 'B-123/DIR.INF/DS.01/11/2026')
    tab_line(d, 'Sifat', 'Segera')
    tab_line(d, 'Lampiran', '1 (satu) berkas')
    tab_line(d, 'Hal', 'Permohonan Rapat Pembahasan IP HUB')
    para(d, '', after=2)
    para(d, 'Yth.', after=0); para(d, 'Plt. Direktur Infrastruktur', after=0); para(d, 'di tempat', after=8)
    para(d, 'Sehubungan dengan pelaksanaan layanan IP HUB pada Satelit SATRIA-1, bersama ini kami mohon dapat diselenggarakan rapat pembahasan untuk menyelaraskan kebutuhan teknis dan jadwal implementasi layanan tersebut.', align='j')
    para(d, CLOSING, align='j')
    signature(d)
    return d

def f2_beberapa_halaman():
    d = Document(); setup(d, font='Times New Roman', size=12)
    para(d, 'LAPORAN PELAKSANAAN KEGIATAN', bold=True, align='c', size=14)
    para(d, 'Nomor: LAP-07/DS/XI/2026', align='c')
    for i in range(1, 7):
        para(d, f'Bagian {i}', bold=True, before=6)
        para(d, ('Kegiatan monitoring layanan telah dilaksanakan sesuai jadwal dan seluruh temuan dicatat pada lembar pemantauan. ' * 4).strip(), align='j')
    d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    para(d, 'Lampiran Dokumentasi', bold=True)
    para(d, 'Dokumentasi kegiatan terlampir pada halaman ini.', align='j')
    para(d, CLOSING)
    signature(d, jabatan='Kepala Divisi Satelit,', nama='Dewi Lestari, S.Kom.', nip='NIP. 198203152006042002')
    return d

def f3_kop_logo():
    d = Document(); setup(d); kop(d)
    para(d, 'NOTA DINAS', bold=True, align='c', underline=True, after=0)
    para(d, 'Nomor: ND-45/DS.02/11/2026', align='c', after=10)
    tab_line(d, 'Yth.', 'Direktur Infrastruktur')
    tab_line(d, 'Dari', 'Kepala Divisi Satelit')
    tab_line(d, 'Hal', 'Laporan Progres Layanan IP Transit')
    tab_line(d, 'Tanggal', '23 November 2026')
    para(d, '', after=4)
    para(d, 'Menindaklanjuti arahan pimpinan pada rapat koordinasi sebelumnya, bersama ini kami laporkan progres layanan IP Transit.', align='j')
    para(d, CLOSING, align='j')
    signature(d)
    return d

def f4_tabel():
    d = Document(); setup(d)
    para(d, 'SURAT TUGAS', bold=True, align='c', underline=True, after=0)
    para(d, 'Nomor: ST-12/DS.01/11/2026', align='c', after=10)
    para(d, 'Yang bertanda tangan di bawah ini menugaskan pegawai berikut:')
    t = d.add_table(rows=4, cols=4); t.style = 'Table Grid'; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, w in enumerate((1.2, 5.2, 4.2, 4.6)):
        for r in t.rows: r.cells[i].width = Cm(w)
    for i, h in enumerate(('No', 'Nama', 'NIP', 'Jabatan')):
        c = t.rows[0].cells[i]; c.text = ''; c.paragraphs[0].add_run(h).bold = True
    data = [('1', 'Andi Pratama', '198801012012011001', 'Pelaksana'), ('2', 'Sari Wulandari', '199002022014022002', 'Analis'), ('3', 'Rudi Hartono', '198505052010011003', 'Pengelola')]
    for ri, row in enumerate(data, 1):
        for ci, v in enumerate(row): t.rows[ri].cells[ci].text = v
    para(d, '', after=4)
    para(d, 'Untuk melaksanakan perjalanan dinas dalam rangka monitoring layanan satelit pada lokasi yang ditetapkan.', align='j')
    tab_line(d, 'Hari/Tanggal', 'Senin, 23 November 2026')
    tab_line(d, 'Waktu', '09.00 WIB s.d. selesai')
    tab_line(d, 'Tempat', 'Gedung Utama BAKTI, Jakarta')
    para(d, 'Demikian surat tugas ini dibuat untuk dilaksanakan dengan penuh tanggung jawab.', align='j', before=6)
    signature(d)
    return d

def f5_tanda_tangan_dua():
    d = Document(); setup(d)
    para(d, 'BERITA ACARA', bold=True, align='c', after=0); para(d, 'PEMBAHASAN TEKNIS IP HUB', bold=True, align='c', after=0)
    para(d, 'Nomor: BA-03/DS/XI/2026', align='c', after=10)
    para(d, 'Pada hari Senin tanggal 23 November 2026, pukul 10.00 WIB, bertempat di Ruang Rapat Divisi Satelit, telah dilaksanakan pembahasan teknis layanan IP HUB.', align='j')
    t = d.add_table(rows=1, cols=2); borderless(t)
    for c, (j, n) in zip(t.rows[0].cells, (('Pihak Pertama,', 'Ir. Budi Santoso, M.T.'), ('Pihak Kedua,', 'Dewi Lestari, S.Kom.'))):
        c.text = ''; p = c.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.add_run(j)
        for _ in range(3): c.add_paragraph('')
        p2 = c.add_paragraph(); p2.alignment = WD_ALIGN_PARAGRAPH.CENTER; r = p2.add_run(n); r.bold = True; r.underline = True
    return d

def f6_header_footer():
    d = Document(); setup(d)
    s = d.sections[0]
    hp = s.header.paragraphs[0]; hp.text = 'DOKUMEN INTERNAL - DIVISI SATELIT'; hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fp = s.footer.paragraphs[0]; fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fp.add_run('Halaman ')
    r = fp.add_run(); f1 = OxmlElement('w:fldChar'); f1.set(qn('w:fldCharType'), 'begin'); r._r.append(f1)
    r = fp.add_run(); it = OxmlElement('w:instrText'); it.set(qn('xml:space'), 'preserve'); it.text = ' PAGE '; r._r.append(it)
    r = fp.add_run(); f2 = OxmlElement('w:fldChar'); f2.set(qn('w:fldCharType'), 'separate'); r._r.append(f2)
    fp.add_run('1')
    r = fp.add_run(); f3 = OxmlElement('w:fldChar'); f3.set(qn('w:fldCharType'), 'end'); r._r.append(f3)
    para(d, 'SURAT PEMBERITAHUAN', bold=True, align='c', after=0)
    para(d, 'Nomor: 77/DS.03/XI/2026', align='c', after=10)
    tab_line(d, 'Kepada', 'Seluruh Pejabat Pembuat Komitmen')
    tab_line(d, 'Perihal', 'Pemberitahuan Jadwal Pemeliharaan Layanan')
    para(d, '', after=4)
    para(d, 'Dengan ini diberitahukan bahwa akan dilakukan pemeliharaan terjadwal pada layanan satelit sebagaimana rincian berikut.', align='j')
    para(d, CLOSING)
    signature(d)
    return d

def f7_banyak_font():
    d = Document(); setup(d, font='Calibri', size=11)
    para(d, 'SURAT UNDANGAN', bold=True, align='c', size=16, font='Cambria', after=0)
    para(d, 'Nomor: UND-09/DS/XI/2026', align='c', font='Verdana', size=10, after=8)
    tab_line(d, 'Hal', 'Undangan Rapat Koordinasi Layanan')
    para(d, 'Yth. Seluruh Tim Pelaksana', before=6, font='Tahoma')
    para(d, 'Dengan hormat, kami mengundang Bapak/Ibu untuk hadir pada:', font='Georgia', size=12)
    tab_line(d, 'Hari/Tanggal', 'Selasa, 24 November 2026')
    tab_line(d, 'Waktu', 'Pukul 13.30 WIB')
    tab_line(d, 'Tempat', 'Ruang Rapat Lantai 5')
    tab_line(d, 'Agenda', 'Pembahasan kesiapan layanan IP HUB')
    para(d, CLOSING, before=8)
    signature(d)
    return d

def f8_numbering():
    d = Document(); setup(d)
    para(d, 'NOTA DINAS', bold=True, align='c', after=0)
    para(d, 'Nomor: ND-88/DS/XI/2026', align='c', after=8)
    tab_line(d, 'Yth.', 'Direktur Infrastruktur'); tab_line(d, 'Dari', 'Kepala Divisi Satelit'); tab_line(d, 'Hal', 'Usulan Tindak Lanjut'); tab_line(d, 'Tanggal', '23 November 2026')
    para(d, 'Berdasarkan hasil evaluasi, kami mengusulkan langkah tindak lanjut sebagai berikut:', align='j', before=8)
    number_list(d, ['Melakukan verifikasi dokumen kontrak layanan.', 'Menyusun jadwal pemantauan bulanan.', 'Melaporkan hasil pemantauan kepada pimpinan.'])
    para(d, CLOSING, before=6)
    signature(d)
    return d

def f9_multi_run():
    d = Document(); setup(d)
    p = para(d, '', align='r'); split_runs(p, [('Jakarta, ', False, False), ('23 ', True, False), ('November', False, True), (' 2026', True, False)])
    p = d.add_paragraph(); p.paragraph_format.tab_stops.add_tab_stop(Cm(3.2))
    split_runs(p, [('Nom', False, False), ('or\t: ', False, False), ('B-0', True, False), ('55/DS', False, False), ('/XI/2026', True, False)])
    p = d.add_paragraph(); p.paragraph_format.tab_stops.add_tab_stop(Cm(3.2))
    split_runs(p, [('Perihal\t: ', False, False), ('Permohonan ', True, False), ('Data ', False, True), ('Layanan', True, True)])
    para(d, 'Yth.', after=0)
    p = para(d, '', after=0); split_runs(p, [('Plt. ', False, False), ('Direktur ', True, False), ('Infrastruktur', False, False)])
    para(d, 'di tempat', after=8)
    p = para(d, '', align='j'); split_runs(p, [('Sehubungan dengan ', False, False), ('pelaksanaan layanan ', True, False), ('IP HUB', True, True), (' pada Satelit SATRIA-1, kami mohon data pendukung layanan.', False, False)])
    para(d, CLOSING)
    signature(d)
    return d

from docx.enum.section import WD_ORIENT, WD_SECTION
from lxml import etree

def f10_landscape_multisection():
    """Bagian 1 potret dengan header sendiri; bagian 2 lanskap dengan header berbeda dan tabel lebar."""
    d = Document(); setup(d)
    d.sections[0].header.paragraphs[0].text = 'PEMERINTAH CONTOH - BAGIAN POTRET'
    para(d, 'NOTA DINAS', bold=True, align='c', size=14)
    tab_line(d, 'Nomor', 'ND-010/DS/XI/2026'); tab_line(d, 'Hal', 'Rekapitulasi Layanan'); tab_line(d, 'Tanggal', '23 November 2026')
    para(d, 'Rekapitulasi lengkap terlampir pada bagian berikutnya yang dicetak lanskap.', align='j', before=8)
    sec = d.add_section(WD_SECTION.NEW_PAGE)
    sec.orientation = WD_ORIENT.LANDSCAPE; sec.page_width, sec.page_height = sec.page_height, sec.page_width
    sec.header.is_linked_to_previous = False
    sec.header.paragraphs[0].text = 'LAMPIRAN - BAGIAN LANSKAP'
    t = d.add_table(rows=3, cols=4); t.style = 'Table Grid'
    for i, h in enumerate(['No', 'Layanan', 'Lokasi', 'Status']): t.rows[0].cells[i].text = h
    for r, row in enumerate([['1', 'IP HUB', 'Jakarta', 'Aktif'], ['2', 'IP Transit', 'Bandung', 'Aktif']], start=1):
        for i, v in enumerate(row): t.rows[r].cells[i].text = v
    para(d, 'Demikian disampaikan, atas perhatian Bapak/Ibu diucapkan terima kasih.', before=10)
    return d

VML = ('<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml">'
       '<w:r><w:pict><v:shape id="kotak1" type="#_x0000_t202" style="position:absolute;margin-left:330pt;margin-top:10pt;width:140pt;height:50pt;z-index:251659264;mso-position-horizontal-relative:margin" fillcolor="#eeeeee">'
       '<v:textbox><w:txbxContent><w:p><w:r><w:t>Agenda: Rapat Koordinasi</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>')

def f11_textbox_floating():
    """Kotak teks mengambang (VML) + logo mengambang (anchor) + isi surat."""
    d = Document(); setup(d)
    d.paragraphs[0]._p.addnext(etree.fromstring(VML)) if d.paragraphs else d.element.body.insert(0, etree.fromstring(VML))
    para(d, 'SURAT UNDANGAN', bold=True, align='c', size=14)
    tab_line(d, 'Nomor', 'UND-011/DS/XI/2026'); tab_line(d, 'Hal', 'Undangan Rapat Koordinasi'); tab_line(d, 'Tanggal', '23 November 2026')
    para(d, 'Yth.', after=0); para(d, 'Seluruh Pejabat Divisi Satelit', after=8)
    para(d, 'Dengan hormat, kami mengundang Bapak/Ibu pada rapat koordinasi sesuai agenda di samping.', align='j')
    run = d.add_paragraph().add_run(); run.add_picture(io.BytesIO(png()), width=Cm(2))
    inline = run._r.find('.//' + qn('wp:inline'))
    ns = {'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
    anchor = etree.SubElement(inline.getparent(), '{%s}anchor' % ns['wp'], distT='0', distB='0', distL='0', distR='0', simplePos='0', relativeHeight='1', behindDoc='0', locked='0', layoutInCell='1', allowOverlap='1')
    etree.SubElement(anchor, '{%s}simplePos' % ns['wp'], x='0', y='0')
    ph = etree.SubElement(anchor, '{%s}positionH' % ns['wp'], relativeFrom='margin'); etree.SubElement(ph, '{%s}posOffset' % ns['wp']).text = '5000000'
    pv = etree.SubElement(anchor, '{%s}positionV' % ns['wp'], relativeFrom='paragraph'); etree.SubElement(pv, '{%s}posOffset' % ns['wp']).text = '0'
    for ch in list(inline):
        if ch.tag.endswith('}extent'): anchor.append(ch)
    etree.SubElement(anchor, '{%s}wrapNone' % ns['wp'])
    for ch in list(inline): anchor.append(ch)
    inline.getparent().remove(inline)
    para(d, CLOSING)
    signature(d)
    return d

def _paraf_table(d, headers, widths_cm):
    t = d.add_table(rows=2, cols=len(headers)); t.style = 'Table Grid'
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]; c.text = ''; r = c.paragraphs[0].add_run(h); r.bold = True
        t.rows[1].cells[i].text = ''
        c.width = Cm(widths_cm[i]); t.rows[1].cells[i].width = Cm(widths_cm[i])
    return t

def _nota_page(d, nomor, tanggal, paraf_headers, widths):
    para(d, 'NOTA DINAS', bold=True, align='c', size=14)
    tab_line(d, 'Yth.', 'Direktur Infrastruktur'); tab_line(d, 'Dari', 'Kepala Divisi Satelit')
    tab_line(d, 'Nomor', nomor); tab_line(d, 'Hal', 'Usulan Tindak Lanjut Layanan'); tab_line(d, 'Tanggal', tanggal)
    para(d, 'Berdasarkan hasil evaluasi layanan IP HUB pada Satelit SATRIA-1, kami mengusulkan langkah tindak lanjut berupa verifikasi dokumen kontrak, penyusunan jadwal pemantauan bulanan, dan pelaporan hasil pemantauan kepada pimpinan.', align='j', before=8)
    para(d, CLOSING, before=6)
    signature(d)
    para(d, 'Paraf Persetujuan:', bold=True, before=8, after=2)
    _paraf_table(d, paraf_headers, widths)

def f12_varian_paraf():
    """Satu DOCX dua halaman: Nota Dinas identik, hanya kolom paraf yang berbeda (A: 3 kolom, B: 4 kolom)."""
    d = Document(); setup(d)
    _nota_page(d, 'ND-012/DS/XI/2026', '23 November 2026', ['Kepala Bagian', 'Kepala Subbagian', 'Staf Pelaksana'], [5, 5, 5])
    d.add_page_break()
    _nota_page(d, 'ND-012/DS/XI/2026', '23 November 2026', ['Paraf 1', 'Paraf 2', 'Paraf 3', 'Paraf 4'], [3.75, 3.75, 3.75, 3.75])
    return d

def f13_varian_nilai_beda():
    """Seperti 12, tetapi nomor & tanggal contoh di halaman 2 berbeda: tetap isian bersama, bukan wilayah khusus varian."""
    d = Document(); setup(d)
    _nota_page(d, 'ND-013/DS/XI/2026', '23 November 2026', ['Kepala Bagian', 'Kepala Subbagian', 'Staf Pelaksana'], [5, 5, 5])
    d.add_page_break()
    _nota_page(d, 'ND-014/DS/XI/2026', '24 November 2026', ['Paraf 1', 'Paraf 2', 'Paraf 3', 'Paraf 4'], [3.75, 3.75, 3.75, 3.75])
    return d

def f14_dua_halaman_beda():
    """Halaman 2 adalah dokumen berbeda (lampiran) — BUKAN varian."""
    d = Document(); setup(d)
    _nota_page(d, 'ND-014/DS/XI/2026', '23 November 2026', ['Kepala Bagian', 'Kepala Subbagian', 'Staf Pelaksana'], [5, 5, 5])
    d.add_page_break()
    para(d, 'LAMPIRAN', bold=True, align='c', size=14)
    para(d, 'Rincian biaya pelaksanaan pekerjaan pemeliharaan perangkat jaringan dan sewa kapasitas, terdiri atas komponen perangkat keras, perangkat lunak, jasa instalasi, dan biaya operasional bulanan sebagaimana tercantum pada tabel berikut.', align='j')
    t = d.add_table(rows=3, cols=3); t.style = 'Table Grid'
    for i, h in enumerate(['No', 'Komponen', 'Biaya']): t.rows[0].cells[i].text = h
    for r, row in enumerate([['1', 'Perangkat keras', 'Rp 10.000.000'], ['2', 'Jasa instalasi', 'Rp 2.500.000']], start=1):
        for i, v in enumerate(row): t.rows[r].cells[i].text = v
    return d

def f15_varian_ragu():
    """Halaman 2 mirip, tetapi banyak baris berbeda (dari/hal/tanggal/nomor/isi) di samping tabel paraf: klasifikasi varian kurang pasti."""
    d = Document(); setup(d)
    _nota_page(d, 'ND-015/DS/XI/2026', '23 November 2026', ['Kepala Bagian', 'Kepala Subbagian', 'Staf Pelaksana'], [5, 5, 5])
    d.add_page_break()
    para(d, 'NOTA DINAS', bold=True, align='c', size=14)
    tab_line(d, 'Yth.', 'Direktur Utama BAKTI'); tab_line(d, 'Dari', 'Kepala Divisi Satelit dan Teknologi')
    tab_line(d, 'Nomor', 'ND-016/DS/XI/2026'); tab_line(d, 'Hal', 'Usulan Tindak Lanjut Layanan IP Transit'); tab_line(d, 'Tanggal', '24 November 2026')
    para(d, 'Berdasarkan hasil evaluasi layanan IP Transit pada Satelit SATRIA-1, kami mengusulkan langkah tindak lanjut berupa verifikasi dokumen kontrak, penyusunan jadwal pemantauan triwulanan, dan pelaporan hasil pemantauan kepada pimpinan.', align='j', before=8)
    para(d, 'Atas perhatian Bapak diucapkan terima kasih.', before=6)
    signature(d)
    para(d, 'Paraf Persetujuan:', bold=True, before=8, after=2)
    _paraf_table(d, ['Paraf 1', 'Paraf 2', 'Paraf 3', 'Paraf 4'], [3.75, 3.75, 3.75, 3.75])
    return d

FIX = {
 '01_surat_satu_halaman': f1_satu_halaman, '02_surat_beberapa_halaman': f2_beberapa_halaman, '03_kop_logo': f3_kop_logo,
 '04_surat_tabel': f4_tabel, '05_tanda_tangan_dua': f5_tanda_tangan_dua, '06_header_footer': f6_header_footer,
 '07_banyak_font': f7_banyak_font, '08_numbering': f8_numbering, '09_multi_run': f9_multi_run,
 '10_landscape_multisection': f10_landscape_multisection, '11_textbox_floating': f11_textbox_floating,
 '12_varian_paraf': f12_varian_paraf, '13_varian_nilai_beda': f13_varian_nilai_beda, '14_dua_halaman_beda': f14_dua_halaman_beda, '15_varian_ragu': f15_varian_ragu,
}
if __name__ == '__main__':
    for name, fn in FIX.items():
        fn().save(f'{name}.docx'); print('ok', name)
