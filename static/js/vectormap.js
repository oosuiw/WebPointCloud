/* ═══════════════════════════════════════════════════════
   VectorMapLayer — Lanelet2 OSM 레이어 (Three.js LineSegments)
   ═══════════════════════════════════════════════════════ */
import * as THREE from 'three';

const LINE_COLOR = 0xf0c040;   // 노란색 계열

export class VectorMapLayer {
    constructor(scene) {
        this.scene      = scene;
        this._mesh      = null;
        this._key       = null;
        this._pollTimer = null;
        this._visible   = true;
        this._zOffset   = 0.0;
    }

    get isLoaded() { return this._mesh !== null; }
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

        const segCount  = parseInt(binResp.headers.get('X-Seg-Count') || '0');
        const buf       = await binResp.arrayBuffer();
        const positions = new Float32Array(buf, 0, segCount * 6);

        this._buildMesh(positions, segCount);
        onDone?.(segCount);
    }

    // ── Three.js 메시 구성 ──────────────────────────────
    _buildMesh(positions, segCount) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat  = new THREE.LineBasicMaterial({ color: LINE_COLOR });
        const mesh = new THREE.LineSegments(geom, mat);
        mesh.name     = 'vectormap';
        mesh.visible  = this._visible;
        mesh.position.z = this._zOffset;

        this._mesh = mesh;
        this.scene.add(mesh);
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
        if (this._mesh) this._mesh.visible = show;
    }

    setZOffset(z) {
        this._zOffset = z;
        if (this._mesh) this._mesh.position.z = z;
    }

    // ── 해제 ────────────────────────────────────────────
    clear() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        if (this._mesh) {
            this.scene.remove(this._mesh);
            this._mesh.geometry.dispose();
            this._mesh.material.dispose();
            this._mesh = null;
        }
        if (this._key) {
            fetch(`/api/vectormap/clear/${this._key}`, { method: 'DELETE' }).catch(() => {});
            this._key = null;
        }
    }
}
