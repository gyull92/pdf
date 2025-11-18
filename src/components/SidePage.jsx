// PageSidebar.jsx
import { useRef, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import offSvg from "../svg/off.svg";
import onSvg from "../svg/on.svg";

// ------ 스타일 ------

const Sidebar = styled.div`
  width: 185px;
  border-right: 1px solid #ccc;
  padding: 0 10px 10px 10px;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: auto;
  flex-shrink: 0;
  background: #fff;
`;

const SidebarHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  background: #fff;
  padding: 8px 0 12px;
  box-shadow: 0 2px 2px rgba(0, 0, 0, 0.04);
`;

const ThumbnailsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  column-gap: 2px;
  row-gap: 2px;
`;

const LeftCollapsedTab = styled.div`
  width: 24px;
  background: #f0f0f0;
  border-right: 1px solid #ccc;
  display: flex;
  align-items: center;
  justify-content: center;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
  user-select: none;

  &:hover {
    background: #e4e4e4;
  }
`;

const PageThumbnail = styled.div`
  position: relative;
  margin-bottom: 5px;
  cursor: pointer;
  border: ${(props) =>
    props.$active ? "2px solid #007bff" : "1px solid #eee"};
  padding: 2px;
  box-sizing: border-box;
  flex: 0 0
    ${(props) => (props.$scale ? `calc(${props.$scale * 100}% - 1px)` : "100%")};

  img {
    width: 100%;
    display: block;
  }
`;

const ThumbnailPageNumber = styled.div`
  text-align: center;
  font-size: 12px;
`;

const ThumbnailIconButton = styled.button`
  position: absolute;
  top: 4px;
  right: 4px;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
`;

const ThumbnailIcon = styled.img`
  width: 30px;
  height: 30px;
  display: block;
`;

// ------ 컴포넌트 ------

export default function PageSidebar({
  totalPages,
  currentPage,
  thumbnails,
  fileName,
  bookmarks,
  isLeftCollapsed,
  setIsLeftCollapsed,
  showOnlyBookmarked,
  setShowOnlyBookmarked,
  thumbnailScale,
  setThumbnailScale,
  jumpToPage,
  toggleBookmarkPage,
}) {
  const sidebarRef = useRef(null);
  const thumbnailRefs = useRef([]);

  // 🔹 현재 사이드바에서 "실제로 화면에 보이는 페이지 번호들"
  const [visiblePages, setVisiblePages] = useState(new Set());

  // 해당 페이지가 즐겨찾기인지 여부
  const isPageBookmarked = (pageNum) => {
    if (!fileName) return false;
    return bookmarks.some((b) => b.fileName === fileName && b.page === pageNum);
  };

  // 왼쪽 페이지 목록에서 Ctrl + 휠로 썸네일 크기 조절
  const handleSidebarWheel = (e) => {
    if (!e.ctrlKey) return;

    if (e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();

    const isZoomOut = e.deltaY > 0;

    setThumbnailScale((prev) => {
      const MIN = 0.5;
      const MAX = 2.0;
      let next = isZoomOut ? prev - 0.1 : prev + 0.1;
      if (next < MIN) next = MIN;
      if (next > MAX) next = MAX;
      return Number(next.toFixed(2));
    });
  };

  // 즐겨찾기만 보기 토글
  const handleToggleShowOnlyBookmarked = () => {
    setShowOnlyBookmarked((prev) => !prev);
  };

  // 썸네일에 표시할 페이지 목록 계산 (useMemo로 최적화)
  const thumbnailPages = useMemo(() => {
    if (!totalPages) return [];
    let pages = Array.from({ length: totalPages }, (_, i) => i + 1);

    if (!showOnlyBookmarked || !fileName) return pages;

    const bookmarkedPages = bookmarks
      .filter((b) => b.fileName === fileName)
      .map((b) => b.page);

    const pageSet = new Set(bookmarkedPages);
    const filtered = pages.filter((p) => pageSet.has(p));

    filtered.sort((a, b) => a - b);
    return filtered;
  }, [totalPages, showOnlyBookmarked, fileName, bookmarks]);

  // 현재 페이지로 썸네일 자동 스크롤
  useEffect(() => {
    if (!sidebarRef.current) return;
    const container = sidebarRef.current;
    const idx = currentPage - 1;
    const thumb = thumbnailRefs.current[idx];
    if (!thumb) return;

    const containerRect = container.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();

    const thumbCenterOffset =
      thumbRect.top -
      containerRect.top +
      container.scrollTop +
      thumbRect.height / 2;

    const targetScrollTop = thumbCenterOffset - container.clientHeight / 2;

    container.scrollTo({
      top: targetScrollTop,
      behavior: "smooth",
    });
  }, [currentPage, totalPages]);

  // 🔹 IntersectionObserver로 "보이는 썸네일만 이미지 렌더"하기
  useEffect(() => {
    if (!sidebarRef.current) return;
    const container = sidebarRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          entries.forEach((entry) => {
            const page = Number(entry.target.dataset.page);
            if (!page) return;
            if (entry.isIntersecting) {
              next.add(page);
            } else {
              next.delete(page);
            }
          });
          return next;
        });
      },
      {
        root: container,
        threshold: 0.1,
      }
    );

    thumbnailRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
    };
    // thumbnailPages 길이나 필터링 상태가 바뀔 때만 재설정
  }, [thumbnailPages.length, showOnlyBookmarked, fileName]);

  // 접힌 상태
  if (isLeftCollapsed) {
    return (
      <LeftCollapsedTab onClick={() => setIsLeftCollapsed(false)}>
        페이지
      </LeftCollapsedTab>
    );
  }

  // 펼친 상태
  // 🔹 렌더 시작 전에 refs 초기화해서 stale ref 방지
  thumbnailRefs.current = [];

  return (
    <Sidebar ref={sidebarRef} onWheel={handleSidebarWheel}>
      <SidebarHeader>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <h3 style={{ margin: 0 }}>페이지</h3>

            {/* 즐겨찾기 토글 버튼 */}
            <button
              type="button"
              onClick={handleToggleShowOnlyBookmarked}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                padding: 0,
              }}
              title={
                showOnlyBookmarked ? "모든 페이지 보기" : "즐겨찾기만 보기"
              }
            >
              <img
                src={showOnlyBookmarked ? onSvg : offSvg}
                alt={
                  showOnlyBookmarked ? "즐겨찾기만 보기" : "전체 페이지 보기"
                }
                style={{ width: 20, height: 20 }}
              />
            </button>
          </div>

          <button
            type="button"
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 12,
            }}
            onClick={() => setIsLeftCollapsed(true)}
          >
            접기
          </button>
        </div>
      </SidebarHeader>

      <ThumbnailsContainer>
        {thumbnailPages.map((pageNum) => {
          const idx = pageNum - 1;
          const src = thumbnails[idx];
          const bookmarked = isPageBookmarked(pageNum);
          const isVisible = visiblePages.has(pageNum);

          return (
            <PageThumbnail
              key={pageNum}
              data-page={pageNum}
              ref={(el) => {
                thumbnailRefs.current[idx] = el;
              }}
              $active={currentPage === pageNum}
              $scale={thumbnailScale}
              onClick={() => jumpToPage(pageNum)}
            >
              <ThumbnailIconButton
                onClick={(e) => {
                  e.stopPropagation();
                  toggleBookmarkPage(pageNum);
                }}
              >
                <ThumbnailIcon
                  src={bookmarked ? onSvg : offSvg}
                  alt={bookmarked ? "bookmarked" : "not bookmarked"}
                />
              </ThumbnailIconButton>

              {src && isVisible ? (
                <img src={src} alt={`Page ${pageNum}`} />
              ) : (
                <div
                  style={{
                    width: "100%",
                    paddingTop: "141%",
                    background: "#f5f5f5",
                    fontSize: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#999",
                  }}
                >
                  로딩 중...
                </div>
              )}

              <ThumbnailPageNumber>{pageNum}</ThumbnailPageNumber>
            </PageThumbnail>
          );
        })}
      </ThumbnailsContainer>
    </Sidebar>
  );
}
