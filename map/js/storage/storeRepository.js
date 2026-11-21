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

        // 매장 대장: 층마다 고유번호·이름·상세내역 (결정 154)
        function getStoreBookKey(floorCode) {
            return `lotte_store_book_${floorCode}${getBuildingStorageSuffix()}`;
        }
        function getStoreBook(floorCode) {
            return StoreBook.parseBook(mapStore.getItem(getStoreBookKey(floorCode)));
        }
        function saveStoreBook(floorCode, book) {
            mapStore.setItem(getStoreBookKey(floorCode), JSON.stringify(book));
        }
        function getStoreItems() {
            try {
                const raw = mapStore.getItem(`lotte_store_items${getBuildingStorageSuffix()}`);
                return raw ? StoreBook.fixItems(JSON.parse(raw)) : StoreBook.DEFAULT_ITEMS.slice();
            } catch (e) {
                return StoreBook.DEFAULT_ITEMS.slice();
            }
        }
        function saveStoreItems(items) {
            mapStore.setItem(`lotte_store_items${getBuildingStorageSuffix()}`, JSON.stringify(items));
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
