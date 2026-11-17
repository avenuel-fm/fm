/* ==========================================================================
   storeRepository.js - 매장/기능실 시설사양, 삭제/이름변경/커스텀/바닥영역 로컬 저장소
   ========================================================================== */

        function getBuildingStorageSuffix() {
            return (typeof currentBuildingId !== 'undefined' && currentBuildingId !== 'avenuel') ? `_${currentBuildingId}` : '';
        }

        function getSpecsStorageKey(floorCode) {
            return `lotte_facility_specs_${floorCode}${getBuildingStorageSuffix()}`;
        }
        function getDeletedStorageKey(floorCode) {
            return `lotte_deleted_stores_${floorCode}${getBuildingStorageSuffix()}`;
        }
        function getRenamedStorageKey(floorCode) {
            return `lotte_renamed_stores_${floorCode}${getBuildingStorageSuffix()}`;
        }
        function getCustomStorageKey(floorCode) {
            return `lotte_custom_stores_${floorCode}${getBuildingStorageSuffix()}`;
        }

        function getStoredSpecs(floorCode) {
            try {
                const raw = mapStore.getItem(getSpecsStorageKey(floorCode));
                return raw ? JSON.parse(raw) : {};
            } catch (e) {
                return {};
            }
        }

        function saveStoredSpecs(floorCode, specsObj) {
            try {
                mapStore.setItem(getSpecsStorageKey(floorCode), JSON.stringify(specsObj));
            } catch (e) {
                console.error('Failed to save specs', e);
            }
        }

        function getDeletedStores(floorCode) {
            try {
                const raw = mapStore.getItem(getDeletedStorageKey(floorCode));
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        }

        function saveDeletedStores(floorCode, list) {
            try {
                mapStore.setItem(getDeletedStorageKey(floorCode), JSON.stringify(list));
            } catch (e) {
                console.error('Failed to save deleted stores', e);
            }
        }

        function getRenamedStores(floorCode) {
            try {
                const raw = mapStore.getItem(getRenamedStorageKey(floorCode));
                return raw ? JSON.parse(raw) : {};
            } catch (e) {
                return {};
            }
        }

        function saveRenamedStores(floorCode, map) {
            try {
                mapStore.setItem(getRenamedStorageKey(floorCode), JSON.stringify(map));
            } catch (e) {
                console.error('Failed to save renamed stores', e);
            }
        }

        function getCustomStores(floorCode) {
            try {
                const raw = mapStore.getItem(getCustomStorageKey(floorCode));
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        }

        function saveCustomStores(floorCode, list) {
            try {
                mapStore.setItem(getCustomStorageKey(floorCode), JSON.stringify(list));
            } catch (e) {
                console.error('Failed to save custom stores', e);
            }
        }

        // 삭제된 도형(흰색 바닥 영역) 저장소
        function getVacantStorageKey(floorCode) {
            return `lotte_vacant_polygons_${floorCode}${getBuildingStorageSuffix()}`;
        }
        function getVacantPolygons(floorCode) {
            try {
                const raw = mapStore.getItem(getVacantStorageKey(floorCode));
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        }
        function saveVacantPolygons(floorCode, list) {
            try {
                mapStore.setItem(getVacantStorageKey(floorCode), JSON.stringify(list));
            } catch (e) {
                console.error('Failed to save vacant polygons', e);
            }
        }


        // 시설 기본 데이터 생성 (차단기, 수도배관, 가스등급)
        function generateDefaultSpecs(name, floorCode) {
            const lower = name.toLowerCase();
            if (floorCode === '6F' || lower.includes('카페') || lower.includes('cafe') || lower.includes('버거') || lower.includes('식당') || lower.includes('엔제리너스') || lower.includes('고든램지') || lower.includes('바샤') || lower.includes('노아스') || lower.includes('바틸') || lower.includes('고디바') || lower.includes('와인')) {
                return { breaker: '3P 100A', plumbing: '급수 25A / 배수 75A', gas: '16등급' };
            }
            if (lower.includes('뷰티') || lower.includes('코스메틱') || lower.includes('디올') || lower.includes('샤넬') || lower.includes('향수') || lower.includes('크리드') || lower.includes('헤라') || lower.includes('입생로랑') || lower.includes('조르지오') || lower.includes('조말론') || lower.includes('딥티크') || lower.includes('톰포드')) {
                return { breaker: '3P 50A', plumbing: '급수 15A', gas: '미사용' };
            }
            if (floorCode === '2F' || lower.includes('롤렉스') || lower.includes('까르띠에') || lower.includes('티파니') || lower.includes('불가리') || lower.includes('반클리프') || lower.includes('쇼메') || lower.includes('워치') || lower.includes('주얼리')) {
                return { breaker: '3P 75A', plumbing: '미사용', gas: '미사용' };
            }
            return { breaker: '3P 50A', plumbing: '미사용', gas: '미사용' };
        }