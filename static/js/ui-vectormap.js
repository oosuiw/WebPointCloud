/* ═══════════════════════════════════════════════════════
   Vector Map UI 이벤트 핸들러
   ═══════════════════════════════════════════════════════ */
import { showToast, appendLog } from './ui.js';

const $ = id => document.getElementById(id);

export function initVectorMapUI(viewer) {
    const pathInput   = $('vmap-path');
    const btnLoad     = $('btn-vmap-load');
    const btnClear    = $('btn-vmap-clear');
    const progressWrap = $('vmap-progress-wrap');
    const progressFill = $('vmap-progress-fill');
    const progressMsg  = $('vmap-progress-msg');
    const statusBadge  = $('vmap-status-badge');

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

    // ── 로드 버튼 ──────────────────────────────────────
    btnLoad?.addEventListener('click', () => {
        const path = pathInput?.value.trim();
        if (!path) { showToast('OSM 파일 경로를 입력하세요', 'warning'); return; }

        btnLoad.disabled = true;
        setStatus('파싱 중...', 'parsing');
        setProgress(5, '파싱 요청 중...');
        appendLog(`VectorMap 로드: ${path}`, 'info');

        viewer.loadVectorMap(path, {
            onProgress(pct, msg) { setProgress(pct, msg); },
            onDone(segCount) {
                setProgress(0, '');
                setStatus(`${segCount.toLocaleString()} segs`, 'ready');
                btnLoad.disabled = false;
                showToast(`VectorMap 로드 완료 — ${segCount.toLocaleString()} 세그먼트`, 'success');
                appendLog(`VectorMap 로드 완료 — ${segCount.toLocaleString()} 세그먼트`, 'info');
            },
            onError(e) {
                setProgress(0, '');
                setStatus('오류', 'error');
                btnLoad.disabled = false;
                showToast(`VectorMap 오류: ${e.message}`, 'error');
                appendLog(`VectorMap 오류: ${e.message}`, 'error');
            },
        });
    });

    // Enter 키
    pathInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') btnLoad?.click();
    });

    // ── Clear ──────────────────────────────────────────
    btnClear?.addEventListener('click', () => {
        viewer.clearVectorMap();
        setStatus('', '');
        setProgress(0, '');
        showToast('VectorMap 제거됨', 'info');
    });

    // ── 전체 토글 ──────────────────────────────────────
    $('ckb-vmap-layer')?.addEventListener('change', e => {
        viewer.toggleLayer('vectormap', e.target.checked);
    });

    // ── 연도별 토글 ────────────────────────────────────
    [['ckb-vmap-2024', 0], ['ckb-vmap-2020', 1], ['ckb-vmap-2019', 2]].forEach(([id, idx]) => {
        $(id)?.addEventListener('change', e => {
            viewer.setVectorMapYearVisible(idx, e.target.checked);
        });
    });

    // ── Z 오프셋 ───────────────────────────────────────
    $('vmap-z-offset')?.addEventListener('change', e => {
        viewer.setVectorMapZOffset(parseFloat(e.target.value) || 0);
    });
}
