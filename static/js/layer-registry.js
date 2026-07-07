/* ═══════════════════════════════════════════════════════
   Layer Registry — 로드된 PCD/OSM 레이어 목록의 단일 소스.
   ui-files.js / ui-vectormap.js가 등록/해제하고, ui-layers.js가 구독해
   사이드바 목록을 렌더링한다.
   ═══════════════════════════════════════════════════════ */

const layers = new Map();   // id → entry
const listeners = new Set();

/**
 * @param {Object} entry
 * @param {string|object} entry.id       - 고유 키 (문자열 또는 객체 참조)
 * @param {'pcd'|'vmap'} entry.type
 * @param {string} entry.name            - 표시 이름 (파일명)
 * @param {string} [entry.meta]          - 부가 정보 (포인트 수, seg 수 등)
 * @param {() => import('three').Object3D} entry.getObject3D
 * @param {(show: boolean) => void} entry.setVisible
 * @param {() => void} entry.remove      - 씬/뷰어에서 실제로 제거하는 콜백
 */
function upsertLayer(entry) {
    layers.set(entry.id, { visible: true, ...entry });
    _notify();
}

function removeLayer(id) {
    layers.delete(id);
    _notify();
}

function getLayers() {
    return Array.from(layers.values());
}

function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function _notify() {
    for (const cb of listeners) cb(getLayers());
}

export const layerRegistry = { upsertLayer, removeLayer, getLayers, onChange };
