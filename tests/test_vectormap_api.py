"""회귀 테스트 — /api/vectormap/* Flask 엔드포인트의 바이너리 응답.

이번 세션에서 실제로 발견한 버그: 바이너리 순서를
positions(f32) → types(u8) → lanelet_verts(f32) → arrow_verts(f32)
로 두면, Uint8 영역 뒤에 오는 Float32Array 뷰의 시작 오프셋이 4바이트
배수가 아니게 될 수 있어 브라우저에서 크래시한다. 이 테스트는 실제
Flask 엔드포인트가 반환하는 바이트를 클라이언트(JS)와 동일한 방식으로
파싱해봐서, 오프셋 계산이 항상 유효한지 자동으로 검증한다.
"""
import os
import sys
import time
import hashlib
import tempfile

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app
import api as api_module
from api import _vmap_cache, _TRIS_PER_LANELET

SAMPLE_OSM = """<?xml version='1.0' encoding='UTF-8'?>
<osm generator="test">
  <node id="1" lat="35.10000000" lon="126.90000000">
    <tag k="local_x" v="1000.0"/>
    <tag k="local_y" v="2000.0"/>
    <tag k="ele" v="10.0"/>
  </node>
  <node id="2" lat="35.10001000" lon="126.90001000">
    <tag k="local_x" v="1010.0"/>
    <tag k="local_y" v="2000.0"/>
    <tag k="ele" v="10.5"/>
  </node>
  <node id="3" lat="35.10000000" lon="126.90000200">
    <tag k="local_x" v="1000.0"/>
    <tag k="local_y" v="2010.0"/>
    <tag k="ele" v="10.0"/>
  </node>
  <node id="4" lat="35.10001000" lon="126.90001200">
    <tag k="local_x" v="1010.0"/>
    <tag k="local_y" v="2010.0"/>
    <tag k="ele" v="10.5"/>
  </node>
  <way id="10">
    <nd ref="1"/>
    <nd ref="2"/>
    <tag k="type" v="line_thin"/>
  </way>
  <way id="11">
    <nd ref="3"/>
    <nd ref="4"/>
    <tag k="type" v="line_thin"/>
  </way>
  <relation id="100">
    <member type="way" role="left" ref="10"/>
    <member type="way" role="right" ref="11"/>
    <tag k="type" v="lanelet"/>
    <tag k="subtype" v="road"/>
    <tag k="speed_limit" v="30"/>
  </relation>
</osm>
"""


@pytest.fixture()
def client():
    app.config['TESTING'] = True
    with app.test_client() as c:
        yield c


def _load_and_wait(client, osm_bytes, filename='test.osm', timeout=5.0):
    resp = client.post(
        '/api/vectormap/load',
        data={'file': (tempfile_like(osm_bytes), filename)},
        content_type='multipart/form-data',
    )
    assert resp.status_code == 200
    key = resp.get_json()['key']

    deadline = time.time() + timeout
    while time.time() < deadline:
        st = client.get(f'/api/vectormap/status/{key}').get_json()
        if st['status'] == 'ready':
            return key
        if st['status'] == 'error':
            pytest.fail(f"파싱 오류: {st['message']}")
        time.sleep(0.05)
    pytest.fail('파싱 타임아웃')


def tempfile_like(data: bytes):
    import io
    return io.BytesIO(data)


