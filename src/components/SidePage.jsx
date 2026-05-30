// PageSidebar.jsx
import {
  memo,
  useRef,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
  useCallback,
} from "react";
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
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
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
  border: 1px solid #eee;
  box-sizing: border-box;
  padding: 2px;
  flex: 0 0
    ${(props) => (props.$scale ? `calc(${props.$scale * 100}% - 1px)` : "100%")};
  box-shadow: ${(props) =>
    props.$active ? "0 0 0 2px #007bff inset" : "none"};

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

function PageSidebar({
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
  onRequestThumbnail,
}) {
  const sidebarRef = useRef(null);
  const thumbnailRefs = useRef([]);

  // 🔹 현재 사이드바에서 "실제로 화면에 보이는 페이지 번호들"
  const [visiblePages, setVisiblePages] = useState(new Set());

  // 현재 파일의 북마크된 페이지 Set (조회 O(1))
  const bookmarkedPageSet = useMemo(() => {
    const set = new Set();
    if (!fileName) return set;
    for (const b of bookmarks) {
      if (b.fileName === fileName) set.add(b.page);
    }
    return set;
  }, [bookmarks, fileName]);

  const isPageBookmarked = useCallback(
    (pageNum) => bookmarkedPageSet.has(pageNum),
    [bookmarkedPageSet],
  );

  // 왼쪽 페이지 목록에서 Ctrl + 휠로 썸네일 크기 조절 (native, passive 회피)
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
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
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setThumbnailScale]);

  // 즐겨찾기만 보기 토글
  const handleToggleShowOnlyBookmarked = useCallback(() => {
    setShowOnlyBookmarked((prev) => !prev);
  }, [setShowOnlyBookmarked]);

  // 썸네일에 표시할 페이지 목록 계산
  const thumbnailPages = useMemo(() => {
    if (!totalPages) return [];
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    if (!showOnlyBookmarked || !fileName) return pages;
    return pages.filter((p) => bookmarkedPageSet.has(p));
  }, [totalPages, showOnlyBookmarked, fileName, bookmarkedPageSet]);

  // 현재 페이지로 썸네일 자동 스크롤 (짧은 디바운스로 페이지 번호 흔들림 완화)
  useLayoutEffect(() => {
    const container = sidebarRef.current;
    if (!container) return;

    const page = currentPage;
    const timer = setTimeout(() => {
      const thumb = thumbnailRefs.current[page - 1];
      if (!thumb) return;

      const containerRect = container.getBoundingClientRect();
      const thumbRect = thumb.getBoundingClientRect();

      const padding = 8;
      const isAbove = thumbRect.top < containerRect.top + padding;
      const isBelow = thumbRect.bottom > containerRect.bottom - padding;

      if (!isAbove && !isBelow) return;

      const thumbCenterOffset = thumb.offsetTop + thumb.offsetHeight / 2;
      const targetScrollTop = thumbCenterOffset - container.clientHeight / 2;

      container.scrollTo({
        top: targetScrollTop,
        behavior: "auto",
      });
    }, 48);

    return () => clearTimeout(timer);
  }, [currentPage, thumbnailPages.length, thumbnailScale]);

  // visiblePages 또는 thumbnails 변화에 따라, 보이는데 아직 비어 있는 페이지는 즉시 요청
  useEffect(() => {
    if (typeof onRequestThumbnail !== "function") return;
    visiblePages.forEach((p) => {
      if (!thumbnails?.[p - 1]) {
        onRequestThumbnail(p);
      }
    });
  }, [visiblePages, thumbnails, onRequestThumbnail]);

  // 🔹 IntersectionObserver로 "보이는 썸네일만 이미지 렌더"
  //    + 보이는 페이지의 썸네일이 비어 있으면 상위에 우선 생성을 요청
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
              // 썸네일이 아직 없으면 즉시 요청
              if (
                typeof onRequestThumbnail === "function" &&
                !thumbnails?.[page - 1]
              ) {
                onRequestThumbnail(page);
              }
            } else {
              next.delete(page);
            }
          });
          return next;
        });
      },
      {
        root: container,
        // 사용자가 스크롤하기 직전에 미리 요청해 두기
        rootMargin: "200px 0px 200px 0px",
        threshold: 0,
      },
    );

    thumbnailRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
    };
    // thumbnailPages 길이/필터/요청 콜백/썸네일 배열이 바뀔 때 재설정
  }, [
    thumbnailPages.length,
    showOnlyBookmarked,
    fileName,
    onRequestThumbnail,
    thumbnails,
  ]);

  // 접힌 상태
  if (isLeftCollapsed) {
    return (
      <LeftCollapsedTab onClick={() => setIsLeftCollapsed(false)}>
        페이지
      </LeftCollapsedTab>
    );
  }

  // 펼친 상태

  return (
    <Sidebar ref={sidebarRef}>
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
            <h3 style={{ margin: 0, color: "#333" }}>페이지</h3>

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
                <img
                  src={src}
                  alt={`Page ${pageNum}`}
                  onError={() => onRequestThumbnail?.(pageNum, true)}
                />
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

export default memo(PageSidebar);
