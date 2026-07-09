"""회귀 테스트 — api.py의 Lanelet2 OSM 벡터맵 파싱에서 이번 세션에
발견/수정한 버그들을 고정.

- 홑따옴표/쌍따옴표 혼용 (VMB vs merge_ngii 생성기별로 다름)
- local_x/local_y 태그 우선 사용
- MGRS 로컬 원점 자동 판별 (폴더명이 아니라 파일 내용 기반)
- lanelet(relation) 파싱 — left/right way 속성 순서가 파일마다 다름
- lanelet 하나당 항상 고정 개수의 삼각형이 나오는 불변식
"""
import os
import sys
import hashlib
import tempfile

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import api as api_module
from api import (
    _get_vmap_transformer, _resample_polyline, _build_lanelets,
    _parse_vmap_bg, _vmap_cache, _TRIS_PER_LANELET,
)


def _write_osm(content: str) -> str:
    fd, path = tempfile.mkstemp(suffix='.osm')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(content)
    return path


# ══════════════════════════════════════════════════════
#  _resample_polyline
# ══════════════════════════════════════════════════════

class TestResamplePolyline:
    def test_straight_line_even_spacing(self):
        pts = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]])
        out = _resample_polyline(pts, 5)
        assert out.shape == (5, 3)
        assert out[0, 0] == pytest.approx(0.0)
        assert out[-1, 0] == pytest.approx(10.0)
        assert out[2, 0] == pytest.approx(5.0)  # 중간점

    def test_single_point_repeats(self):
        pts = np.array([[3.0, 4.0, 0.0]])
        out = _resample_polyline(pts, 4)
        assert out.shape == (4, 3)
        assert np.allclose(out, [3.0, 4.0, 0.0])

    def test_zero_length_polyline(self):
        """모든 점이 같은 위치(길이 0)여도 크래시하면 안 됨."""
        pts = np.array([[1.0, 1.0, 0.0], [1.0, 1.0, 0.0], [1.0, 1.0, 0.0]])
        out = _resample_polyline(pts, 6)
        assert out.shape == (6, 3)
        assert np.allclose(out, [1.0, 1.0, 0.0])

    def test_preserves_endpoints_on_curve(self):
        pts = np.array([[0.0, 0.0, 0.0], [1.0, 2.0, 0.0], [3.0, 2.0, 0.0], [4.0, 0.0, 0.0]])
        out = _resample_polyline(pts, 10)
        assert out[0] == pytest.approx(pts[0])
        assert out[-1] == pytest.approx(pts[-1])


# ══════════════════════════════════════════════════════
#  _get_vmap_transformer — MGRS 로컬 원점 자동 판별
# ══════════════════════════════════════════════════════

class TestMgrsAutoOrigin:
    def test_content_based_origin_matches_mgrs_library(self):
        """폴더명이 아니라 파일 내 노드 좌표만으로 100km 그리드 원점을
        추정한 값이, mgrs 라이브러리의 실제 변환 결과와 정확히 일치해야 함."""
        pytest.importorskip('mgrs')
        content = (
            "<?xml version='1.0' encoding='UTF-8'?>\n"
            "<osm generator='test'>\n"
            "  <node id='1' lat='35.22107100' lon='126.95590300'/>\n"
            "</osm>\n"
        )
        path = _write_osm(content)
        try:
            t, origin = _get_vmap_transformer(path)
        finally:
            os.unlink(path)

        import mgrs
        m = mgrs.MGRS()
        # 이 좌표는 52SCD 그리드에 속함 (100km 원점 = UTM52N (300000, 3800000))
        assert m.toMGRS(35.22107100, 126.95590300).startswith('52SCD')
        assert origin is not None
        assert origin[0] == pytest.approx(300000.0, abs=1.0)
        assert origin[1] == pytest.approx(3800000.0, abs=1.0)

    def test_no_coordinates_falls_back_gracefully(self):
        """노드가 없는 파일은 크래시 없이 기본 변환기로 폴백."""
        path = _write_osm("<?xml version='1.0'?>\n<osm generator='test'>\n</osm>\n")
        try:
            t, origin = _get_vmap_transformer(path)
        finally:
            os.unlink(path)
        assert t is not None


# ══════════════════════════════════════════════════════
#  _parse_vmap_bg — end-to-end (따옴표 혼용, local_x/y, lanelet)
# ══════════════════════════════════════════════════════

