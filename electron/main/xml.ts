/**
 * Parser XML minimal untuk OOXML (tanpa dependensi, tanpa entity eksternal → aman dari XXE).
 * Nama elemen/atribut disimpan tanpa prefix namespace (w:p → p, w:val → val).
 */
export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

const local = (s: string) => { const i = s.indexOf(':'); return i >= 0 ? s.slice(i + 1) : s; };
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ''; }
    }
    return ENT[e] ?? '';
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[local(m[1])] = decodeEntities(m[2] ?? m[3] ?? '');
  return out;
}

// Teks hanya dikumpulkan dari elemen teks; spasi antar-elemen diabaikan.
const TEXT_TAGS = new Set(['t', 'instrText', 'delText']);

export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { if (TEXT_TAGS.has(top.name)) top.text += m[1]; continue; }
    if (m[3] !== undefined) {
      if (m[2] === '/') { if (stack.length > 1) stack.pop(); continue; }
      const node: XNode = { name: local(m[3]), attrs: parseAttrs(m[4] ?? ''), children: [], text: '' };
      top.children.push(node);
      if (m[5] !== '/') stack.push(node);
    } else if (m[6] !== undefined && TEXT_TAGS.has(top.name)) {
      top.text += decodeEntities(m[6]);
    }
  }
  return root.children[0] ?? root;
}
