import React, { forwardRef } from "react";
import styled from "styled-components";

const ToolbarContainer = styled.div`
  position: sticky; /* 스크롤 시 상단 고정 */
  top: 0;
  z-index: 10;
  background: #fff;
  margin: 0;
  padding: 10px;

  /* ✅ 3칸 그리드: 왼쪽(auto) | 가운데(1fr) | 오른쪽(auto) */
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  column-gap: 10px;
  border-bottom: 1px solid #eee;

  /* 화면이 좁아지면 세로로 3줄로 쌓기 */
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto; /* 왼쪽 / 가운데 / 오른쪽 순서 */
    row-gap: 6px;
  }
`;

// 왼쪽 영역
const LeftGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  @media (max-width: 900px) {
    justify-content: flex-start;
  }
`;

// ✅ 가운데 영역: 그리드의 가운데 셀, 항상 중앙 정렬
const CenterGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  justify-self: center; /* 가운데 셀 안에서 수평 중앙 */
  margin-left: 200px;

  @media (max-width: 900px) {
    /* 좁을 때도 가운데 정렬 유지 */
    justify-self: center;
  }
`;

// 오른쪽 영역
const RightGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  justify-self: end; /* 오른쪽 셀에서 오른쪽 끝 */

  @media (max-width: 900px) {
    justify-self: flex-end;
  }
`;

// 확대/축소 툴바
const ZoomToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const ZoomButton = styled.button`
  padding: 2px 6px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid #ccc;
  background: #f8f8f8;
  cursor: pointer;

  &:hover {
    background: #eee;
  }
`;

const ZoomResetButton = styled(ZoomButton)`
  font-weight: bold;
`;

const ZoomValue = styled.span`
  font-size: 12px;
  min-width: 40px;
  text-align: center;
`;

const PageNumberInput = styled.input`
  width: 60px;
  text-align: center;
  padding: 4px 6px;
`;

const PdfToolbar = forwardRef(
  (
    {
      pdfLoaded,

      // 파일 열기
      onFileChange,

      // 페이지 이동
      currentPage,
      totalPages,
      pageInput,
      onChangePageInput,
      onSubmitPageInput,
      onPrevPage,
      onNextPage,

      // 형광펜/지우개
      isHighlightMode,
      isEraseMode,
      onToggleHighlight,
      onToggleErase,

      // 검색
      searchQuery,
      onChangeSearchQuery,
      hasSearchResults,
      searchIndex,
      searchTotal,
      onSearch,
      onGotoMatch,

      // 줌
      scale,
      onZoomIn,
      onZoomOut,
      onResetZoom,
    },
    ref
  ) => {
    return (
      <ToolbarContainer ref={ref}>
        {/* 왼쪽 영역 */}
        <LeftGroup>
          {/* 파일 열기 */}
          {/* <input type="file" accept="application/pdf" onChange={onFileChange} /> */}

          {pdfLoaded && (
            <>
              {/* 형광펜 토글 */}
              <button
                type="button"
                onClick={onToggleHighlight}
                style={{
                  padding: "4px 8px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  background: isHighlightMode ? "#fff7c2" : "#f8f8f8",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                🖍 형광펜
              </button>

              {/* 지우개 토글 */}
              <button
                type="button"
                onClick={onToggleErase}
                style={{
                  padding: "4px 8px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  background: isEraseMode ? "#ffe4e4" : "#f8f8f8",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                🧽 지우개
              </button>
            </>
          )}
        </LeftGroup>

        {/* 가운데 영역: 페이지 네비게이션 */}
        {pdfLoaded && (
          <CenterGroup>
            <button
              type="button"
              onClick={onPrevPage}
              style={{ whiteSpace: "nowrap" }}
            >
              ◀ 이전
            </button>

            <PageNumberInput
              type="number"
              min={1}
              max={totalPages || 1}
              value={pageInput}
              onChange={(e) => onChangePageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSubmitPageInput();
                }
              }}
            />
            <span style={{ whiteSpace: "nowrap" }}>/ {totalPages}</span>

            <button
              type="button"
              onClick={onNextPage}
              style={{ whiteSpace: "nowrap" }}
            >
              다음 ▶
            </button>
          </CenterGroup>
        )}

        {/* 오른쪽 영역: 줌 컨트롤 */}
        {pdfLoaded && (
          <RightGroup>
            {/* 텍스트 검색 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <input
                type="text"
                placeholder="텍스트 검색"
                value={searchQuery}
                onChange={(e) => onChangeSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (!hasSearchResults) {
                      onSearch();
                    } else {
                      onGotoMatch(searchIndex + 1);
                    }
                  }
                }}
                style={{
                  fontSize: 12,
                  padding: "2px 4px",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  minWidth: 140,
                }}
              />
              <button
                type="button"
                onClick={onSearch}
                style={{
                  fontSize: 12,
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  background: "#f8f8f8",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                검색
              </button>
              <span
                style={{
                  fontSize: 11,
                  color: "#666",
                  textAlign: "center",
                }}
              >
                {hasSearchResults ? `${searchIndex + 1} / ${searchTotal}` : ""}
              </span>
            </div>
            <ZoomToolbar>
              <ZoomButton type="button" onClick={onZoomOut}>
                -
              </ZoomButton>
              <ZoomValue>{Math.round(scale * 100)}%</ZoomValue>
              <ZoomButton type="button" onClick={onZoomIn}>
                +
              </ZoomButton>
              <ZoomResetButton type="button" onClick={onResetZoom}>
                100%
              </ZoomResetButton>
            </ZoomToolbar>
          </RightGroup>
        )}
      </ToolbarContainer>
    );
  }
);

export default PdfToolbar;