# 홑따옴표(VMB 스타일) + 쌍따옴표(merge_ngii 스타일)를 한 파일에 섞음 —
# 실제로 두 생성기가 서로 다른 따옴표를 쓰는 것을 재현
SAMPLE_OSM = """<?xml version='1.0' encoding='UTF-8'?>
<osm generator="mixed_quote_test">
  <node id='1' lat="35.10000000" lon="126.90000000">
    <tag k="local_x" v="1000.0" />
    <tag k='local_y' v='2000.0' />
    <tag k="ele" v="10.0"/>
  </node>
  <node id="2" lat='35.10001000' lon='126.90001000'>
    <tag k='local_x' v='1010.0'/>
    <tag k="local_y" v="2000.0"/>
    <tag k='ele' v='10.5'/>
  </node>
  <node id='3' lat="35.10000000" lon="126.90000200">
    <tag k='local_x' v='1000.0'/>
    <tag k="local_y" v="2010.0"/>
    <tag k='ele' v='10.0'/>
  </node>
  <node id="4" lat='35.10001000' lon='126.90001200'>
    <tag k="local_x" v="1010.0"/>
    <tag k='local_y' v='2010.0'/>
    <tag k="ele" v="10.5"/>
  </node>
  <way id='10'>
    <nd ref='1'/>
    <nd ref='2'/>
    <tag k='type' v='line_thin'/>
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
    <tag k="one_way" v="yes"/>
    <tag k="turn_direction" v="straight"/>
  </relation>
  <relation id='101'>
    <member type='way' ref='10' role='left' />
    <member type='way' ref='11' role='right' />
    <tag k='type' v='lanelet' />
    <tag k='subtype' v='crosswalk' />
  </relation>
</osm>
"""


@pytest.fixture()
def parsed_sample():
    path = _write_osm(SAMPLE_OSM)
    key = hashlib.md5(path.encode()).hexdigest()[:16]
    try:
        _vmap_cache.pop(key, None)
        _parse_vmap_bg(path, key)
        yield _vmap_cache[key]
    finally:
        os.unlink(path)
        _vmap_cache.pop(key, None)


class TestParseVmapBgEndToEnd:
    def test_status_ready(self, parsed_sample):
        assert parsed_sample['status'] == 'ready'

    def test_local_xy_used_directly(self, parsed_sample):
        """local_x/local_y 태그가 있으면 위경도 변환 대신 그 값을 그대로 써야 함
        (lat/lon → UTM 변환 오차 없이 정확히 일치해야 함)."""
        data = parsed_sample['data']
        pos = data['positions']
        ox, oy, oz = data['offset']
        # way 10: node1(1000,2000) → node2(1010,2000), offset 빼기 전 원본 복원
        xs = sorted({round(pos[i, 0] + ox, 3) for i in range(len(pos))} |
                    {round(pos[i, 3] + ox, 3) for i in range(len(pos))})
        assert 1000.0 in xs
        assert 1010.0 in xs

    def test_ele_used_as_z(self, parsed_sample):
        data = parsed_sample['data']
        oz = data['offset'][2]
        # ele 값 10.0/10.5 의 평균 근방이어야 함
        assert oz == pytest.approx(10.25, abs=0.1)

    def test_two_lanelets_fixed_triangle_count(self, parsed_sample):
        """lanelet 2개 → 삼각형은 항상 2 * _TRIS_PER_LANELET개, 메타데이터도 2개."""
        data = parsed_sample['data']
        assert data['lanelet_count'] == 2 * _TRIS_PER_LANELET
        assert len(data['lanelet_meta']) == 2
        assert len(data['lanelet_subtypes']) == 2

    def test_lanelet_meta_matches_tags(self, parsed_sample):
        data = parsed_sample['data']
        meta = data['lanelet_meta']
        by_id = {m['id']: m for m in meta}
        assert by_id[100]['subtype'] == 'road'
        assert by_id[100]['speed_limit'] == pytest.approx(30.0)
        assert by_id[100]['one_way'] == 'yes'
        assert by_id[100]['turn_direction'] == 'straight'
        assert by_id[101]['subtype'] == 'crosswalk'

    def test_subtype_codes_match_map(self, parsed_sample):
        """subtype 코드가 api._LANELET_SUBTYPE_MAP과 일치하는지 (road=0, crosswalk=1)."""
        data = parsed_sample['data']
        meta = data['lanelet_meta']
        codes = data['lanelet_subtypes']
        idx_100 = next(i for i, m in enumerate(meta) if m['id'] == 100)
        idx_101 = next(i for i, m in enumerate(meta) if m['id'] == 101)
        assert codes[idx_100] == 0   # road
        assert codes[idx_101] == 1   # crosswalk

    def test_way_segments_built(self, parsed_sample):
        data = parsed_sample['data']
        assert data['seg_count'] == 2  # way 10, 11 각각 노드 2개 → 세그먼트 1개씩


