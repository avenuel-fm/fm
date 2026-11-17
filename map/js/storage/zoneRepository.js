/* ==========================================================================
   zoneRepository.js - 방화구역 / 제연구획 로컬 저장소
   ========================================================================== */

        // 구역(방화구역/제연구획 선 및 면) 저장소
        function getZonesStorageKey(floorCode) {
            const bId = (typeof currentBuildingId !== 'undefined' && currentBuildingId !== 'avenuel') ? `_${currentBuildingId}` : '';
            return `lotte_floor_zones_${floorCode}${bId}`;
        }
        function getFloorZones(floorCode) {
            try {
                const raw = mapStore.getItem(getZonesStorageKey(floorCode));
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        }
        function saveFloorZones(floorCode, list) {
            try {
                mapStore.setItem(getZonesStorageKey(floorCode), JSON.stringify(list));
            } catch (e) {
                console.error('Failed to save floor zones', e);
            }
        }