class TestVmapDataBinaryLayout:
    def test_binary_response_is_byte_exact_and_alignable(self, client):
        """서버가 보낸 바이트를 JS 클라이언트와 동일한 오프셋 계산으로
        파싱했을 때, Float32Array 생성이 예외 없이 되고(=4바이트 정렬
        유지) 전체 바이트를 남김없이 소진해야 한다."""
        key = _load_and_wait(client, SAMPLE_OSM.encode('utf-8'))
        try:
            resp = client.get(f'/api/vectormap/data/{key}')
            assert resp.status_code == 200

            seg_count = int(resp.headers['X-Seg-Count'])
            lanelet_count = int(resp.headers['X-Lanelet-Count'])
            arrow_count = int(resp.headers['X-Arrow-Count'])
            buf = resp.data

            pos_bytes = seg_count * 6 * 4
            lanelet_bytes = lanelet_count * 9 * 4
            arrow_bytes = arrow_count * 6 * 4
            n_lanelets = lanelet_count // _TRIS_PER_LANELET

            # 정렬 확인: 각 Float32/Uint32 뷰의 시작 오프셋이 4의 배수여야 함
            assert pos_bytes % 4 == 0
            assert (pos_bytes) % 4 == 0          # lanelet_verts 시작
            assert (pos_bytes + lanelet_bytes) % 4 == 0   # arrow_verts 시작

            positions = np.frombuffer(buf, dtype='<f4', count=seg_count * 6, offset=0)
            lanelet_verts = np.frombuffer(buf, dtype='<f4', count=lanelet_count * 9, offset=pos_bytes)
            arrow_verts = np.frombuffer(buf, dtype='<f4', count=arrow_count * 6,
                                         offset=pos_bytes + lanelet_bytes)
            types = np.frombuffer(buf, dtype='<u1', count=seg_count,
                                   offset=pos_bytes + lanelet_bytes + arrow_bytes)
            subtypes = np.frombuffer(buf, dtype='<u1', count=n_lanelets,
                                      offset=pos_bytes + lanelet_bytes + arrow_bytes + seg_count)

            consumed = pos_bytes + lanelet_bytes + arrow_bytes + seg_count + n_lanelets
            assert consumed == len(buf), '바이트를 남김없이 소진해야 함 (누락/초과 없음)'

            assert seg_count == 2
            assert lanelet_count == _TRIS_PER_LANELET
            assert n_lanelets == 1
            assert subtypes[0] == 0  # road
            assert not np.isnan(positions).any()
            assert not np.isnan(lanelet_verts).any()
        finally:
            client.delete(f'/api/vectormap/clear/{key}')
            _vmap_cache.pop(key, None)

    def test_lanelet_meta_endpoint(self, client):
        key = _load_and_wait(client, SAMPLE_OSM.encode('utf-8'))
        try:
            resp = client.get(f'/api/vectormap/lanelet_meta/{key}')
            assert resp.status_code == 200
            lanelets = resp.get_json()['lanelets']
            assert len(lanelets) == 1
            assert lanelets[0]['id'] == 100
            assert lanelets[0]['subtype'] == 'road'
            assert lanelets[0]['speed_limit'] == pytest.approx(30.0)
        finally:
            client.delete(f'/api/vectormap/clear/{key}')
            _vmap_cache.pop(key, None)

    def test_data_endpoint_404_for_unknown_key(self, client):
        resp = client.get('/api/vectormap/data/does-not-exist')
        assert resp.status_code == 404

    def test_lanelet_meta_404_for_unknown_key(self, client):
        resp = client.get('/api/vectormap/lanelet_meta/does-not-exist')
        assert resp.status_code == 404

    def test_non_osm_upload_rejected(self, client):
        resp = client.post(
            '/api/vectormap/load',
            data={'file': (tempfile_like(b'not an osm file'), 'test.txt')},
            content_type='multipart/form-data',
        )
        assert resp.status_code == 400


class TestVmapCacheEviction:
    """캐시 개수 상한 — 벡터맵을 계속 로드/교체해도 메모리가 무한정
    쌓이지 않고 오래된 항목부터 자동으로 정리되어야 함."""

    def setup_method(self):
        self._saved = dict(api_module._vmap_cache)
        api_module._vmap_cache.clear()

    def teardown_method(self):
        api_module._vmap_cache.clear()
        api_module._vmap_cache.update(self._saved)

    def test_evicts_oldest_ready_entries_over_cap(self):
        cache = api_module._vmap_cache
        for i in range(api_module._VMAP_CACHE_MAX + 3):
            cache[f'k{i}'] = {'status': 'ready', 'data': {}}
        api_module._evict_vmap_cache()
        assert len(cache) == api_module._VMAP_CACHE_MAX
        # 가장 오래된 것(k0, k1, k2)은 제거되고 최근 것들은 남아야 함
        assert 'k0' not in cache
        assert f'k{api_module._VMAP_CACHE_MAX + 2}' in cache

    def test_parsing_entries_are_not_evicted(self):
        cache = api_module._vmap_cache
        cache['still-parsing'] = {'status': 'parsing'}
        for i in range(api_module._VMAP_CACHE_MAX + 3):
            cache[f'k{i}'] = {'status': 'ready', 'data': {}}
        api_module._evict_vmap_cache()
        assert 'still-parsing' in cache

    def test_exclude_key_is_protected(self):
        cache = api_module._vmap_cache
        for i in range(api_module._VMAP_CACHE_MAX + 3):
            cache[f'k{i}'] = {'status': 'ready', 'data': {}}
        api_module._evict_vmap_cache(exclude_key='k0')  # 가장 오래됐지만 보호
        assert 'k0' in cache

    def test_real_uploads_stay_within_cap(self, client):
        """실제 엔드포인트로 상한보다 많은 서로 다른 파일을 로드해도
        캐시 크기가 상한을 넘지 않아야 함."""
        keys = []
        try:
            for i in range(api_module._VMAP_CACHE_MAX + 3):
                osm = SAMPLE_OSM.replace('id="100"', f'id="{100 + i}"')
                key = _load_and_wait(client, osm.encode('utf-8'), filename=f'test{i}.osm')
                keys.append(key)
            assert len(api_module._vmap_cache) <= api_module._VMAP_CACHE_MAX
        finally:
            for key in keys:
                client.delete(f'/api/vectormap/clear/{key}')
                api_module._vmap_cache.pop(key, None)
