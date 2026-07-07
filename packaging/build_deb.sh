#!/bin/bash
# WebPointCloud .deb 패키지 빌드 스크립트
# 사용법: ./packaging/build_deb.sh [버전]
set -euo pipefail

VERSION="${1:-1.0.0}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_NAME="webpointcloud"
STAGE="${PROJECT_ROOT}/packaging/build/${PKG_NAME}_${VERSION}_amd64"

echo "== WebPointCloud .deb 빌드 (v${VERSION}) =="

rm -rf "${STAGE}"
mkdir -p "${STAGE}/DEBIAN"
mkdir -p "${STAGE}/opt/webpointcloud/app"
mkdir -p "${STAGE}/usr/bin"
mkdir -p "${STAGE}/usr/share/applications"
mkdir -p "${STAGE}/usr/share/icons/hicolor/256x256/apps"

# ── 1) venv 생성 + 의존성 설치 (시스템 GTK/WebKit 바인딩 사용) ──
echo "-- venv 생성 중..."
python3.10 -m venv --system-site-packages "${STAGE}/opt/webpointcloud/venv"
"${STAGE}/opt/webpointcloud/venv/bin/pip" install --upgrade pip -q
"${STAGE}/opt/webpointcloud/venv/bin/pip" install -q \
    flask numpy "laspy[lazrs]" scipy pyproj mgrs PyYAML pywebview

# ── 2) 앱 소스 복사 ──
echo "-- 앱 소스 복사 중..."
cd "${PROJECT_ROOT}"
cp app.py api.py config.py security.py pointcloud_io.py las_helpers.py desktop_app.py \
    "${STAGE}/opt/webpointcloud/app/"
cp -r static templates "${STAGE}/opt/webpointcloud/app/"

# ── 3) 실행 스크립트 ──
cat > "${STAGE}/usr/bin/webpointcloud" <<'EOF'
#!/bin/bash
exec /opt/webpointcloud/venv/bin/python3 /opt/webpointcloud/app/desktop_app.py "$@"
EOF
chmod 755 "${STAGE}/usr/bin/webpointcloud"

# ── 4) 데스크톱 엔트리 + 아이콘 ──
cp "${PROJECT_ROOT}/packaging/webpointcloud.desktop" "${STAGE}/usr/share/applications/"
cp "${PROJECT_ROOT}/packaging/webpointcloud.png" "${STAGE}/usr/share/icons/hicolor/256x256/apps/"

# ── 5) DEBIAN/control ──
sed "s/VERSION_PLACEHOLDER/${VERSION}/" "${PROJECT_ROOT}/packaging/control" \
    > "${STAGE}/DEBIAN/control"

# 설치 크기(KB) 계산
INSTALLED_SIZE=$(du -sk "${STAGE}" | cut -f1)
echo "Installed-Size: ${INSTALLED_SIZE}" >> "${STAGE}/DEBIAN/control"

# ── 6) 빌드 ──
echo "-- dpkg-deb 빌드 중..."
DEB_FILE="${PROJECT_ROOT}/packaging/${PKG_NAME}_${VERSION}_amd64.deb"
dpkg-deb --build --root-owner-group "${STAGE}" "${DEB_FILE}"

echo "== 완료: ${DEB_FILE} =="
ls -lh "${DEB_FILE}"
