"""회귀 테스트 — pointcloud_io.py에서 이번 세션에 발견/수정한 버그들을 고정.

각 테스트는 실제로 마주쳤던 구체적인 파일 형식을 최소 재현한 것이다:
- PCD 바이너리: 패딩 필드('_')가 여러 번 나오는 파일 (numpy dtype 이름 충돌)
- PCD ASCII: COUNT>1 필드가 x/y/z보다 앞에 오는 파일 (컬럼 밀림)
- PCD: intensity/RGB 없는 XYZ-only 파일 (검게 렌더링되던 문제)
- PLY 바이너리: 속성명이 중복되는 비표준 파일
"""
import os
import sys
import tempfile

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pointcloud_io import read_pointcloud


def _write(content: bytes, suffix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, 'wb') as f:
        f.write(content)
    return path


class TestPcdPaddingFieldCollision:
    """FIELDS에 패딩용 '_'가 두 번 이상 나오는 PCL 스타일 PCD (바이너리)."""

    def _make(self):
        header = (
            "# .PCD v0.7 - Point Cloud Data file format\n"
            "VERSION 0.7\n"
            "FIELDS intensity _ x y z _\n"
            "SIZE 4 1 4 4 4 1\n"
            "TYPE F U F F F U\n"
            "COUNT 1 12 1 1 1 4\n"
            "WIDTH 2\n"
            "HEIGHT 1\n"
            "POINTS 2\n"
            "DATA binary\n"
        ).encode('ascii')
        import struct
        rows = []
        for intensity, pad12, x, y, z, pad4 in [
            (0.5, b'\x00' * 12, 1.0, 2.0, 3.0, b'\x00' * 4),
            (0.8, b'\x00' * 12, 4.0, 5.0, 6.0, b'\x00' * 4),
        ]:
            rows.append(struct.pack('<f', intensity) + pad12 +
                        struct.pack('<fff', x, y, z) + pad4)
        return header + b''.join(rows)

    def test_no_dtype_collision_crash(self):
        path = _write(self._make(), '.pcd')
        try:
            d = read_pointcloud(path)
        finally:
            os.unlink(path)
        assert list(d['x']) == pytest.approx([1.0, 4.0])
        assert list(d['y']) == pytest.approx([2.0, 5.0])
        assert list(d['z']) == pytest.approx([3.0, 6.0])


class TestPcdAsciiColumnShift:
    """ASCII 모드에서 COUNT>1 필드(패딩)가 x/y/z보다 앞에 있으면
    fields 목록이 실제 컬럼 수만큼 펼쳐지지 않아 x/y/z가 엉뚱한 컬럼을
    읽어오던 버그. (바이너리 모드처럼 크래시하지 않고 잘못된 좌표를
    조용히 반환하던 게 더 위험했음.)"""

    def _make(self):
        return (
            "# .PCD v0.7 - Point Cloud Data file format\n"
            "VERSION 0.7\n"
            "FIELDS intensity _ x y z\n"
            "SIZE 4 1 4 4 4\n"
            "TYPE F U F F F\n"
            "COUNT 1 3 1 1 1\n"
            "WIDTH 2\n"
            "HEIGHT 1\n"
            "POINTS 2\n"
            "DATA ascii\n"
            "0.5 0 0 0 1.0 2.0 3.0\n"
            "0.8 0 0 0 4.0 5.0 6.0\n"
        ).encode('ascii')

    def test_xyz_reads_correct_columns(self):
        path = _write(self._make(), '.pcd')
        try:
            d = read_pointcloud(path)
        finally:
            os.unlink(path)
        assert list(d['x']) == pytest.approx([1.0, 4.0])
        assert list(d['y']) == pytest.approx([2.0, 5.0])
        assert list(d['z']) == pytest.approx([3.0, 6.0])


class TestPcdXyzOnlyIntensity:
    """intensity/RGB가 전혀 없는 PCD는 예전에 전부 검게(intensity=0)
    렌더링됐음 — Z 기반 intensity로 대체해야 함."""

    def _make(self):
        return (
            "# .PCD v0.7 - Point Cloud Data file format\n"
            "VERSION 0.7\n"
            "FIELDS x y z\n"
            "SIZE 4 4 4\n"
            "TYPE F F F\n"
            "COUNT 1 1 1\n"
            "WIDTH 3\n"
            "HEIGHT 1\n"
            "POINTS 3\n"
            "DATA ascii\n"
            "0.0 0.0 10.0\n"
            "0.0 0.0 20.0\n"
            "0.0 0.0 30.0\n"
        ).encode('ascii')

    def test_intensity_derived_from_z(self):
        path = _write(self._make(), '.pcd')
        try:
            d = read_pointcloud(path)
        finally:
            os.unlink(path)
        assert not np.all(d['intensity'] == 0)
        assert d['intensity'].min() == pytest.approx(0.0)
        assert d['intensity'].max() == pytest.approx(1.0)

    def test_flat_z_falls_back_to_mid_gray(self):
        """z가 전부 같으면 (max-min)로 나눌 수 없으니 0.5로 폴백."""
        content = (
            "# .PCD v0.7 - Point Cloud Data file format\n"
            "VERSION 0.7\n"
            "FIELDS x y z\n"
            "SIZE 4 4 4\n"
            "TYPE F F F\n"
            "COUNT 1 1 1\n"
            "WIDTH 2\n"
            "HEIGHT 1\n"
            "POINTS 2\n"
            "DATA ascii\n"
            "0.0 0.0 5.0\n"
            "1.0 1.0 5.0\n"
        ).encode('ascii')
        path = _write(content, '.pcd')
        try:
            d = read_pointcloud(path)
        finally:
            os.unlink(path)
        assert list(d['intensity']) == pytest.approx([0.5, 0.5])


class TestPlyDuplicatePropertyNames:
    """속성명이 중복된 비표준 PLY 바이너리 파일 — numpy dtype 생성이
    'field occurs more than once'로 크래시하던 버그."""

    def _make(self):
        import struct
        header = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            "element vertex 2\n"
            "property float x\n"
            "property float y\n"
            "property float z\n"
            "property float x\n"   # 중복 속성명 (비표준이지만 실제 존재)
            "end_header\n"
        ).encode('ascii')
        data = struct.pack('<ffff', 1.0, 2.0, 3.0, 99.0) + struct.pack('<ffff', 4.0, 5.0, 6.0, 99.0)
        return header + data

    def test_no_dtype_collision_crash(self):
        path = _write(self._make(), '.ply')
        try:
            d = read_pointcloud(path)
        finally:
            os.unlink(path)
        assert list(d['x']) == pytest.approx([1.0, 4.0])
        assert list(d['y']) == pytest.approx([2.0, 5.0])
        assert list(d['z']) == pytest.approx([3.0, 6.0])


class TestPlyNormalCases:
    """회귀 방지용 베이스라인 — 정상 PLY(중복/패딩 없음)도 계속 잘 동작해야 함."""

    def test_binary_little_endian_xyz_rgb(self):
        import struct
        header = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            "element vertex 1\n"
            "property float x\n"
            "property float y\n"
            "property float z\n"
            "property uchar red\n"
            "property uchar green\n"
            "property uchar blue\n"
            "end_header\n"
        ).encode('ascii')
        data = struct.pack('<fff', 1.5, 2.5, 3.5) + struct.pack('<BBB', 255, 128, 0)
        path = _write(header + data, '.ply')
        try:
            d = read_pointcloud(path)
        finally:
            os.unlink(path)
        assert d['x'][0] == pytest.approx(1.5)
        assert d['has_rgb'] is True
        assert d['r'][0] == pytest.approx(1.0)
