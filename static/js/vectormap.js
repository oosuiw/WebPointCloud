/* ═══════════════════════════════════════════════════════
   VectorMapLayer — Lanelet2 OSM 레이어 (Three.js LineSegments)
   ═══════════════════════════════════════════════════════ */
import * as THREE from 'three';

// 연도별 기본 색상
const YEAR_META = [
    { label: '2024', color: 0xf0883e },   // 주황
    { label: '2020', color: 0x3fb950 },   // 녹색
    { label: '2019', color: 0x58a6ff },   // 파랑
];

export class VectorMapLayer {
    constructor(scene) {
        this.scene      = scene;
        this._group     = null;
        this._key       = null;
        this._pollTimer = null;
        this._visible   = true;
        this._yearVis   = [true, true, true];
        this._zOffset   = 0.0;
    }

    get isLoaded() { return this._group !== null; }
    get key()      { return this._key; }

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
        } catch (e) {
            onError?.(e); return;
        }
        if (json.error) { onError?.(new Error(json.error)); return; }
        this._key = json.key;

        // 2) polling
        if (json.status !== 'ready') {
            try {
                await this._poll(onProgress);
            } catch (e) {
                onError?.(e); return;
            }
        }

        // 3) binary 수신
        const [ox, oy] = coordOffset ? [coordOffset[0], coordOffset[1]] : [0, 0];
        let binResp;
        try {
            binResp = await fetch(`/api/vectormap/data/${this._key}?ox=${ox}&oy=${oy}`);
            if (!binResp.ok) throw new Error(`데이터 수신 실패 (${binResp.status})`);
        } catch (e) {
            onError?.(e); return;
        }

        const segCount = parseInt(binResp.headers.get('X-Seg-Count') || '0');
        const buf      = await binResp.arrayBuffer();
        const posBytes = segCount * 6 * 4;
        const positions = new Float32Array(buf, 0, segCount * 6);
        const years     = new Uint8Array(buf, posBytes, segCount);

        this._buildMesh(positions, years, segCount);
        onDone?.(segCount);
    }

    // ── Three.js 메시 구성 ──────────────────────────────
    _buildMesh(positions, years, segCount) {
        const group = new THREE.Group();
        group.name = 'vectormap';
        group.position.z = this._zOffset;

        // 연도별 분리
        const buckets = [[], [], []];
        for (let i = 0; i < segCount; i++) buckets[years[i]].push(i);

        for (let y = 0; y < 3; y++) {
            const idxs = buckets[y];
            if (!idxs.length) continue;

            const pos = new Float32Array(idxs.length * 6);
            for (let i = 0; i < idxs.length; i++) {
                const src = idxs[i] * 6;
                pos.set(positions.subarray(src, src + 6), i * 6);
            }
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            const mat  = new THREE.LineBasicMaterial({ color: YEAR_META[y].color });
            const mesh = new THREE.LineSegments(geom, mat);
            mesh.name    = `vmap_${YEAR_META[y].label}`;
            mesh.visible = this._yearVis[y] && this._visible;
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
                    if (s.status === 'ready')       { clearInterval(this._pollTimer); resolve(); }
                    else if (s.status === 'error')  { clearInterval(this._pollTimer); reject(new Error(s.message)); }
                } catch (e) { clearInterval(this._pollTimer); reject(e); }
            }, 800);
        });
    }

    // ── 가시성 / 스타일 제어 ────────────────────────────
    setVisible(show) {
        this._visible = show;
        if (this._group) this._group.visible = show;
    }

    setYearVisible(yearIdx, show) {
        this._yearVis[yearIdx] = show;
        if (!this._group) return;
        const child = this._group.getObjectByName(`vmap_${YEAR_META[yearIdx].label}`);
        if (child) child.visible = show && this._visible;
    }

    setColor(yearIdx, hex) {
        if (!this._group) return;
        const child = this._group.getObjectByName(`vmap_${YEAR_META[yearIdx].label}`);
        if (child) child.material.color.set(hex);
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
