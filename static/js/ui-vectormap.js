/* ═══════════════════════════════════════════════════════
   Vector Map UI — 파일 선택 + 레이어 컨트롤
   ═══════════════════════════════════════════════════════ */
import { showToast } from './ui-notifications.js';
import { appendLog } from './ui-panels.js';

const $ = id => document.getElementById(id);

export function initVectorMapUI(viewer) {
    const progressWrap = $('vmap-progress-wrap');
    const progressFill = $('vmap-progress-fill');
    const progressMsg  = $('vmap-progress-msg');
    const statusBadge  = $('vmap-status-badge');

    // ── Load Vector Map 버튼 → 파일 선택 다이얼로그 ──
    $('btn-vmap-open')?.addEventListener('click', () => $('vmap-file-input').click());
    $('vmap-file-input')?.addEventListener('change', e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        uploadAndLoad(file);
    });

    async function uploadAndLoad(file) {
        setStatus('업로드 중...', 'parsing');
        setProgress(5, '파일 업로드 중...');
        appendLog(`Vector Map 로드: ${file.name}`, 'info');

        const formData = new FormData();
        formData.append('file', file);

        let json;
        try {
            const resp = await fetch('/api/vectormap/load', { method: 'POST', body: formData });
            json = await resp.json();
        } catch (e) {
            setStatus('오류', 'error');
            setProgress(0, '');
            showToast(`업로드 실패: ${e.message}`, 'error');
            return;
        }
        if (json.error) {
            setStatus('오류', 'error');
            setProgress(0, '');
            showToast(`오류: ${json.error}`, 'error');
            return;
        }

        viewer.loadVectorMap(null, {
            _key: json.key,
            _status: json.status,
            onProgress(pct, msg) { setProgress(pct, msg); },
            onDone(segCount) {
                setProgress(0, '');
                setStatus(`${segCount.toLocaleString()} segs`, 'ready');
                showToast(`Vector Map 로드 완료 — ${segCount.toLocaleString()} 세그먼트`, 'success');
                appendLog(`Vector Map 완료 — ${segCount.toLocaleString()} segs`, 'info');
            },
            onError(e) {
                setProgress(0, '');
                setStatus('오류', 'error');
                showToast(`Vector Map 오류: ${e.message}`, 'error');
                appendLog(`Vector Map 오류: ${e.message}`, 'error');
            },
        });
    }

    // ── Clear ──────────────────────────────────────────
    $('btn-vmap-clear')?.addEventListener('click', () => {
        viewer.clearVectorMap();
        setStatus('', '');
        setProgress(0, '');
        showToast('Vector Map 제거됨', 'info');
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
