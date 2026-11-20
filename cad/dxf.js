// c:\avenuel\avenuel-fm-apps\fm\cad\dxf.js
// DXF 읽기: 인코딩 판별, 그룹 코드 쌍 파싱, 섹션·레코드 색인 (순수 뷰어용 경량 모듈)

function isStr(c) {
  return c < 10 || (c >= 100 && c <= 102) || (c >= 300 && c <= 369) || (c >= 390 && c <= 399) ||
    (c >= 410 && c <= 419) || (c >= 430 && c <= 439) || (c >= 470 && c <= 481) || c === 999 || (c >= 1000 && c <= 1009);
}

const CODEPAGES = {
  ANSI_949: 'euc-kr', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_950: 'big5',
  ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253', ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257', ANSI_874: 'windows-874', UTF8: 'utf-8'
};

export function decodeDXF(buf) {
  const u8 = new Uint8Array(buf);
  const head = new TextDecoder('windows-1252').decode(u8.subarray(0, 9000));
  if (head.startsWith('AutoCAD Binary DXF')) {
    throw new Error('바이너리 DXF는 지원하지 않습니다. 텍스트(ASCII) DXF로 변환해 주세요.');
  }
  const ver = (head.match(/\$ACADVER\s+1\s+(AC\d+)/) || [])[1] || 'AC1009';
  const cpm = (head.match(/\$DWGCODEPAGE\s+3\s+(\S+)/) || [])[1];
  let enc = 'utf-8';
  if (parseInt(ver.slice(2)) < 1021) {
    enc = CODEPAGES[(cpm || 'ANSI_1252').toUpperCase()] || 'windows-1252';
  }
  let text = new TextDecoder(enc).decode(u8);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return {text, enc, ver: parseInt(ver.slice(2))};
}

export function parsePairs(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const C = [], V = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i], 10);
    if (isNaN(c)) {
      if (lines[i].trim() === '' && i >= lines.length - 2) break;
      throw new Error('DXF 형식이 올바르지 않습니다. (줄 ' + (i + 1) + ')');
    }
    const v = c === 0 ? lines[i + 1].trim() : lines[i + 1];
    C.push(c); V.push(v);
    if (c === 0 && v === 'EOF') break;
  }
  if (!C.length) throw new Error('DXF 내용이 비어 있습니다.');
  return {C, V};
}

export class Doc {
  constructor(C, V, enc, ver) {
    this.C = C; this.V = V; this.enc = enc; this.ver = ver;
    this.secs = {};
    const n = C.length;
    for (let i = 0; i < n - 1; i++) {
      if (C[i] === 0 && V[i] === 'SECTION' && C[i + 1] === 2) {
        const name = V[i + 1].trim().toUpperCase();
        let j = i + 2;
        while (j < n && !(C[j] === 0 && V[j] === 'ENDSEC')) j++;
        this.secs[name] = {s: i + 2, e: j, hs: i};
        i = j;
      }
    }
    if (!this.secs.ENTITIES) throw new Error('ENTITIES 섹션이 없습니다.');
    this.tables = {};
    if (this.secs.TABLES) {
      let table = '';
      for (const r of this.recs(this.secs.TABLES.s, this.secs.TABLES.e)) {
        if (r.t === 'TABLE') table = (C[r.s + 1] === 2 ? V[r.s + 1] : '').trim().toUpperCase();
        else if (r.t !== 'ENDTAB') (this.tables[table] || (this.tables[table] = [])).push(r);
      }
    }
    this.layerRecs = this.tables.LAYER || [];
    this.blocks = new Map();
    if (this.secs.BLOCKS) {
      let cur = null;
      for (const g of this.groups(this.recs(this.secs.BLOCKS.s, this.secs.BLOCKS.e))) {
        if (g.t === 'BLOCK') {
          const o = this.read(g.s, g.he);
          cur = {base: [o[10] ? o[10][0] : 0, o[20] ? o[20][0] : 0], ents: [], s: g.s, e: g.e};
          this.blocks.set(String(o[2] ? o[2][0] : '').toUpperCase(), cur);
        } else if (g.t === 'ENDBLK') {
          if (cur) cur.e = g.e;
          cur = null;
        } else if (cur) {
          cur.ents.push(g);
        }
      }
    }
    this.ents = this.groups(this.recs(this.secs.ENTITIES.s, this.secs.ENTITIES.e));
  }
  recs(s, e) {
    const {C, V} = this, r = [];
    let st = -1;
    for (let i = s; i < e; i++) {
      if (C[i] === 0) {
        if (st >= 0) r.push({s: st, e: i, t: V[st]});
        st = i;
      }
    }
    if (st >= 0) r.push({s: st, e, t: V[st]});
    return r;
  }
  groups(rs) {
    const g = [];
    for (const r of rs) {
      if ((r.t === 'VERTEX' || r.t === 'ATTRIB' || r.t === 'SEQEND') && g.length) {
        const l = g[g.length - 1]; l.e = r.e; l.kids.push(r);
      } else {
        g.push({s: r.s, e: r.e, he: r.e, t: r.t, kids: []});
      }
    }
    return g;
  }
  read(s, e) {
    const {C, V} = this, o = {};
    for (let i = s + 1; i < e; i++) {
      const c = C[i];
      (o[c] || (o[c] = [])).push(isStr(c) ? V[i] : parseFloat(V[i]));
    }
    return o;
  }
  layerOf(g) {
    const {C, V} = this;
    for (let i = g.s + 1; i < g.he; i++) if (C[i] === 8) return V[i];
    return '0';
  }
}

export function uni(s) {
  return String(s).replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}
