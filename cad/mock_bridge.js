/**
 * c:\avenuel\avenuel-fm-apps\fm\cad\mock_bridge.js
 * 부모 창(업무지원 앱)이 없을 때 단독 실행을 지원하는 로컬 가짜 통로
 */
(function() {
  const DB_NAME = 'AvenuelCadCache';
  const STORE_NAME = 'cad_dxf_cache';

  // IndexedDB 헬퍼
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function idbGet(id) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('[MockBridge] IndexedDB get error:', e);
      return null;
    }
  }

  async function idbPut(id, blob) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put(blob, id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('[MockBridge] IndexedDB put error:', e);
      return false;
    }
  }

  // 실제 CAD 뷰어에서 바로 볼 수 있는 샘플 DXF 데이터 생성기
  function generateSampleDxf(floor, title) {
    const lines = [
      '0', 'SECTION',
      '2', 'HEADER',
      '9', '$ACADVER',
      '1', 'AC1027',
      '9', '$DWGCODEPAGE',
      '3', 'ANSI_949',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'TABLES',
      '0', 'TABLE',
      '2', 'LAYER',
      '70', '6',
      // LAYER 0
      '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS',
      // WALL (구조/벽)
      '0', 'LAYER', '2', 'WALL_STRUCT', '70', '0', '62', '1', '6', 'CONTINUOUS',
      // DOOR (개구부/창호)
      '0', 'LAYER', '2', 'DOOR_OPEN', '70', '0', '62', '30', '6', 'CONTINUOUS',
      // FURN (가구/매대)
      '0', 'LAYER', '2', 'FURN_EQUIP', '70', '0', '62', '5', '6', 'CONTINUOUS',
      // TEXT (문자/라벨)
      '0', 'LAYER', '2', 'TEXT_LABEL', '70', '0', '62', '3', '6', 'CONTINUOUS',
      // DIM (치수선)
      '0', 'LAYER', '2', 'DIM_LINE', '70', '0', '62', '2', '6', 'CONTINUOUS',
      '0', 'ENDTAB',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'ENTITIES'
    ];

    function addLine(layer, x1, y1, x2, y2) {
      lines.push('0', 'LINE', '8', layer, '10', String(x1), '20', String(y1), '30', '0', '11', String(x2), '21', String(y2), '31', '0');
    }
    function addText(layer, x, y, h, str) {
      lines.push('0', 'TEXT', '8', layer, '10', String(x), '20', String(y), '30', '0', '40', String(h), '1', str);
    }
    function addRect(layer, x, y, w, h) {
      addLine(layer, x, y, x + w, y);
      addLine(layer, x + w, y, x + w, y + h);
      addLine(layer, x + w, y + h, x, y + h);
      addLine(layer, x, y + h, x, y);
    }

    // 외벽 (100m x 60m 쇼핑몰 구역)
    addRect('WALL_STRUCT', 0, 0, 100000, 60000);
    // 중앙 복도 벽
    addLine('WALL_STRUCT', 0, 30000, 42000, 30000);
    addLine('WALL_STRUCT', 58000, 30000, 100000, 30000);
    // 매장 칸막이 벽들
    addLine('WALL_STRUCT', 25000, 0, 25000, 30000);
    addLine('WALL_STRUCT', 50000, 0, 50000, 30000);
    addLine('WALL_STRUCT', 75000, 0, 75000, 30000);
    addLine('WALL_STRUCT', 30000, 30000, 30000, 60000);
    addLine('WALL_STRUCT', 70000, 30000, 70000, 60000);

    // 출입문 (DOOR)
    addLine('DOOR_OPEN', 10000, 30000, 13000, 33000);
    addLine('DOOR_OPEN', 35000, 30000, 38000, 33000);
    addLine('DOOR_OPEN', 60000, 30000, 63000, 33000);
    addLine('DOOR_OPEN', 85000, 30000, 88000, 33000);

    // 가구 / 진열대 (FURN)
    addRect('FURN_EQUIP', 5000, 5000, 15000, 6000);
    addRect('FURN_EQUIP', 5000, 15000, 15000, 6000);
    addRect('FURN_EQUIP', 30000, 5000, 15000, 8000);
    addRect('FURN_EQUIP', 55000, 5000, 15000, 8000);
    addRect('FURN_EQUIP', 80000, 5000, 15000, 8000);
    addRect('FURN_EQUIP', 10000, 40000, 12000, 12000);
    addRect('FURN_EQUIP', 40000, 40000, 20000, 12000);
    addRect('FURN_EQUIP', 75000, 40000, 18000, 12000);

    // 치수선 (DIM)
    addLine('DIM_LINE', 0, -3000, 100000, -3000);
    addText('DIM_LINE', 48000, -2500, 1800, '100,000 mm');
    addLine('DIM_LINE', -3000, 0, -3000, 60000);
    addText('DIM_LINE', -6000, 28000, 1800, '60,000 mm');

    // 문자 라벨 (TEXT)
    addText('TEXT_LABEL', 5000, 55000, 2600, `롯데 에비뉴엘 ${floor} 도면 - ${title}`);
    addText('TEXT_LABEL', 8000, 22000, 1800, 'A 매장 (부티크)');
    addText('TEXT_LABEL', 33000, 22000, 1800, 'B 매장 (잡화)');
    addText('TEXT_LABEL', 58000, 22000, 1800, 'C 매장 (의류)');
    addText('TEXT_LABEL', 83000, 22000, 1800, 'D 매장 (슈즈)');
    addText('TEXT_LABEL', 45000, 52000, 2200, '중앙 이벤트 홀');

    lines.push('0', 'ENDSEC', '0', 'EOF');
    const text = lines.join('\n');
    return new Blob([new TextEncoder().encode(text)], { type: 'application/dxf' });
  }

  const SAMPLE_ITEMS = [
    {
      id: 'sample-1',
      name: '에비뉴엘 1층 도면 (명품관)',
      floor: '1F',
      memo: '1층 샤넬/에르메스/루이비통 부티크 구역 CAD',
      by: '홍길동',
      date: '2026-11-20',
      size: 142500
    },
    {
      id: 'sample-2',
      name: '에비뉴엘 B1층 도면 (식품관)',
      floor: 'B1',
      memo: '지하 1층 푸드코트 및 델리 매장 구획선',
      by: '김시설',
      date: '2026-11-19',
      size: 98400
    },
    {
      id: 'sample-3',
      name: '에비뉴엘 2층 도면 (여성패션)',
      floor: '2F',
      memo: '2층 여성 컨템포러리 매장 도면 정리본',
      by: '이도면',
      date: '2026-11-18',
      size: 112000
    }
  ];

  const MockBridge = {
    isMock: true,

    async me() {
      return {
        name: '김시설',
        role: 'admin'
      };
    },

    async list() {
      // 로컬 스토리지에 추가된 항목이 있으면 합침
      let list = [...SAMPLE_ITEMS];
      try {
        const custom = localStorage.getItem('avenuel_cad_mock_list');
        if (custom) {
          const parsed = JSON.parse(custom);
          list = [...parsed, ...list];
        }
      } catch (e) {}
      return list;
    },

    async open(id) {
      // 1. 캐시 확인
      const cached = await this.cacheGet(id);
      if (cached) {
        const found = SAMPLE_ITEMS.find(s => s.id === id);
        return {
          name: (found ? found.name : id) + '.dxf',
          dxfBlob: cached
        };
      }

      // 2. 샘플 데이터 반환
      const item = SAMPLE_ITEMS.find(s => s.id === id) || SAMPLE_ITEMS[0];
      const blob = generateSampleDxf(item.floor, item.name);
      await this.cachePut(id, blob);
      return {
        name: item.name + '.dxf',
        dxfBlob: blob
      };
    },

    async cacheGet(id) {
      return await idbGet(id);
    },

    async cachePut(id, blob) {
      return await idbPut(id, blob);
    },

    async upload({ file, name, floor, memo }) {   // 단독 시험용: 브라우저 저장소에만 올림
      const id = 'up-' + Date.now();
      await idbPut(id, file);
      let list = [];
      try { list = JSON.parse(localStorage.getItem('avenuel_cad_mock_list') || '[]'); } catch (e) {}
      list = list.filter(x => x.name !== name);
      list.unshift({ id, name, floor, memo, by: '시험', date: new Date().toISOString().slice(0, 10), size: file.size });
      localStorage.setItem('avenuel_cad_mock_list', JSON.stringify(list));
      return { ok: true, id, drive: true };
    },

    async full(on) {
      if (on) {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }
    }
  };

  // 부모 창에 WS_CAD 가 없거나 단독 실행 모드일 경우 연결
  if (!window.parent || window.parent === window || !window.parent.WS_CAD) {
    window.WS_CAD = MockBridge;
    if (!window.parent.WS_CAD) {
      try {
        window.parent.WS_CAD = MockBridge;
      } catch (e) {
        // Cross-origin iframe 등의 경우 무시
      }
    }
  }
})();
