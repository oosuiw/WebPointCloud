/* ═══════════════════════════════════════════════════════
   Vector Map UI — 다중 레이어 로드 + 레이어 목록 컨트롤
   ═══════════════════════════════════════════════════════ */
import { showToast } from './ui-notifications.js';
import { appendLog } from './ui-panels.js';

const $ = id => document.getElementById(id);

export function initVectorMapUI(viewer) {
    const progressWrap = $('vmap-progress-wrap');
    const progressFill = $('vmap-progress-fill');
    const progressMsg  = $('vmap-progress-msg');
    const statusBadge  = $('vmap-status-badge');
    const layerList    = $('vmap-layer-list');

    // ── Load Vector Map 버튼 → 파일 선택 (multiple) ──
    $('btn-vmap-open')?.addEventListener('click', () => $('vmap-file-input').click());
    $('vmap-file-input')?.addEventListener('change', e => {
        const files = Array.from(e.target.files);
        e.target.value = '';
        files.forEach(f => uploadAndLoad(f));
    });

    async function uploadAndLoad(file) {
        appendLog(`Vector Map 로드: ${file.name}`, 'info');
        setProgress(5, `${file.name} 업로드 중...`);

        const formData = new FormData();
        formData.append('file', file);

        let json;
        try {
            const resp = await fetch('/api/vectormap/load', { method: 'POST', body: formData });
            json = await resp.json();
        } catch (e) {
            setProgress(0, '');
            showToast(`업로드 실패: ${e.message}`, 'error');
            return;
        }
        if (json.error) {
            setProgress(0, '');
            showToast(`오류: ${json.error}`, 'error');
            return;
        }

        // 목록에 로딩 중 항목 추가
        const item = addLayerItem(file.name, null);

        viewer.loadVectorMap(null, {
            _key: json.key,
            _status: json.status,
            onProgress(pct, msg) { setProgress(pct, msg || `${file.name} 파싱 중...`); },
            onDone(segCount, layer) {
                setProgress(0, '');
                setStatus(`${viewer.vmapLayers.length}개 레이어`, 'ready');
                item.dataset.ready = '1';
                item.querySelector('.vmap-item-meta').textContent = `${segCount.toLocaleString()} segs`;
                item._layer = layer;
                item.querySelector('.vmap-item-remove').addEventListener('click', () => {
                    viewer.removeVectorMap(layer);
                    item.remove();
                    updateStatus();
                });
                showToast(`${file.name} 로드 완료 (${segCount.toLocaleString()} segs)`, 'success');
                appendLog(`Vector Map 완료 — ${file.name} (${segCount.toLocaleString()} segs)`, 'info');
            },
            onError(e) {
                setProgress(0, '');
                item.remove();
                showToast(`${file.name} 오류: ${e.message}`, 'error');
                appendLog(`Vector Map 오류: ${file.name} — ${e.message}`, 'error');
            },
        });
    }

    function addLayerItem(name, layer) {
        const item = document.createElement('div');
        item.className = 'vmap-layer-item';
        item.innerHTML = `
            <span class="vmap-item-name" title="${name}">${name}</span>
            <span class="vmap-item-meta">로딩 중...</span>
            <button class="vmap-item-remove" title="제거">✕</button>`;
        layerList?.appendChild(item);
        return item;
    }

    function updateStatus() {
        const n = viewer.vmapLayers.length;
        if (n === 0) setStatus('', '');
        else setStatus(`${n}개 레이어`, 'ready');
    }

    // ── Clear All ──────────────────────────────────────
    $('btn-vmap-clear')?.addEventListener('click', () => {
        viewer.clearVectorMap();
        if (layerList) layerList.innerHTML = '';
        setStatus('', '');
        setProgress(0, '');
        showToast('Vector Map 전체 제거됨', 'info');
    });

    // ── 레이어 토글 ────────────────────────────────────
    $('ckb-vmap-layer')?.addEventListener('change', e => {
        viewer.toggleLayer('vectormap', e.target.checked);
    });

    $('vmap-z-offset')?.addEventListener('change', e => {
        viewer.setVectorMapZOffset(parseFloat(e.target.value) || 0);
    });

    // ── 헬퍼 ──────────────────────────────────────────
    function setProgress(pct, msg) {
        if (progressWrap) progressWrap.style.display = pct > 0 ? 'block' : 'none';
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressMsg)  progressMsg.textContent   = msg;
    }
    function setStatus(text, cls = '') {
        if (!statusBadge) return;
        statusBadge.textContent = text;
        statusBadge.className   = `vmap-badge ${cls}`;
    }
}
