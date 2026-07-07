/* ═══════════════════════════════════════════════════════
   UI Files: File Modal, Recording Modal, Upload,
   Map List, Map Search, Map Management, Drag & Drop,
   Compare Map Controls
   ═══════════════════════════════════════════════════════ */
import { $, formatFileSize, formatDate, formatPoints } from './utils.js';
import { showToast, customConfirm, showLoading, hideLoading, withLoading } from './ui-notifications.js';
import { appendLog } from './ui-panels.js';
import { layerRegistry } from './layer-registry.js';

/**
 * @param {import('./viewer.js').Viewer} viewer
 * @param {import('./viewer.js').Legend} legend
 * @param {Object} deps
 * @param {Object} uiState
 */
export function initFileManagement(viewer, legend, deps, uiState) {
    const { loadLasFromPath, uploadLasFile } = deps;

    // ── File modal ──
    const modalBg = $('modal-file');
    const openModal = () => {
        uiState.compareMode = 'load';
        $('modal-file-title').textContent = 'Load Point Cloud';
        $('btn-upload').style.display = '';
        modalBg.classList.add('open');
        const searchInput = $('map-search');
        if (searchInput) searchInput.value = '';
        refreshMapList();
    };
    const closeModal = () => { modalBg.classList.remove('open'); uiState.compareMode = 'load'; $('btn-upload').style.display = ''; $('btn-upload').textContent = 'Upload File'; };

    // Expose closeModal on uiState for cross-module use
    uiState.closeModal = closeModal;

    $('btn-load-map').addEventListener('click', openModal);
    $('btn-modal-close').addEventListener('click', closeModal);
    modalBg.addEventListener('click', e => { if (e.target === modalBg) closeModal(); });

    // Upload
    $('btn-upload').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', async e => {
        const files = Array.from(e.target.files);
        e.target.value = '';
        if (files.length === 0) return;

        // UX-4: File size validation (5 GB matches server MAX_CONTENT_LENGTH)
        const MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024;
        for (const f of files) {
            if (f.size > MAX_UPLOAD_SIZE) {
                showToast(`File too large (${formatFileSize(f.size)}). Maximum upload size is 5 GB.`, 'error');
                return;
            }
        }

        const isCompare = uiState.compareMode === 'compare';
        closeModal();

        if (isCompare) {
            const file = files[0];
            $('st-main').textContent = `Uploading compare map: ${file.name}...`;
            showLoading(`Loading compare map...`);
            try {
                const data = await uploadLasFile(file, pct => {
                    $('st-main').textContent = `Uploading ${file.name}... ${pct}%`;
                });
                viewer.loadCompareCloud(data);
                uiState.compareBPath = data.savedPath || null;
                $('compare-panel').classList.remove('hidden');
                $('compare-b-name').textContent = file.name;
                const ptsA = viewer.pointCloud ? viewer.cloudData?.numPoints?.toLocaleString() || '?' : 'none';
                const ptsB = data.numPoints.toLocaleString();
                $('st-main').textContent = `A: ${ptsA} pts | B: ${ptsB} pts`;
                appendLog(`Compare map uploaded: ${file.name} (${ptsB} pts)`, 'info');
                showToast(`Map A: ${ptsA} pts + Map B: ${ptsB} pts`, 'success');
            } catch (err) {
                $('st-main').textContent = `Error: ${err.message}`;
                showToast(`Failed: ${err.message}`, 'error');
            } finally {
                hideLoading();
            }
            return;
        }

        // 이미 메인 PCD가 로드돼 있으면 새로 고른 파일은 전부 추가 레이어로
        // (Focus 버튼으로 언제든 이동할 수 있으니 기존 것을 덮어쓸 필요 없음)
        // 메인이 비어있을 때만 첫 파일을 메인으로 로드하고 나머지는 추가 레이어로
        let firstFile = null;
        let restFiles = files;
        if (!viewer.pointCloud) {
            [firstFile, ...restFiles] = files;
        }

        if (firstFile) {
            $('st-main').textContent = `Uploading ${firstFile.name} (${formatFileSize(firstFile.size)})...`;
            showLoading(`Loading ${firstFile.name}...`);
            try {
                const data = await uploadLasFile(firstFile, pct => {
                    $('st-main').textContent = `Uploading ${firstFile.name}... ${pct}%`;
                });
                if (data.type === 'gaussian') {
                    viewer.loadGaussianSplat(data);
                } else {
                    viewer.loadPointCloud(data);
                    registerMainPcdLayer(firstFile.name, data);
                }
                legend.update(viewer.colorMode, data.bounds, data.offset ? data.offset[2] : 0);
                if (data.savedPath) {
                    const { setCurrentPath } = await import('./analysis.js');
                    setCurrentPath(data.savedPath);
                }
                $('compare-a-name').textContent = firstFile.name;
                $('no-data-msg').style.display = 'none';
                const label = data.type === 'gaussian' ? 'gaussians' : 'points';
                $('st-main').textContent = `Loaded ${data.numPoints.toLocaleString()} ${label}`;
                appendLog(`Loaded ${firstFile.name} (${data.numPoints.toLocaleString()} ${label})`, 'success');
            } catch (err) {
                $('st-main').textContent = `Error: ${err.message}`;
                showToast(`Failed: ${err.message}`, 'error');
            } finally {
                hideLoading();
            }
        }

        // 나머지 파일들(또는 메인이 이미 있어 전체 파일들): 추가 레이어로 로드
        for (const f of restFiles) {
            await addExtraCloudFile(f);
        }
    });

    async function addExtraCloudFile(file) {
        appendLog(`Point Cloud 추가 로드: ${file.name}`, 'info');
        try {
            const data = await uploadLasFile(file, pct => {
                $('st-main').textContent = `Uploading ${file.name}... ${pct}%`;
            });
            if (data.type === 'gaussian') {
                showToast(`${file.name}: Gaussian Splat은 추가 레이어로 지원하지 않습니다.`, 'error');
                return;
            }
            const entry = viewer.addPointCloud(data);
            registerExtraCloudLayer(file.name, data, entry);
            showToast(`${file.name} 추가 완료 (${data.numPoints.toLocaleString()} pts)`, 'success');
            appendLog(`추가 완료 — ${file.name} (${data.numPoints.toLocaleString()} pts)`, 'success');
        } catch (err) {
            showToast(`${file.name} 추가 실패: ${err.message}`, 'error');
            appendLog(`Point Cloud 추가 오류: ${file.name} — ${err.message}`, 'error');
        }
    }

    // ── Layers 패널 등록 헬퍼 ──
    function registerMainPcdLayer(name, data) {
        layerRegistry.upsertLayer({
            id: 'main-pcd',
            type: 'pcd',
            name,
            meta: `${data.numPoints.toLocaleString()} pts`,
            getObject3D: () => viewer.pointCloud,
            setVisible: (show) => { if (viewer.pointCloud) viewer.pointCloud.visible = show; },
            remove: () => {
                viewer.clearPointCloud();
                showToast(`${name} 제거됨`, 'info');
            },
        });
    }

    function registerExtraCloudLayer(name, data, entry) {
        layerRegistry.upsertLayer({
            id: entry,
            type: 'pcd',
            name,
            meta: `${data.numPoints.toLocaleString()} pts`,
            getObject3D: () => entry.mesh,
            setVisible: (show) => { entry.mesh.visible = show; },
            remove: () => {
                viewer.removePointCloud(entry);
                showToast(`${name} 제거됨`, 'info');
            },
        });
    }

    // Refresh map list
    async function refreshMapList() {
        const list = $('map-list');
        list.innerHTML = '<div style="color:var(--text-dim)">Loading...</div>';
        try {
            const resp = await fetch('/api/maps');
            const maps = await resp.json();
            list.innerHTML = '';
            if (maps.length === 0) {
                list.innerHTML = '<div style="color:var(--text-dim)">No saved maps. Use Upload File to load a LAS/LAZ file.</div>';
                return;
            }
            for (const m of maps) {
                if (m.las_files.length === 0) continue;
                for (const f of m.las_files) {
                    const lasInfo = (m.las_info || []).find(li => li.name === f);
                    const sizeStr = lasInfo ? formatFileSize(lasInfo.size) : '';
                    const ptsStr = lasInfo && lasInfo.num_points ? formatPoints(lasInfo.num_points) + ' pts' : '';
                    const dateStr = m.created ? formatDate(m.created) : '';
                    const metaParts = [f, sizeStr, ptsStr, dateStr].filter(Boolean);
                    const item = document.createElement('div');
                    item.className = 'modal-item';
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'name';
                    nameSpan.textContent = m.name;
                    const metaSpan = document.createElement('span');
                    metaSpan.className = 'meta';
                    metaSpan.textContent = metaParts.join(' | ');
                    const manageBtn = document.createElement('button');
                    manageBtn.className = 'btn';
                    manageBtn.style.cssText = 'padding:2px 6px;font-size:10px;margin-left:auto;flex-shrink:0';
                    manageBtn.dataset.manage = m.name;
                    manageBtn.title = 'Manage map';
                    manageBtn.textContent = '...';
                    item.appendChild(nameSpan);
                    item.appendChild(metaSpan);
                    item.appendChild(manageBtn);
                    const mapPath = m.path;
                    const mapName = m.name;

                    item.querySelector('[data-manage]').addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        openMapManageModal(mapName);
                    });

                    item.addEventListener('click', async (ev) => {
                        if (ev.target.hasAttribute('data-manage')) return;
                        const isCompare = uiState.compareMode === 'compare';
                        console.log('[Compare] compareMode:', uiState.compareMode, 'isCompare:', isCompare);
                        closeModal();
                        const fullPath = `${mapPath}/${f}`;

                        if (isCompare) {
                            console.log('[Compare] Loading Map B:', fullPath);
                            console.log('[Compare] Map A pointCloud exists:', !!viewer.pointCloud);
                            $('st-main').textContent = `Loading compare map: ${mapName}/${f}...`;
                            showLoading(`Loading compare map...`);
                            try {
                                const data = await loadLasFromPath(fullPath);
                                viewer.loadCompareCloud(data);
                                console.log('[Compare] After loadCompareCloud:',
                                    'pointCloud in scene:', viewer.pointCloud ? viewer.scene.children.includes(viewer.pointCloud) : false,
                                    'compareCloud in scene:', viewer.compareCloud ? viewer.scene.children.includes(viewer.compareCloud) : false);
                                uiState.compareBPath = fullPath;
                                $('compare-panel').classList.remove('hidden');
                                $('compare-b-name').textContent = `${mapName}/${f}`;
                                const ptsA = viewer.pointCloud ? viewer.cloudData?.numPoints?.toLocaleString() || '?' : 'none';
                                const ptsB = data.numPoints.toLocaleString();
                                $('st-main').textContent = `A: ${ptsA} pts | B: ${ptsB} pts`;
                                appendLog(`Compare: A=${ptsA} pts, B=${ptsB} pts (${mapName}/${f})`, 'info');
                                showToast(`Map A: ${ptsA} pts + Map B: ${ptsB} pts loaded`, 'success');
                            } catch (err) {
                                $('st-main').textContent = `Error: ${err.message}`;
                                showToast(`Failed: ${err.message}`, 'error');
                            } finally {
                                hideLoading();
                            }
                            return;
                        }

                        $('st-main').textContent = `Loading ${mapName}/${f}...`;
                        showLoading(`Loading ${mapName}/${f}...`);
                        try {
                            const data = await loadLasFromPath(fullPath);
                            // 이미 메인 PCD가 있으면 기존 것을 덮어쓰지 않고 추가 레이어로 로드
                            if (data.type === 'gaussian') {
                                viewer.loadGaussianSplat(data);
                            } else if (viewer.pointCloud) {
                                const entry = viewer.addPointCloud(data);
                                registerExtraCloudLayer(`${mapName}/${f}`, data, entry);
                            } else {
                                viewer.loadPointCloud(data);
                                registerMainPcdLayer(`${mapName}/${f}`, data);
                                legend.update(viewer.colorMode, data.bounds, data.offset ? data.offset[2] : 0);
                                $('compare-a-name').textContent = `${mapName}/${f}`;
                                const { setCurrentPath } = await import('./analysis.js');
                                setCurrentPath(fullPath);
                            }
                            $('no-data-msg').style.display = 'none';
                            const label = data.type === 'gaussian' ? 'gaussians' : 'pts';
                            appendLog(`Map loaded: ${mapName}/${f} (${data.numPoints.toLocaleString()} ${label})`, 'success');
                        } catch (err) {
                            $('st-main').textContent = `Error: ${err.message}`;
                            showToast(`Failed: ${err.message}`, 'error');
                        } finally {
                            hideLoading();
                        }
                    });
                    list.appendChild(item);
                }
            }
        } catch (err) {
            list.textContent = '';
            const errDiv = document.createElement('div');
            errDiv.style.color = 'var(--danger)';
            errDiv.textContent = err.message;
            list.appendChild(errDiv);
        }
    }

    // Expose refreshMapList for cross-module use
    uiState.refreshMapList = refreshMapList;

    // 4A: Map search filter
    $('map-search').addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#map-list .modal-item').forEach(item => {
            const name = item.querySelector('.name');
            const text = name ? name.textContent.toLowerCase() : '';
            item.style.display = text.includes(q) ? '' : 'none';
        });
    });

    // ── Map Management Modal ──
    function openMapManageModal(mapName) {
        $('manage-map-name').textContent = mapName;
        $('manage-rename-input').value = mapName;
        $('modal-map-manage').classList.add('open');
    }
    $('btn-manage-close').addEventListener('click', () => $('modal-map-manage').classList.remove('open'));
    $('modal-map-manage').addEventListener('click', e => { if (e.target === $('modal-map-manage')) $('modal-map-manage').classList.remove('open'); });
    $('btn-manage-rename').addEventListener('click', async () => {
        const btn = $('btn-manage-rename');
        const oldName = $('manage-map-name').textContent;
        const newName = $('manage-rename-input').value.trim();
        if (!newName || newName === oldName) return;
        await withLoading(btn, async () => {
            try {
                const resp = await fetch(`/api/maps/${encodeURIComponent(oldName)}/rename`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_name: newName }),
                });
                const result = await resp.json();
                if (resp.ok) {
                    showToast(`Renamed: ${oldName} -> ${newName}`, 'success');
                    appendLog(`Map renamed: ${oldName} -> ${newName}`, 'info');
                    $('modal-map-manage').classList.remove('open');
                    refreshMapList();
                } else {
                    showToast(`Rename failed: ${result.error}`, 'error');
                }
            } catch (err) {
                showToast(`Error: ${err.message}`, 'error');
            }
        });
    });
    $('btn-manage-delete').addEventListener('click', async () => {
        const btn = $('btn-manage-delete');
        const mapName = $('manage-map-name').textContent;
        const ok = await customConfirm(`Delete map '${mapName}'? This cannot be undone.`);
        if (!ok) return;
        await withLoading(btn, async () => {
            try {
                const resp = await fetch(`/api/maps/${encodeURIComponent(mapName)}`, { method: 'DELETE' });
                const result = await resp.json();
                if (resp.ok) {
                    showToast(`Map '${mapName}' deleted`, 'success');
                    appendLog(`Map deleted: ${mapName}`, 'warn');
                    $('modal-map-manage').classList.remove('open');
                    refreshMapList();
                } else {
                    showToast(`Delete failed: ${result.error}`, 'error');
                }
            } catch (err) {
                showToast(`Error: ${err.message}`, 'error');
            }
        });
    });

    // ── Drag & Drop ──
    const wrap = $('viewer-wrap');
    const dropOverlay = $('drop-overlay');
    let dragCounter = 0;

    wrap.addEventListener('dragenter', e => { e.preventDefault(); dragCounter++; dropOverlay.style.display = 'flex'; });
    wrap.addEventListener('dragleave', e => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.style.display = 'none'; } });
    wrap.addEventListener('dragover', e => e.preventDefault());
    wrap.addEventListener('drop', async e => {
        e.preventDefault();
        dragCounter = 0;
        dropOverlay.style.display = 'none';
        const file = e.dataTransfer.files[0];
        if (!file || !file.name.match(/\.(las|laz|ply|xyz|txt|csv|pcd|pts|splat)$/i)) return;
        $('st-main').textContent = `Loading ${file.name}...`;
        showLoading(`Loading ${file.name}...`);
        try {
            const data = await uploadLasFile(file);
            // 이미 메인 PCD가 있으면 기존 것을 덮어쓰지 않고 추가 레이어로 로드
            if (data.type === 'gaussian') {
                viewer.loadGaussianSplat(data);
            } else if (viewer.pointCloud) {
                const entry = viewer.addPointCloud(data);
                registerExtraCloudLayer(file.name, data, entry);
            } else {
                viewer.loadPointCloud(data);
                registerMainPcdLayer(file.name, data);
                legend.update(viewer.colorMode, data.bounds, data.offset ? data.offset[2] : 0);
            }
            $('no-data-msg').style.display = 'none';
            const label = data.type === 'gaussian' ? 'gaussians' : 'points';
            $('st-main').textContent = `Loaded ${data.numPoints.toLocaleString()} ${label}`;
            appendLog(`Loaded ${file.name} (${data.numPoints.toLocaleString()} pts)`, 'success');
        } catch (err) {
            $('st-main').textContent = `Error: ${err.message}`;
            showToast(`Failed: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    });

    // ── Compare map ──
    $('btn-compare-map').addEventListener('click', () => {
        uiState.compareMode = 'compare';
        $('modal-file-title').textContent = 'Select Map B (Compare)';
        $('btn-upload').textContent = 'Upload Map B';
        $('modal-file').classList.add('open');
        refreshMapList();
    });
    $('compare-close-btn').addEventListener('click', () => {
        $('compare-panel').classList.add('hidden');
        viewer.clearCompare();
    });
    $('compare-opacity').addEventListener('input', e => viewer.setCompareOpacity(parseFloat(e.target.value)));

    // ── Compare color tint ──
    const colorMap = { '': [0,0,0,0], white: [1,1,1,1], red: [1,0.27,0.27,1], blue: [0.28,0.53,1,1] };
    document.querySelectorAll('.cp-color-dot').forEach(dot => {
        if (dot.dataset.color === '') dot.classList.add('active');
        dot.addEventListener('click', () => {
            document.querySelectorAll('.cp-color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            const [r, g, b, s] = colorMap[dot.dataset.color] || [0,0,0,0];
            viewer.setCompareTint(r, g, b, s);
        });
    });
    const updateCompareOffset = () => {
        viewer.setCompareOffset(
            parseFloat($('compare-ox').value) || 0,
            parseFloat($('compare-oy').value) || 0,
            parseFloat($('compare-oz').value) || 0
        );
    };
    ['compare-ox', 'compare-oy', 'compare-oz'].forEach(id =>
        $(id).addEventListener('input', updateCompareOffset));
    const updateCompareRotation = () => {
        viewer.setCompareRotation(
            parseFloat($('compare-rx').value) || 0,
            parseFloat($('compare-ry').value) || 0,
            parseFloat($('compare-rz').value) || 0
        );
    };
    ['compare-rx', 'compare-ry', 'compare-rz'].forEach(id =>
        $(id).addEventListener('input', updateCompareRotation));

    // ── Compare panel drag ──
    {
        const panel = $('compare-panel');
        const header = panel.querySelector('.compare-header');
        let dragging = false, dx = 0, dy = 0;
        header.addEventListener('pointerdown', e => {
            dragging = true; dx = e.clientX - panel.offsetLeft; dy = e.clientY - panel.offsetTop;
            header.setPointerCapture(e.pointerId);
        });
        header.addEventListener('pointermove', e => {
            if (!dragging) return;
            panel.style.left = (e.clientX - dx) + 'px';
            panel.style.top = (e.clientY - dy) + 'px';
        });
        header.addEventListener('pointerup', () => { dragging = false; });
    }
    $('btn-compare-save').addEventListener('click', async () => {
        const btn = $('btn-compare-save');
        const { getCurrentPath } = await import('./analysis.js');
        const pathA = getCurrentPath();
        const pathB = uiState.compareBPath;
        if (!pathB) {
            showToast('No compare map loaded', 'error');
            return;
        }
        const ox = parseFloat($('compare-ox').value) || 0;
        const oy = parseFloat($('compare-oy').value) || 0;
        const oz = parseFloat($('compare-oz').value) || 0;
        const rx = parseFloat($('compare-rx').value) || 0;
        const ry = parseFloat($('compare-ry').value) || 0;
        const rz = parseFloat($('compare-rz').value) || 0;
        await withLoading(btn, async () => {
            try {
                showLoading('Merging Map A + B...');
                const resp = await fetch('/api/save_compare_b', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path_a: pathA || '', path_b: pathB, ox, oy, oz, rx, ry, rz }),
                });
                const result = await resp.json();
                if (!resp.ok) throw new Error(result.error || 'Save failed');
                showToast(`Merged: A(${(result.points_a||0).toLocaleString()}) + B(${(result.points_b||0).toLocaleString()}) = ${result.points.toLocaleString()} pts`, 'success');
                appendLog(`Merged -> ${result.name} (${result.points.toLocaleString()} pts)`, 'success');
            } catch (err) {
                showToast(`Save failed: ${err.message}`, 'error');
            } finally {
                hideLoading();
            }
        });
    });
    // ── ICP Align ──
    const icpDsSlider = $('icp-downsample');
    const icpDsLabel = $('icp-ds-label');
    if (icpDsSlider && icpDsLabel) {
        icpDsSlider.addEventListener('input', () => {
            icpDsLabel.textContent = Math.round(parseFloat(icpDsSlider.value) * 100) + '%';
        });
    }
    $('btn-icp-align').addEventListener('click', async () => {
        const { getCurrentPath } = await import('./analysis.js');
        const pathA = getCurrentPath();
        const pathB = uiState.compareBPath;
        if (!pathA || !pathB) {
            showToast('Load both Map A and Map B first', 'warn');
            return;
        }
        const maxIter = parseInt($('icp-max-iter').value) || 50;
        const tolerance = parseFloat($('icp-tolerance').value) || 1e-6;
        const maxDist = parseFloat($('icp-max-dist').value) || 0;
        const downsample = parseFloat($('icp-downsample').value) || 1.0;

        // Current compare panel values as initial pose
        const initOx = parseFloat($('compare-ox').value) || 0;
        const initOy = parseFloat($('compare-oy').value) || 0;
        const initOz = parseFloat($('compare-oz').value) || 0;
        const initRx = parseFloat($('compare-rx').value) || 0;
        const initRy = parseFloat($('compare-ry').value) || 0;
        const initRz = parseFloat($('compare-rz').value) || 0;

        showLoading('Running ICP alignment...');
        try {
            const res = await fetch('/api/analysis/icp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path_a: pathA,
                    path_b: pathB,
                    max_iterations: maxIter,
                    tolerance,
                    max_distance: maxDist > 0 ? maxDist : null,
                    downsample,
                    init_translation: [initOx, initOy, initOz],
                    init_rotation: [initRx, initRy, initRz],
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'ICP failed');

            const [rx, ry, rz] = result.rotation;
            const [tx, ty, tz] = result.translation;

            // Update UI inputs
            $('compare-rx').value = rx.toFixed(3);
            $('compare-ry').value = ry.toFixed(3);
            $('compare-rz').value = rz.toFixed(3);
            $('compare-ox').value = tx.toFixed(4);
            $('compare-oy').value = ty.toFixed(4);
            $('compare-oz').value = tz.toFixed(4);

            // Apply transform to compare cloud
            viewer.setCompareRotation(rx, ry, rz);
            viewer.setCompareOffset(tx, ty, tz);

            // Show result info
            const info = `ICP: ${result.iterations} iters, mean dist=${result.mean_distance.toFixed(4)}m` +
                (result.converged ? ' (converged)' : ' (not converged)');
            const icpResult = $('icp-result');
            if (icpResult) icpResult.textContent = info;
            appendLog(info, result.converged ? 'success' : 'warn');
            showToast(info, result.converged ? 'success' : 'warn');
        } catch (err) {
            showToast(`ICP error: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    });

    $('btn-compare-clear').addEventListener('click', () => {
        viewer.clearCompare();
        uiState.compareBPath = null;
        $('compare-b-name').textContent = '-';
    });
}
