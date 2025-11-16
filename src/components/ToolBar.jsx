import React, { forwardRef } from "react";
import styled from "styled-components";

const ToolbarContainer = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  background: #fff;
  margin: 0;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  border-bottom: 1px solid #eee;
`;

// 확대/축소 툴바
const ZoomToolbar = styled.div`
  margin-left: auto;
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
        {/* 파일 열기 */}
        <input type="file" accept="application/pdf" onChange={onFileChange} />

        {pdfLoaded && (
          <>
            {/* 페이지 이동 */}
            <button type="button" onClick={onPrevPage}>
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
            <span>/ {totalPages}</span>

            <button type="button" onClick={onNextPage}>
              다음 ▶
            </button>

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
                cursor: "pointer",
              }}
            >
              🖍 형광펜 {isHighlightMode ? "ON" : "OFF"}
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
                cursor: "pointer",
              }}
            >
              🧽 지우개 {isEraseMode ? "ON" : "OFF"}
            </button>

            {/* 텍스트 검색 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                marginLeft: 8,
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
              <button
                type="button"
                disabled={!hasSearchResults}
                onClick={() => onGotoMatch(searchIndex - 1)}
                style={{
                  fontSize: 12,
                  padding: "2px 4px",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  background: hasSearchResults ? "#f8f8f8" : "#f0f0f0",
                  cursor: hasSearchResults ? "pointer" : "default",
                }}
              >
                ◀
              </button>
              <button
                type="button"
                disabled={!hasSearchResults}
                onClick={() => onGotoMatch(searchIndex + 1)}
                style={{
                  fontSize: 12,
                  padding: "2px 4px",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  background: hasSearchResults ? "#f8f8f8" : "#f0f0f0",
                  cursor: hasSearchResults ? "pointer" : "default",
                }}
              >
                ▶
              </button>
            </div>

            {/* 줌 컨트롤 */}
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
          </>
        )}
      </ToolbarContainer>
    );
  }
);

export default PdfToolbar;
