// c:\avenuel\avenuel-fm-apps\fm\cad\layers.js
// 레이어 분류 규칙과 ACI 색상표 (온라인 뷰어용)

export const CATS = [
  {id:'dim',   name:'치수·지시선',      color:'#ffd43b', re:/dim|치수|leader|지시|ldr/},
  {id:'frame', name:'도면틀·기준선',    color:'#c0eb75', re:/frame|border|도곽|도면틀|표제|ttl|title|sheet|vport|viewport|defpoints|grid|그리드|축선|중심|center|centre|기준|axis|(?:^|[^a-z])cl(?![a-z])|(?:^|[^가-힣])축(?![가-힣])/},
  {id:'text',  name:'문자·주석',        color:'#69db7c', re:/text|txt|문자|글자|note|노트|주석|anno|label|라벨|(?:^|[^a-z])tags?(?![a-z])|범례|legend|도면명|표기|기호|설명/},
  {id:'open',  name:'개구부 (문·창)',   color:'#ffa94d', re:/door|문|window|창|opening|개구|창호|샷시|sash|glaz|유리|glass|curtain|커튼월|(?:^|[^a-z])win(?![a-z])/},
  {id:'struct',name:'구조·건축 (벽·기둥·보)', color:'#ff6b6b', re:/wall|벽|(?:^|[^a-z])cols?(?![a-z])|column|기둥|beam|(?:^|[^가-힣])보(?![가-힣])|slab|슬래브|struct|구조|철근|rebar|조적|콘크리트|concrete|found|기초|stair|계단|roof|지붕|건축/},
  {id:'furn',  name:'가구·장비',        color:'#b197fc', re:/furn|가구|equip|장비|fixt|위생기구|기구|casework|(?:^|[^a-z])fitting/},
  {id:'mep',   name:'설비 (배관·전기·공조)', color:'#4dabf7', re:/pipe|배관|elec|전기|전열|조명|light|hvac|공조|duct|덕트|mech|기계|plumb|위생|소방|fire|sprink|(?:^|[^a-z])spk|통신|telecom|설비|급수|배수|water|drain|sewer|(?:^|[^a-z])gas|가스|냉난방|냉방|난방|heat|cable|케이블|conduit|전선|panel|패널/},
  {id:'fin',   name:'마감·해치',        color:'#38d9a9', re:/hatch|해치|pattern|패턴|finish|마감|tile|타일|floor|flor|바닥|ceil|천장|(?:^|[^a-z])fill|채움|paint|도장|material|재료/},
  {id:'site',  name:'대지·외부',        color:'#f783ac', re:/site|대지|지적|도로|road|조경|land|등고|contour|경계|부지|topo|식재|tree|수목|plant|지형|ground|parcel|fence|울타리|외부|주차|curb|연석|보도|(?:^|[^a-z])lot(?![a-z])/},
  {id:'etc',   name:'기타',             color:'#868e96', re:null},
];

export const CATMAP = Object.fromEntries(CATS.map(c => [c.id, c]));

export function classify(name) {
  const n = String(name).toLowerCase();
  for (const c of CATS) if (c.re && c.re.test(n)) return c.id;
  return 'etc';
}

const ACI_BASE = {1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',6:'#ff00ff',7:'#ffffff',8:'#808080',9:'#c0c0c0'};
const GREY = ['#333333','#505050','#696969','#828282','#bebebe','#ffffff'];

function hsv(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

const aciCache = [];
export function aci(n) {
  if (aciCache[n]) return aciCache[n];
  let r;
  if (n >= 1 && n <= 9) r = ACI_BASE[n];
  else if (n >= 250 && n <= 255) r = GREY[n - 250];
  else if (n >= 10 && n <= 249) {
    const k = n - 10, i = k % 10;
    r = hsv(Math.floor(k / 10) * 15, (i & 1) ? .5 : 1, [1, .8, .6, .5, .3][i >> 1]);
  } else {
    r = '#ffffff';
  }
  return aciCache[n] = r;
}

const LIGHT = {
  dim:'#a97c00', frame:'#5b8a0e', text:'#1c8a41', open:'#d4690a', struct:'#cf353b',
  furn:'#7650d0', mep:'#1b68d1', fin:'#0c9473', site:'#cc3f79', etc:'#5F6B7A'
};

export const catColor = (id, theme) => theme === 'light' ? LIGHT[id] || '#5F6B7A' : (CATMAP[id] ? CATMAP[id].color : '#868e96');

const lum = h => {
  const n = parseInt(h.slice(1), 16);
  return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
};

export function adapt(hex, theme) {
  const l = lum(hex);
  if (theme === 'light') {
    if (l > 0.8) return '#1E3A5F';
    if (l > 0.5) {
      const n = parseInt(hex.slice(1), 16);
      return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => Math.round(v * 0.7).toString(16).padStart(2, '0')).join('');
    }
    return hex;
  }
  return l < 0.14 ? '#9aa7b3' : hex;
}
