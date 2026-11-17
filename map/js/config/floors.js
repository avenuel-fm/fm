/* ==========================================================================
   floors.js - 건물별(에비뉴엘, 백화점, 캐슬플라자) 메타데이터, 층별 SVG URL 및 크롭 좌표
   ========================================================================== */

var AVENUEL_CROP = {
    viewBox: '9280 3880 1950 2080',
    width: 1950,
    height: 2080,
    minX: 9280,
    maxX: 11230,
    minY: 3880,
    maxY: 5960
};

var B1_FULL_CROP = {
    viewBox: '8950 3600 3200 2000',
    width: 3200,
    height: 2000,
    minX: 8950,
    maxX: 12150,
    minY: 3600,
    maxY: 5600
};

var FULL_WORLD_VIEWBOX = '0 0 15500 7500';
function createFullWorldCrop(cx, cy) {
    return {
        viewBox: FULL_WORLD_VIEWBOX,
        width: 15500,
        height: 7500,
        minX: 0,
        maxX: 15500,
        minY: 0,
        maxY: 7500,
        centerX: cx,
        centerY: cy
    };
}

var BUILDINGS = {
    avenuel: {
        id: 'avenuel',
        name: '에비뉴엘',
        title: '에비뉴엘 맵',
        defaultFloorIdx: 5, // 1F
        floors: [
            { code: '6F', name: '6F', category: '프리미엄 F&B | 와인', id: 'ad66cce4-33bb-4f6a-aa2e-829cb6bb27a9', crop: AVENUEL_CROP },
            { code: '5F', name: '5F', category: '여성 컨템포러리', id: 'ee3449d8-b85f-480f-bdc8-de1159d0b45b', crop: AVENUEL_CROP },
            { code: '4F', name: '4F', category: '럭셔리 맨즈', id: 'b19073b5-cb21-46d4-aa69-0a45e786abd6', crop: AVENUEL_CROP },
            { code: '3F', name: '3F', category: '럭셔리 디자이너', id: 'b05f1fd3-793b-49b1-8f98-07f295f80720', crop: AVENUEL_CROP },
            { code: '2F', name: '2F', category: '워치 & 주얼리', id: 'b2abeb19-d654-4206-b1e7-a31014a6a558', crop: AVENUEL_CROP },
            { code: '1F', name: '1F', category: '럭셔리 부티크', id: 'd4854fe4-d6f8-4d4b-b97c-4da225e63a4f', crop: AVENUEL_CROP },
            { code: 'B1', name: 'B1', category: '에비뉴엘 & 쇼핑몰', id: 'ab51996e-71d9-46b6-8ad1-174567bde686', crop: B1_FULL_CROP }
        ]
    },
    dept: {
        id: 'dept',
        name: '백화점',
        title: '백화점 맵',
        defaultFloorIdx: 11, // 1F
        floors: [
            { code: '12', name: '12F', category: '문화센터', id: 'ce6085c2-fdb7-4408-ade4-e4b3d2baee09', crop: createFullWorldCrop(6880, 4700) },
            { code: '11', name: '11F', category: '레스토랑ㅣ금융센터', id: 'f86b9067-ba43-47c8-a496-35a5186024b3', crop: createFullWorldCrop(6400, 4300) },
            { code: '10', name: '10F', category: '가전/가구', id: 'b64a2d2d-197f-42e6-8c4f-e69dccded1b6', crop: createFullWorldCrop(6400, 4300) },
            { code: '09', name: '9F', category: '홈패션ㅣ주방식기ㅣ가구', id: 'e4242600-a41b-4598-9576-a98d534a650b', crop: createFullWorldCrop(6400, 4300) },
            { code: '08', name: '8F', category: '아동ㆍ유아ㅣ사은품증정', id: 'b7fb4c7c-dec0-498f-8d63-bbe451e71c66', crop: createFullWorldCrop(6200, 4300) },
            { code: '07', name: '7F', category: '스포츠ㅣ애슬레져', id: 'ece4007e-784c-4988-b8e1-67b147987426', crop: createFullWorldCrop(6400, 4300) },
            { code: '06', name: '6F', category: '골프ㅣ아웃도어', id: 'e78193dc-6903-4bb4-9443-5307b9825230', crop: createFullWorldCrop(6400, 4300) },
            { code: '05', name: '5F', category: '남성정장ㅣ컨템포러리ㅣ셔츠넥타이', id: 'c0307de4-ea68-45ae-8370-47485cee04b9', crop: createFullWorldCrop(6400, 4300) },
            { code: '04', name: '4F', category: '해외·여성의류ㅣ란제리ㅣ잡화', id: 'ba9ba614-816a-4bd0-bb17-1364790ff234', crop: createFullWorldCrop(6400, 4300) },
            { code: '03', name: '3F', category: '컨템포러리ㅣ여성캐주얼ㅣ핸드백', id: 'e1d0efa6-438a-4f49-a14c-e8cb41734d2e', crop: createFullWorldCrop(6400, 4300) },
            { code: '02', name: '2F', category: '무신사ㅣ캐릭터ㅣ진·영패션', id: 'c59cd832-d3bb-42c7-9186-045f0dd3eee7', crop: createFullWorldCrop(6200, 4300) },
            { code: '01', name: '1F', category: '명품잡화ㅣ화장품ㅣ시계&보석', id: 'c31b55e2-b1bf-42d4-bdc6-33b384aa6c75', crop: createFullWorldCrop(6690, 4510) },
            { code: 'B1', name: 'B1', category: '식품', id: 'fe648366-a16c-47c2-b961-f5cb2bdc1cdb', crop: createFullWorldCrop(6690, 4510) },
            { code: 'B2', name: 'B2', category: 'Parking Lot', id: 'b7a74ded-3304-4568-a606-5d221a898653', crop: createFullWorldCrop(1800, 4955) },
            { code: 'B3', name: 'B3', category: 'Parking Lot', id: 'c3317462-a2a2-4387-aafa-8bc79d73c6e0', crop: createFullWorldCrop(5000, 4322) },
            { code: 'B4', name: 'B4', category: 'Parking Lot', id: 'c2ef9745-c556-4bd7-9b05-d3bfd9930af3', crop: createFullWorldCrop(1355, 4980) }
        ]
    },
    castle: {
        id: 'castle',
        name: '캐슬플라자',
        title: '캐슬플라자 맵',
        defaultFloorIdx: 1, // 1F
        floors: [
            { code: '02', name: '2F', category: '레스토랑', id: 'a978e5b0-f474-4550-b279-ec36b82f32bc', crop: createFullWorldCrop(10510, 1500) },
            { code: '01', name: '1F', category: 'F&Bㅣ기타', id: 'dcae6ddc-bfb8-49ac-a830-a90b6fb6934b', crop: createFullWorldCrop(10510, 1500) },
            { code: 'B1', name: 'B1', category: '푸드마켓ㅣ교보문고ㅣF&B', id: 'adda47f6-f02a-4a88-a081-71d260b258e6', crop: createFullWorldCrop(10510, 1500) }
        ]
    }
};

