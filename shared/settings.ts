import type { Layout, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  institution_name: '',
  institution_address: '',
  institution_logo: '',
  kop_enabled: 'true',
  sender_identity: '',
  official_title: '',
  official_name: '',
  default_font: 'Arial',
  default_font_size: '12',
  margin_top: '25',
  margin_right: '25',
  margin_bottom: '25',
  margin_left: '30',
  line_height: '1.15',
  show_page_number: 'false',
  export_dir: '',
  backup_dir: '',
  ai_enabled: 'false',
  ai_endpoint: '',
  ai_model: ''
};

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== undefined ? n : d;
};

export function layoutFromSettings(s: Settings): Layout {
  return {
    fontFamily: s.default_font || 'Arial',
    fontSize: num(s.default_font_size, 12),
    lineHeight: num(s.line_height, 1.15),
    marginTop: num(s.margin_top, 25),
    marginRight: num(s.margin_right, 25),
    marginBottom: num(s.margin_bottom, 25),
    marginLeft: num(s.margin_left, 30),
    showPageNumber: s.show_page_number === 'true'
  };
}

export const FONT_FAMILIES = ['Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Tahoma', 'Verdana', 'Bookman Old Style'];
export const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];

/** Pengaturan yang boleh diubah dari renderer (api key AI disimpan terpisah). */
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