class TestBuildLaneletsDirectly:
    """_build_lanelets()를 직접 호출해 삼각형/화살표/메타 정합성 확인."""

    def test_missing_way_skipped_without_crash(self):
        lanelets = [{'id': 1, 'left': 999, 'right': 998, 'subtype': b'road',
                     'speed_limit': None, 'one_way': None, 'turn_direction': None}]
        tri_rows, arrow_rows, subtype_rows, meta_rows = _build_lanelets(
            lanelets, ways={}, nodes={}, ox=0, oy=0, oz=0)
        assert tri_rows == []
        assert meta_rows == []

    def test_valid_lanelet_produces_fixed_triangle_count(self):
        nodes = {
            1: (0.0, 0.0, 0.0), 2: (10.0, 0.0, 0.0),
            3: (0.0, 3.0, 0.0), 4: (10.0, 3.0, 0.0),
        }
        ways = {10: ([1, 2], 0), 11: ([3, 4], 0)}
        lanelets = [{'id': 1, 'left': 10, 'right': 11, 'subtype': b'road',
                     'speed_limit': 30.0, 'one_way': 'yes', 'turn_direction': 'straight'}]
        tri_rows, arrow_rows, subtype_rows, meta_rows = _build_lanelets(
            lanelets, ways, nodes, ox=0, oy=0, oz=0)
        assert len(tri_rows) == _TRIS_PER_LANELET
        assert len(meta_rows) == 1
        assert len(subtype_rows) == 1
        assert meta_rows[0]['speed_limit'] == pytest.approx(30.0)


# ══════════════════════════════════════════════════════
#  GPS 없는 실내/로컬 전용 지도 (lat="" lon="")
# ══════════════════════════════════════════════════════

# VMB로 만든 실내 지도는 GPS가 없어 lat/lon이 빈 문자열이고, local_x/local_y/ele
# 태그만 유효하다. 예전에는 정규식이 빈 lat/lon을 매칭 실패로 처리해서 노드를
# 통째로 못 읽고 — OSM은 "로드 성공"이라고 뜨지만 세그먼트가 0개라 화면에
# 아무것도 안 보이던 버그가 있었음.
LOCAL_ONLY_OSM = """<?xml version="1.0" encoding="UTF-8"?>
<osm generator="VMB">
  <MetaInfo format_version="1" map_version="1" validation_version="1"/>
  <node id="1" lat="" lon="">
    <tag k="local_x" v="-3.7691"/>
    <tag k="local_y" v="-10.6452"/>
    <tag k="ele" v="-0.8136"/>
  </node>
  <node id="2" lat="" lon="">
    <tag k="local_x" v="-4.5395"/>
    <tag k="local_y" v="-9.786"/>
    <tag k="ele" v="-0.8603"/>
  </node>
  <way id="10">
    <nd ref="1"/>
    <nd ref="2"/>
    <tag k="type" v="line_thin"/>
  </way>
</osm>
"""


class TestLocalOnlyMapEmptyLatLon:
    def test_node_with_empty_latlon_still_parsed(self):
        path = _write_osm(LOCAL_ONLY_OSM)
        key = hashlib.md5(path.encode()).hexdigest()[:16]
        try:
            _vmap_cache.pop(key, None)
            _parse_vmap_bg(path, key)
            d = _vmap_cache[key]
            assert d['status'] == 'ready'
            data = d['data']
            # 이전 버그: seg_count가 0 (노드를 하나도 못 읽음)
            assert data['seg_count'] == 1
            pos = data['positions']
            ox, oy = data['offset'][0], data['offset'][1]
            assert (pos[0, 0] + ox) == pytest.approx(-3.7691, abs=1e-3)
            assert (pos[0, 1] + oy) == pytest.approx(-10.6452, abs=1e-3)
        finally:
            os.unlink(path)
            _vmap_cache.pop(key, None)

    def test_peek_first_node_latlon_skips_empty(self):
        """_peek_first_node_latlon은 lat/lon이 비어있는 노드를 건너뛰어야 함
        (MGRS 자동 판별용 대표 좌표를 못 찾으면 None을 반환해도 되지만,
        빈 문자열을 float()로 변환하려다 크래시하면 안 됨)."""
        path = _write_osm(LOCAL_ONLY_OSM)
        try:
            from api import _peek_first_node_latlon
            result = _peek_first_node_latlon(path)  # 크래시하지 않아야 함
            assert result is None  # 유효한 lat/lon이 파일에 하나도 없음
        finally:
            os.unlink(path)

    def test_transformer_fallback_does_not_crash(self):
        path = _write_osm(LOCAL_ONLY_OSM)
        try:
            t, origin = _get_vmap_transformer(path)  # 크래시하지 않아야 함
            assert t is not None
        finally:
            os.unlink(path)
