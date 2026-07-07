/* ═══════════════════════════════════════════════════════
   Layers 패널 — 로드된 PCD/OSM을 목록으로 보여주고
   표시/비표시, 포커스, 제거를 제공한다.
   ═══════════════════════════════════════════════════════ */
import { layerRegistry } from './layer-registry.js';

const $ = id => document.getElementById(id);

export function initLayerPanel(viewer) {
    const list = $('layer-list');
    const empty = $('layer-list-empty');
    if (!list) return;

    layerRegistry.onChange(render);
    render(layerRegistry.getLayers());

    function render(entries) {
        list.innerHTML = '';
        if (empty) empty.style.display = entries.length ? 'none' : '';

        for (const entry of entries) {
            const item = document.createElement('div');
            item.className = 'layer-item';

            const eyeBtn = document.createElement('button');
            eyeBtn.className = 'layer-eye';
            eyeBtn.title = '표시/숨김';
            eyeBtn.textContent = '\u{1F441}'; // 👁 (off 상태는 CSS로 흐리게 표시)
            eyeBtn.classList.toggle('off', !entry.visible);
            eyeBtn.addEventListener('click', () => {
                entry.visible = !entry.visible;
                entry.setVisible(entry.visible);
                eyeBtn.classList.toggle('off', !entry.visible);
                viewer._dirty = true;
            });

            const icon = document.createElement('span');
            icon.className = 'layer-type-icon';
            icon.textContent = entry.type === 'vmap' ? '⬡' : '⚙';

            const nameWrap = document.createElement('div');
            nameWrap.className = 'layer-name-wrap';
            const nameEl = document.createElement('span');
            nameEl.className = 'layer-name';
            nameEl.title = entry.name;
            nameEl.textContent = entry.name;
            nameWrap.appendChild(nameEl);
            if (entry.meta) {
                const metaEl = document.createElement('span');
                metaEl.className = 'layer-meta';
                metaEl.textContent = entry.meta;
                nameWrap.appendChild(metaEl);
            }

            const focusBtn = document.createElement('button');
            focusBtn.className = 'layer-focus';
            focusBtn.title = '이 레이어로 시점 이동';
            focusBtn.textContent = 'Focus';
            focusBtn.addEventListener('click', () => {
                viewer.focusOnLayer(entry.getObject3D());
            });

            const removeBtn = document.createElement('button');
            removeBtn.className = 'layer-remove';
            removeBtn.title = '목록에서 제거';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', () => {
                entry.remove();
                layerRegistry.removeLayer(entry.id);
            });

            item.appendChild(eyeBtn);
            item.appendChild(icon);
            item.appendChild(nameWrap);
            item.appendChild(focusBtn);
            item.appendChild(removeBtn);
            list.appendChild(item);
        }
    }
}
