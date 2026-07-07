/* ═══════════════════════════════════════════════════════
   VectorMapLayer — Lanelet2 OSM (tier4 스타일 타입별 색상)
   ═══════════════════════════════════════════════════════ */
import * as THREE from 'three';

// type 코드 → 색상 (api.py _VTYPE_MAP과 동기화)
const TYPE_META = [
    { label: 'lane',    color: 0xe8e8e8 },  // 0: 차선 경계 (흰색)
    { label: 'virtual', color: 0x4488ff },  // 1: 가상 경계 (파랑)
    { label: 'border',  color: 0x888888 },  // 2: 도로 경계 (회색)
    { label: 'stop',    color: 0xff4444 },  // 3: 정지선 (빨강)
    { label: 'curb',    color: 0x555555 },  // 4: 연석/가드레일 (짙은 회색)
];

export class VectorMapLayer {
    constructor(scene) {
        this.scene      = scene;
        this._group     = null;
        this._key       = null;
        this._pollTimer = null;
        this._visible   = true;
        this._zOffset   = 0.0;
    }

    get isLoaded() { return this._group !== null; }

    // ── 로드 ────────────────────────────────────────────
    async load(osmPath, coordOffset, { onProgress, onDone, onError } = {}) {
        this.clear();

        // 1) 파싱 요청
        let resp, json;
        try {
            resp = await fetch('/api/vectormap/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: osmPath }),
            });
            json = await resp.json();
        } catch (e) { onError?.(e); return; }
        if (json.error) { onError?.(new Error(json.error)); return; }
        this._key = json.key;

        // 2) polling
        if (json.status !== 'ready') {
            try { await this._poll(onProgress); }
            catch (e) { onError?.(e); return; }
        }

        // 3) binary 수신
        // coordOffset이 없으면 파라미터를 생략 → 서버가 벡터맵 자체 중심 사용
        let dataUrl = `/api/vectormap/data/${this._key}`;
        if (coordOffset) {
            dataUrl += `?ox=${coordOffset[0]}&oy=${coordOffset[1]}`;
        }
        let binResp;
        try {
            binResp = await fetch(dataUrl);
            if (!binResp.ok) throw new Error(`데이터 수신 실패 (${binResp.status})`);
        } catch (e) { onError?.(e); return; }

        const segCount  = parseInt(binResp.headers.get('X-Seg-Count') || '0');
        const buf       = await binResp.arrayBuffer();
        const posBytes  = segCount * 6 * 4;
        const positions = new Float32Array(buf, 0, segCount * 6);
        const types     = new Uint8Array(buf, posBytes, segCount);

        this._buildMesh(positions, types, segCount);
        onDone?.(segCount);
    }

    // ── Three.js 메시 구성 — 타입별 LineSegments ────────
    _buildMesh(positions, types, segCount) {
        const group = new THREE.Group();
        group.name = 'vectormap';
        group.position.z = this._zOffset;

        // 타입별 버킷
        const buckets = TYPE_META.map(() => []);
        for (let i = 0; i < segCount; i++) {
            const t = types[i] < TYPE_META.length ? types[i] : 0;
            buckets[t].push(i);
        }

        for (let t = 0; t < TYPE_META.length; t++) {
            const idxs = buckets[t];
            if (!idxs.length) continue;

            const pos = new Float32Array(idxs.length * 6);
            for (let i = 0; i < idxs.length; i++) {
                const src = idxs[i] * 6;
                pos.set(positions.subarray(src, src + 6), i * 6);
            }
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            const mat  = new THREE.LineBasicMaterial({
                color: TYPE_META[t].color,
                opacity: t === 1 ? 0.5 : 1.0,   // virtual은 반투명
                transparent: t === 1,
            });
            const mesh = new THREE.LineSegments(geom, mat);
            mesh.name    = `vmap_${TYPE_META[t].label}`;
            mesh.visible = this._visible;
            group.add(mesh);
        }

        this._group = group;
        this.scene.add(group);
    }

    // ── polling ──────────────────────────────────────────
    _poll(onProgress) {
        return new Promise((resolve, reject) => {
            this._pollTimer = setInterval(async () => {
                try {
                    const r = await fetch(`/api/vectormap/status/${this._key}`);
                    const s = await r.json();
                    onProgress?.(s.progress ?? 0, s.message ?? '');
                    if (s.status === 'ready')      { clearInterval(this._pollTimer); resolve(); }
                    else if (s.status === 'error') { clearInterval(this._pollTimer); reject(new Error(s.message)); }
                } catch (e) { clearInterval(this._pollTimer); reject(e); }
            }, 800);
        });
    }

    // ── 가시성 / 스타일 제어 ────────────────────────────
    setVisible(show) {
        this._visible = show;
        if (this._group) this._group.visible = show;
    }

    setZOffset(z) {
        this._zOffset = z;
        if (this._group) this._group.position.z = z;
    }

    // ── 해제 ────────────────────────────────────────────
    clear() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        if (this._group) {
            this.scene.remove(this._group);
            this._group.traverse(c => {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
            });
            this._group = null;
        }
        if (this._key) {
            fetch(`/api/vectormap/clear/${this._key}`, { method: 'DELETE' }).catch(() => {});
            this._key = null;
        }
    }
}
