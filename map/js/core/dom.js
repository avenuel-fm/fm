/* ==========================================================================
   dom.js - 전역 DOM 레지스트리 및 공통 알림(Toast)
   ========================================================================== */

var viewport = document.getElementById('viewport');
var mapContainer = document.getElementById('map-container');
var loading = document.getElementById('loading');
var loadingMsg = document.getElementById('loading-msg');
var floorIndicator = document.getElementById('current-floor-indicator');
var floorPanel = document.getElementById('floor-panel');
var floorListContainer = document.getElementById('floor-list-container');
var btnMapFloor = document.getElementById('btn-map-floor');
var btnMapStore = document.getElementById('btn-map-store');
var btnMapUtility = document.getElementById('btn-map-utility');
var btnEditMenu = document.getElementById('btn-edit-menu');
var editDropdownMenu = document.getElementById('edit-dropdown-menu');
var btnToggleFloor = btnMapFloor;
var btnToggleStore = btnMapStore;

var btnAddStore = document.getElementById('menu-item-store');
var btnAddZone = document.getElementById('menu-item-zone');
var storePanel = document.getElementById('store-panel');
var storeListContainer = document.getElementById('store-list-container');
var storeTotalCount = document.getElementById('store-total-count');
var btnUndo = document.getElementById('btn-undo');
var drawingGuideBanner = document.getElementById('drawing-guide-banner');
var zoneGuideBanner = document.getElementById('zone-guide-banner');
var zoneModal = document.getElementById('zone-modal');

var modalOverlay = document.getElementById('modal-overlay');
var statusModal = document.getElementById('status-modal');
var statusBadge = document.getElementById('status-badge');
var statusStoreName = document.getElementById('status-store-name');
var statusFacilityTable = document.getElementById('status-facility-table');
var btnStatusEdit = document.getElementById('btn-status-edit');

var editModal = document.getElementById('edit-modal');
var editBadge = document.getElementById('edit-badge');
var editModalTitle = document.getElementById('edit-modal-title');
var editNameLabel = document.getElementById('edit-name-label');
var editNameInput = document.getElementById('edit-name');
var tabTypeStore = document.getElementById('tab-type-store');
var tabTypeUtility = document.getElementById('tab-type-utility');
var dynamicFieldsList = document.getElementById('dynamic-fields-list');
var editColorPicker = document.getElementById('edit-color-picker');
var btnPopoverDelete = document.getElementById('btn-popover-delete');
var toastEl = document.getElementById('toast');

var toastTimer = null;

        function showToast(msg, duration = 1500) {
            if (toastTimer) {
                clearTimeout(toastTimer);
                toastTimer = null;
            }
            toastEl.textContent = msg;
            toastEl.classList.remove('has-btn');
            toastEl.classList.add('show');
            toastTimer = setTimeout(() => {
                toastEl.classList.remove('show');
                toastTimer = null;
            }, duration);
        }

        // 버튼 하나 붙은 알림 (결정 322)
        function showToastAction(msg, label, fn, duration = 6000) {
            showToast(msg, duration);
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'toast-btn'; b.textContent = label;
            b.onclick = () => { toastEl.classList.remove('show', 'has-btn'); fn(); };
            toastEl.appendChild(b);
            toastEl.classList.add('has-btn');
        }