function detectCurrentBuildingId() {
    if (typeof window.CURRENT_BUILDING === 'string' && BUILDINGS[window.CURRENT_BUILDING]) {
        return window.CURRENT_BUILDING;
    }
    try {
        const params = new URLSearchParams(window.location.search);
        const b = params.get('building');
        if (b && BUILDINGS[b]) return b;
    } catch (e) {}

    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('dept')) return 'dept';
    if (path.includes('castle')) return 'castle';
    return 'avenuel';
}

var currentBuildingId = detectCurrentBuildingId();
var currentBuilding = BUILDINGS[currentBuildingId];
var FLOORS = currentBuilding.floors;
var currentFloorIdx = currentBuilding.defaultFloorIdx;

var svgCache = new Map();
var currentStores = [];
var activeSelectedStore = null;

// '월드타워', B1 '서울스카이', 및 '건물 외벽' 판별 (클릭 반응 및 모달, 수정/삭제 완전 차단)
function isImmutableStore(name) {
    if (!name) return false;
    const clean = name.replace(/\s+/g, '').toLowerCase();
    return clean.includes('월드타워') || clean.includes('서울스카이') || clean.includes('건물외벽') || clean.includes('외벽');
}

// 저장된 SVG 도면 로컬스토리지 키 (건물별 분리)
function getSavedSvgStorageKey(floorCode) {
    const bId = (typeof currentBuildingId !== 'undefined' && currentBuildingId !== 'avenuel') ? `_${currentBuildingId}` : '';
    return `lotte_saved_svg_${floorCode}${bId}`;
}

// 업체 바탕 도면 보관 칸 (지도 기록, 결정 132) — Supabase map_hist 에만 있음
function getBaseSvgStorageKey(floorCode) {
    const bId = (typeof currentBuildingId !== 'undefined' && currentBuildingId !== 'avenuel') ? `_${currentBuildingId}` : '';
    return `lotte_base_svg_${floorCode}${bId}`;
}

// 건물 전환 함수 (메인보드 대시보드 연동)
function switchCurrentBuilding(buildingId, keepFloorCode = null) {
    if (!BUILDINGS[buildingId]) return;
    currentBuildingId = buildingId;
    currentBuilding = BUILDINGS[buildingId];
    FLOORS = currentBuilding.floors;
    if (typeof svgCache !== 'undefined' && svgCache.clear) {
        svgCache.clear();
    }

    // 헤더 타이틀 반영
    const mainTitleEl = document.querySelector('.main-title');
    if (mainTitleEl) mainTitleEl.textContent = currentBuilding.title;

    // 층 결정
    if (keepFloorCode) {
        const matchIdx = FLOORS.findIndex(f => f.code === keepFloorCode);
        currentFloorIdx = matchIdx >= 0 ? matchIdx : currentBuilding.defaultFloorIdx;
    } else {
        currentFloorIdx = currentBuilding.defaultFloorIdx;
    }

    // 메인보드 탭 활성화 UI 동기화
    document.querySelectorAll('.mainboard-building-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-building') === buildingId);
    });

    // 도면 로드 및 층 버튼/패널 갱신
    if (typeof renderFloorList === 'function') renderFloorList();
    if (typeof updateFloorNavButtons === 'function') updateFloorNavButtons();
    if (typeof selectFloor === 'function') {
        selectFloor(currentFloorIdx);
    } else if (typeof loadFloorMap === 'function') {
        loadFloorMap(currentFloorIdx, false);
    }
}
