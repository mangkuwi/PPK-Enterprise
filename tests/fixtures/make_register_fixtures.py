"""Membuat berkas Excel uji untuk impor register: python3 make_register_fixtures.py [direktori]"""
import datetime, os, sys
import openpyxl

out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
F = '{}/BA/PPK.6/BAKTI.31.9/KOMDIGI/{}/2026'
MM = {'Januari': 1, 'Februari': 2, 'Maret': 3}

wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'BA 2026'
ws.append(['REKAPITULASI BERITA ACARA 2026']); ws.append([])
ws.append(['TGL', 'BULAN', 'NOMOR', 'NOMOR BA', 'PIHAK', 'PERIHAL', 'KETERANGAN', 'PEMBUAT'])
for d, b, n, p, pr, k, c in [(5, 'Januari', 1, 'PT Alpha', 'BA Pemeriksaan', '', 'Budi'), (12, 'Januari', 2, 'PT Beta', 'BA Serah Terima', 'lengkap', 'Sari'),
                             (3, 'Februari', 4, 'PT Gamma', 'BA Negosiasi', '', 'Budi'), (20, 'Maret', 5, 'PT Alpha', 'BA Pembayaran & "uang muka"', '', 'Budi')]:
    ws.append([d, b, n, F.format(n, MM[b]), p, pr, k, c])
ws.append([])
ws.append([datetime.date(2026, 4, 7), 'April', 6, F.format(6, 4), 'PT Delta', 'BA Tanggal Asli', '', 'Sari'])
ws['A9'].number_format = 'dd/mm/yyyy'
wb.save(os.path.join(out, 'register-ba-2026.xlsx'))

wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Data'
ws.append(['TGL', 'BULAN', 'NOMOR', 'NOMOR BA', 'PIHAK', 'PERIHAL', 'KETERANGAN', 'PEMBUAT'])
ws.append([5, 'Januari', 1, F.format(1, 1), 'A', 'x', '', 'Budi'])
ws.append([6, 'Januari', 1, F.format(1, 1), 'A', 'duplikat', '', 'Budi'])
ws.append([7, 'Januari', 2, F.format(3, 1), 'A', 'tidak cocok', '', 'Budi'])
ws.append([31, 'Februari', 3, F.format(3, 2), 'A', 'tanggal salah', '', 'Budi'])
wb.save(os.path.join(out, 'register-ba-bad.xlsx'))
