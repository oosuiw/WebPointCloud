/* ═══════════════════════════════════════════════════════
   Vector Map UI — 파일 브라우저 모달 + 레이어 컨트롤
   ═══════════════════════════════════════════════════════ */
import { showToast, appendLog } from './ui.js';

const $ = id => document.getElementById(id);

export function initVectorMapUI(viewer) {
    const modal        = $('modal-vmap');
    const fileList     = $('vmap-file-list');
    const breadcrumb   = $('vmap-breadcrumb');
    const progressWrap = $('vmap-progress-wrap');
    const progressFill = $('vmap-progress-fill');
    const progressMsg  = $('vmap-progress-msg');
    const statusBadge  = $('vmap-status-badge');

    let currentDir = null;

    // ── 모달 열기/닫기 ─────────────────────────────────
    function openModal() {
        modal.classList.add('open');
        browse(currentDir || null);
    }
    function closeModal() { modal.classList.remove('open'); }

    $('btn-vmap-open')?.addEventListener('click', openModal);
    $('btn-vmap-modal-close')?.addEventListener('click', closeModal);
    modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    // ── 디렉토리 브라우저 ────────────────────────────────
    async function browse(dir) {
        fileList.innerHTML = '<div style="color:var(--text-dim);padding:12px">로딩 중...</div>';
        const url = dir ? `/api/vectormap/browse?dir=${encodeURIComponent(dir)}` : '/api/vectormap/browse';
        try {
            const resp = await fetch(url);
            const data = await resp.json();
            if (data.error) { fileList.innerHTML = `<div style="color:var(--danger)">${data.error}</div>`; return; }
            currentDir = data.dir;
            renderBreadcrumb(data.dir, data.parent);
            renderEntries(data.entries, data.parent);
        } catch (e) {
            fileList.innerHTML = `<div style="color:var(--danger)">오류: ${e.message}</div>`;
        }
    }

    function renderBreadcrumb(dir, parent) {
        breadcrumb.innerHTML = '';
        // 상위 폴더 버튼
        if (parent) {
            const up = document.createElement('button');
            up.className = 'btn btn-sm';
            up.textContent = '↑ 상위 폴더';
            up.style.marginRight = '8px';
            up.addEventListener('click', () => browse(parent));
            breadcrumb.appendChild(up);
        }
        const path = document.createElement('span');
        path.style.cssText = 'font-size:11px;color:var(--text-dim);word-break:break-all';
        path.textContent = dir;
        breadcrumb.appendChild(path);
    }

    function renderEntries(entries, parent) {
        fileList.innerHTML = '';
        if (entries.length === 0) {
            fileList.innerHTML = '<div style="color:var(--text-dim);padding:12px">.osm 파일이 없습니다</div>';
            return;
        }

        for (const e of entries) {
            const item = document.createElement('div');
            item.className = 'modal-item';
            item.style.cursor = 'pointer';

            if (e.type === 'dir') {
                item.innerHTML = `
                    <span class="name">📁 ${e.name}</span>
                    <span class="meta">${e.has_osm ? '⬡ OSM 포함' : ''}</span>`;
                item.addEventListener('click', () => browse(e.path));
            } else {
                item.innerHTML = `
                    <span class="name">🗺 ${e.name}</span>
                    <span class="meta">${e.size_mb} MB</span>`;
                item.addEventListener('click', () => {
                    closeModal();
                    loadVmap(e.path, e.name);
                });
            }
            fileList.appendChild(item);
        }
    }

    // ── 로드 실행 ──────────────────────────────────────
    function loadVmap(path, name) {
        setStatus('파싱 중...', 'parsing');
        setProgress(5, '파싱 요청 중...');
        appendLog(`Vector Map 로드: ${name}`, 'info');

        viewer.loadVectorMap(path, {
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

    [['ckb-vmap-2024', 0], ['ckb-vmap-2020', 1], ['ckb-vmap-2019', 2]].forEach(([id, idx]) => {
        $(id)?.addEventListener('change', e => viewer.setVectorMapYearVisible(idx, e.target.checked));
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
