import { useState, useEffect, useRef, useMemo } from "react";
import styled from "styled-components";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import offSvg from "../src/svg/off.svg";
import onSvg from "../src/svg/on.svg";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// 레이아웃
const Container = styled.div`
  display: flex;
  height: 100vh;
  font-family: sans-serif;
`;

const Sidebar = styled.div`
  width: 200px;
  border-right: 1px solid #ccc;
  padding: 10px;
  overflow-y: auto;
`;

const Main = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  position: relative;
`;

const PagesWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 40px;
`;

const Toolbar = styled.div`
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

// PDF 캔버스
const Canvas = styled.canvas`
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
  margin-bottom: 20px;
`;

// 썸네일
const PageThumbnail = styled.div`
  position: relative;
  margin-bottom: 5px;
  cursor: pointer;
  border: ${(props) => (props.active ? "2px solid #007bff" : "1px solid #eee")};
  padding: 2px;

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

// 우측 사이드바
const RightSidebar = styled.div`
  width: 280px;
  border-left: 1px solid #ccc;
  padding: 10px;
  overflow-y: auto;
`;

const FileGroup = styled.div`
  margin-bottom: 16px;
`;

// 문서 제목 + 폴더 버튼 한 줄
const FileHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
`;

const FileTitle = styled.div`
  font-weight: bold;
  cursor: pointer;
  user-select: none;
`;

const AddFolderButton = styled.button`
  font-size: 11px;
  border: 1px solid #ccc;
  background: #f8f8f8;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;

  &:hover {
    background: #eee;
  }
`;

const BookmarkList = styled.ul`
  list-style: none;
  padding: 5px 0 0 10px;
  margin: 0;
`;

// 북마크 아이템
const BookmarkItem = styled.li`
  display: flex;
  flex-direction: column;
  margin-bottom: 6px;
  border-bottom: 1px solid #eee;
  padding: 4px 0;
  gap: 4px;
`;

// 1줄: 이름 / 페이지
const BookmarkHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

// 2줄: 수정·삭제 버튼 + 폴더 선택
const BookmarkMiddleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
`;

// 이름 버튼 (보기 모드)
const BookmarkLabelButton = styled.button`
  font-size: 15px;
  background: none;
  border: none;
  color: #007bff;
  cursor: pointer;
  padding: 0;
`;

// 이름 입력 (수정 모드)
const BookmarkLabelInput = styled.input`
  font-size: 15px;
  padding: 2px 4px;
  border: 1px solid #ccc;
  border-radius: 4px;
`;

const BookmarkPageText = styled.span`
  font-size: 11px;
  color: #333;
  flex-shrink: 0;
`;

// 폴더 선택 드롭다운
const FolderSelect = styled.select`
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid #ccc;
`;

// 수정/삭제 버튼 영역
const BookmarkActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const BookmarkDateRow = styled.div`
  font-size: 10px;
  color: #777;
  margin-left: 2px;
`;

const RemoveButton = styled.button`
  font-size: 11px;
  border: none;
  background: none;
  color: red;
  cursor: pointer;
`;

const ChangeButton = styled.button`
  font-size: 11px;
  border: none;
  background: none;
  color: blue;
  cursor: pointer;
`;

const CancelButton = styled.button`
  font-size: 11px;
  border: none;
  background: none;
  color: #555;
  cursor: pointer;
`;

const EmptyText = styled.p`
  color: #999;
`;

const PageNumberInput = styled.input`
  width: 60px;
  text-align: center;
  padding: 4px 6px;
`;

// 폴더 UI
const FolderWrapper = styled.li`
  margin-top: 8px;
  padding-top: 4px;
  border-top: 1px dashed #ddd;
`;

const FolderTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: bold;
  color: #555;
  margin-bottom: 2px;
`;

// 폴더 이름
const FolderName = styled.span`
  cursor: pointer;
`;

const FolderBookmarkList = styled.ul`
  list-style: none;
  padding-left: 10px;
  margin: 0;
`;

const EmptyFolderText = styled.li`
  font-size: 11px;
  color: #aaa;
  padding: 2px 0;
`;

// ✅ 폴더 토글 버튼
const FolderToggleButton = styled.button`
  border: none;
  background: none;
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
`;

// ✅ 자동 라벨 / 커스텀 라벨 처리 헬퍼
const getBookmarkDisplayLabel = (label, idx) => {
  const trimmed = (label || "").trim();
  const autoPattern = /^즐겨찾기\d+$/; // 시스템이 만든 기본 라벨 패턴

  // 라벨이 없거나, 시스템 라벨이면 index 기반으로 다시 번호 부여
  if (!trimmed || autoPattern.test(trimmed)) {
    return `즐겨찾기${idx + 1}`;
  }

  // 사용자가 바꾼 라벨은 그대로 사용
  return trimmed;
};

// 줌 상수
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const INITIAL_SCALE = 1.0;

export default function PdfViewerWithBookmarks() {
  const [pdf, setPdf] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [totalPages, setTotalPages] = useState(0);

  const [bookmarks, setBookmarks] = useState([]);
  const [fileName, setFileName] = useState("");
  const [collapsedFiles, setCollapsedFiles] = useState({});
  const [thumbnails, setThumbnails] = useState([]);

  // 폴더: { id, fileName, name, createdAt }
  const [folders, setFolders] = useState([]);

  // 확대/축소 비율
  const [scale, setScale] = useState(INITIAL_SCALE);

  const canvasRefs = useRef([]);
  const mainRef = useRef(null);
  const toolbarRef = useRef(null);
  const scrollTickingRef = useRef(false);

  // 썸네일 자동 스크롤용 ref
  const sidebarRef = useRef(null);
  const thumbnailRefs = useRef([]);

  // 현재 수정 중인 북마크
  const [editingKey, setEditingKey] = useState(null);
  const [editingLabel, setEditingLabel] = useState("");

  // ✅ 현재 수정 중인 폴더
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderName, setEditingFolderName] = useState("");

  // ✅ 폴더 접힘 상태
  const [collapsedFolders, setCollapsedFolders] = useState({});

  // 북마크 / 폴더 로드
  useEffect(() => {
    const saved = localStorage.getItem("gyul-pdf-bookmarks");
    if (saved) setBookmarks(JSON.parse(saved));

    const savedFolders = localStorage.getItem("gyul-pdf-folders");
    if (savedFolders) setFolders(JSON.parse(savedFolders));
  }, []);

  // 북마크 저장
  useEffect(() => {
    localStorage.setItem("gyul-pdf-bookmarks", JSON.stringify(bookmarks));
  }, [bookmarks]);

  // 폴더 저장
  useEffect(() => {
    localStorage.setItem("gyul-pdf-folders", JSON.stringify(folders));
  }, [folders]);

  // currentPage → 입력칸 동기화
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // 한 페이지 렌더 (현재 scale 사용)
  const renderPage = async (num, scaleValue = scale) => {
    if (!pdf) return;
    const canvas = canvasRefs.current[num - 1];
    if (!canvas) return;

    const page = await pdf.getPage(num);
    const viewport = page.getViewport({ scale: scaleValue });
    const ctx = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;
  };

  // 전체 페이지 렌더 (병렬 최적화 + scale 반영)
  useEffect(() => {
    if (!pdf || totalPages === 0) return;

    let cancelled = false;
    const MAX_CONCURRENT = 4;

    const queue = Array.from({ length: totalPages }, (_, i) => i + 1);

    const worker = async () => {
      while (!cancelled && queue.length) {
        const pageNum = queue.shift();
        try {
          await renderPage(pageNum, scale);
        } catch (e) {
          // console.error(e);
        }
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT, totalPages); i++) {
      workers.push(worker());
    }

    return () => {
      cancelled = true;
    };
  }, [pdf, totalPages, scale]);

  // 썸네일 생성 (배치 처리, 고정 0.2배)
  const generateThumbnails = async (pdfDoc) => {
    const total = pdfDoc.numPages;
    const thumbsArray = new Array(total).fill(null);
    const BATCH_SIZE = 5;

    for (let start = 1; start <= total; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, total);
      const batchPromises = [];

      for (let pageNum = start; pageNum <= end; pageNum++) {
        batchPromises.push(
          (async () => {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 0.2 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({
              canvasContext: canvas.getContext("2d"),
              viewport,
            }).promise;
            return { index: pageNum - 1, dataUrl: canvas.toDataURL() };
          })()
        );
      }

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(({ index, dataUrl }) => {
        thumbsArray[index] = dataUrl;
      });

      setThumbnails((prev) => {
        if (!prev || prev.length !== total) {
          return [...thumbsArray];
        }
        const next = [...prev];
        batchResults.forEach(({ index, dataUrl }) => {
          next[index] = dataUrl;
        });
        return next;
      });
    }
  };

  // 파일 열기
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    setPdf(pdfDoc);
    setTotalPages(pdfDoc.numPages);
    setCurrentPage(1);
    setScale(INITIAL_SCALE); // 새 파일 열 때 줌 초기화
    generateThumbnails(pdfDoc);
  };

  // Main 컨테이너 기준 offsetTop 계산해서 스크롤
  const scrollToPage = (pageNum) => {
    const canvas = canvasRefs.current[pageNum - 1];
    const container = mainRef.current;
    const toolbar = toolbarRef.current;

    if (canvas && container) {
      const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;

      let offsetTop = 0;
      let el = canvas;

      while (el && el !== container) {
        offsetTop += el.offsetTop;
        el = el.offsetParent;
      }

      container.scrollTo({
        top: offsetTop - toolbarHeight - 10,
        behavior: "smooth",
      });
    }
  };

  // 이 페이지가 북마크 되어 있는지 확인
  const isPageBookmarked = (pageNum) => {
    if (!fileName) return false;
    return bookmarks.some((b) => b.fileName === fileName && b.page === pageNum);
  };

  // 특정 페이지 북마크 토글
  const toggleBookmarkPage = (pageNum) => {
    if (!fileName) return;
    const key = `${fileName}-${pageNum}`;

    setBookmarks((prev) => {
      const exists = prev.some((b) => b.key === key);
      if (exists) {
        // 이미 있으면 제거
        return prev.filter((b) => b.key !== key);
      }

      const newBookmark = {
        key,
        fileName,
        page: pageNum,
        date: new Date().toLocaleString(),
        label: "",
        folderId: null, // 처음엔 폴더 없음
      };
      return [...prev, newBookmark];
    });
  };

  // 페이지 점프
  const jumpToPage = (pageNum) => {
    if (!pdf || totalPages === 0) return;
    const target = Math.min(Math.max(pageNum, 1), totalPages);

    renderPage(target); // 현재 scale로 렌더
    scrollToPage(target);
  };

  // 스크롤 시 현재 페이지 계산 (rAF throttle)
  const handleScroll = () => {
    const container = mainRef.current;
    const toolbar = toolbarRef.current;
    if (!container || !pdf) return;

    if (!scrollTickingRef.current) {
      scrollTickingRef.current = true;

      window.requestAnimationFrame(() => {
        scrollTickingRef.current = false;

        const containerTop = container.getBoundingClientRect().top;
        const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;

        let closestPage = 1;
        let minDiff = Infinity;

        canvasRefs.current.forEach((canvas, idx) => {
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const targetY = containerTop + toolbarHeight + 10;
          const diff = Math.abs(rect.top - targetY);

          if (diff < minDiff) {
            minDiff = diff;
            closestPage = idx + 1;
          }
        });

        setCurrentPage(closestPage);
      });
    }
  };

  // Ctrl + 마우스 휠로 줌 인/아웃
  const handleWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();

    const isZoomOut = e.deltaY > 0;
    setScale((prev) => {
      if (isZoomOut) {
        return Math.max(prev - SCALE_STEP, MIN_SCALE);
      }
      return Math.min(prev + SCALE_STEP, MAX_SCALE);
    });
  };

  // 현재 페이지가 바뀔 때, 왼쪽 썸네일을 중앙으로 스크롤
  useEffect(() => {
    if (!sidebarRef.current) return;
    const container = sidebarRef.current;
    const thumb = thumbnailRefs.current[currentPage - 1];
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
  }, [currentPage]);

  // 북마크 추가 (상단 버튼) → 현재 페이지 토글
  const addBookmark = () => {
    if (!fileName) return;
    toggleBookmarkPage(currentPage);
  };

  const removeBookmark = (key) => {
    setBookmarks((prev) => prev.filter((b) => b.key !== key));
  };

  const goToBookmark = (bm) => {
    if (fileName !== bm.fileName) {
      alert(
        "이 북마크는 다른 파일에 속해 있습니다. 먼저 해당 파일을 열어주세요."
      );
      return;
    }
    jumpToPage(bm.page);
  };

  const toggleFile = (file) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [file]: !prev[file],
    }));
  };

  // 폴더 생성
  const handleAddFolder = (file) => {
    setFolders((prev) => {
      const fileFolders = prev.filter((f) => f.fileName === file);
      const nextIndex = fileFolders.length + 1;
      const newFolder = {
        id: `${file}-folder-${Date.now()}-${nextIndex}`,
        fileName: file,
        name: `폴더${nextIndex}`,
        createdAt: new Date().toLocaleString(),
      };
      return [...prev, newFolder];
    });
  };

  // ✅ 폴더 이름 수정 시작
  const startEditFolder = (folder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  // ✅ 폴더 이름 저장
  const saveEditFolder = (folderId) => {
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId
          ? { ...f, name: editingFolderName.trim() || f.name }
          : f
      )
    );
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  // ✅ 폴더 이름 수정 취소
  const cancelEditFolder = () => {
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  // ✅ 폴더 접기/펼치기 토글
  const toggleFolderCollapse = (folderId) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  // 북마크 폴더 변경
  const handleChangeBookmarkFolder = (bookmarkKey, folderId) => {
    setBookmarks((prev) =>
      prev.map((bm) =>
        bm.key === bookmarkKey ? { ...bm, folderId: folderId || null } : bm
      )
    );
  };

  // 북마크 이름 수정 시작
  const startEditBookmark = (bm, displayLabel) => {
    setEditingKey(bm.key);
    setEditingLabel(displayLabel);
  };

  // 북마크 이름 저장
  const saveEditBookmark = (key) => {
    setBookmarks((prev) =>
      prev.map((bm) =>
        bm.key === key ? { ...bm, label: editingLabel.trim() } : bm
      )
    );
    setEditingKey(null);
    setEditingLabel("");
  };

  // 북마크 이름 수정 취소
  const cancelEditBookmark = () => {
    setEditingKey(null);
    setEditingLabel("");
  };

  const groupedBookmarks = useMemo(() => {
    return bookmarks.reduce((acc, bm) => {
      if (!acc[bm.fileName]) acc[bm.fileName] = [];
      acc[bm.fileName].push(bm);
      return acc;
    }, {});
  }, [bookmarks]);

  const foldersByFile = useMemo(() => {
    return folders.reduce((acc, folder) => {
      if (!acc[folder.fileName]) acc[folder.fileName] = [];
      acc[folder.fileName].push(folder);
      return acc;
    }, {});
  }, [folders]);

  // 확대/축소 버튼 핸들러
  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  };

  const handleResetZoom = () => {
    setScale(INITIAL_SCALE);
  };

  return (
    <Container>
      {/* 왼쪽 썸네일 */}
      <Sidebar ref={sidebarRef}>
        <h3>📄 페이지</h3>
        {thumbnails.map((src, idx) => {
          const pageNum = idx + 1;
          const bookmarked = isPageBookmarked(pageNum);

          return (
            <PageThumbnail
              key={idx}
              ref={(el) => (thumbnailRefs.current[idx] = el)}
              active={currentPage === pageNum}
              onClick={() => jumpToPage(pageNum)}
            >
              {/* 썸네일 상단 북마크 아이콘 */}
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

              <img src={src} alt={`Page ${pageNum}`} />
              <ThumbnailPageNumber>{pageNum}</ThumbnailPageNumber>
            </PageThumbnail>
          );
        })}
      </Sidebar>

      {/* 중앙 본문 */}
      <Main ref={mainRef} onScroll={handleScroll} onWheel={handleWheel}>
        <Toolbar ref={toolbarRef}>
          <input type="file" accept="application/pdf" onChange={handleFile} />
          {pdf && (
            <>
              <button
                onClick={() => {
                  if (currentPage > 1) {
                    jumpToPage(currentPage - 1);
                  }
                }}
              >
                ◀ 이전
              </button>

              <PageNumberInput
                type="number"
                min={1}
                max={totalPages || 1}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const num = Number(pageInput);
                    if (!Number.isNaN(num)) {
                      jumpToPage(num);
                    }
                  }
                }}
              />
              <span>/ {totalPages}</span>

              <button
                onClick={() => {
                  if (currentPage < totalPages) {
                    jumpToPage(currentPage + 1);
                  }
                }}
              >
                다음 ▶
              </button>

              <button onClick={addBookmark}>⭐ 북마크 추가</button>

              {/* 오른쪽 끝 확대/축소 컨트롤 */}
              <ZoomToolbar>
                <ZoomButton type="button" onClick={handleZoomOut}>
                  -
                </ZoomButton>
                <ZoomValue>{Math.round(scale * 100)}%</ZoomValue>
                <ZoomButton type="button" onClick={handleZoomIn}>
                  +
                </ZoomButton>
                <ZoomResetButton type="button" onClick={handleResetZoom}>
                  100%
                </ZoomResetButton>
              </ZoomToolbar>
            </>
          )}
        </Toolbar>

        <PagesWrapper>
          {pdf &&
            Array.from({ length: totalPages }, (_, i) => (
              <Canvas key={i} ref={(el) => (canvasRefs.current[i] = el)} />
            ))}
        </PagesWrapper>
      </Main>

      {/* 오른쪽 북마크 */}
      <RightSidebar>
        <h3>📑 즐겨찾기</h3>
        {bookmarks.length === 0 && (
          <EmptyText>저장된 즐겨찾기가 없습니다.</EmptyText>
        )}

        {Object.entries(groupedBookmarks).map(([file, bms]) => {
          const fileFolders = foldersByFile[file] || [];

          // 이 파일의 북마크들에 대해 index 맵(번호 매기기용) 만들기
          const indexMap = {};
          bms.forEach((bm, index) => {
            indexMap[bm.key] = index;
          });

          const bookmarksWithoutFolder = bms.filter((bm) => !bm.folderId);

          const bookmarksByFolderId = {};
          fileFolders.forEach((folder) => {
            bookmarksByFolderId[folder.id] = [];
          });
          bms.forEach((bm) => {
            if (bm.folderId && bookmarksByFolderId[bm.folderId]) {
              bookmarksByFolderId[bm.folderId].push(bm);
            }
          });

          return (
            <FileGroup key={file}>
              <FileHeaderRow>
                <FileTitle onClick={() => toggleFile(file)}>
                  {collapsedFiles[file] ? "▶" : "▼"} {file}
                </FileTitle>

                <AddFolderButton
                  type="button"
                  onClick={() => handleAddFolder(file)}
                >
                  + 폴더
                </AddFolderButton>
              </FileHeaderRow>

              {!collapsedFiles[file] && (
                <BookmarkList>
                  {/* 1) 폴더들 (항상 위에 출력) */}
                  {fileFolders.map((folder) => {
                    const folderBookmarks =
                      bookmarksByFolderId[folder.id] || [];
                    const isFolderCollapsed = collapsedFolders[folder.id];

                    return (
                      <FolderWrapper key={folder.id}>
                        <FolderTitleRow>
                          {/* 왼쪽: 폴더 토글 + 이름/입력 */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <FolderToggleButton
                              type="button"
                              onClick={() => toggleFolderCollapse(folder.id)}
                            >
                              {isFolderCollapsed ? "▶" : "▼"}
                            </FolderToggleButton>

                            {editingFolderId === folder.id ? (
                              <BookmarkLabelInput
                                autoFocus
                                value={editingFolderName}
                                onChange={(e) =>
                                  setEditingFolderName(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    saveEditFolder(folder.id);
                                  }
                                  if (e.key === "Escape") {
                                    cancelEditFolder();
                                  }
                                }}
                              />
                            ) : (
                              <FolderName
                                onClick={() => startEditFolder(folder)}
                              >
                                {folder.name}
                              </FolderName>
                            )}
                          </div>

                          {/* 오른쪽: 폴더 내 북마크 개수 + 버튼들 */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 10,
                              color: "#999",
                            }}
                          >
                            <span>{folderBookmarks.length}개</span>

                            {editingFolderId === folder.id ? (
                              <>
                                <ChangeButton
                                  onClick={() => saveEditFolder(folder.id)}
                                >
                                  저장
                                </ChangeButton>
                                <CancelButton onClick={cancelEditFolder}>
                                  취소
                                </CancelButton>
                              </>
                            ) : (
                              <ChangeButton
                                onClick={() => startEditFolder(folder)}
                              >
                                이름변경
                              </ChangeButton>
                            )}
                          </div>
                        </FolderTitleRow>

                        {/* 폴더 내용: 접혀있지 않을 때만 표시 */}
                        {!isFolderCollapsed && (
                          <FolderBookmarkList>
                            {folderBookmarks.length === 0 ? (
                              <EmptyFolderText>
                                이 폴더에 즐겨찾기가 없습니다.
                              </EmptyFolderText>
                            ) : (
                              folderBookmarks.map((bm) => {
                                const displayLabel = getBookmarkDisplayLabel(
                                  bm.label,
                                  indexMap[bm.key]
                                );

                                return (
                                  <BookmarkItem key={bm.key}>
                                    {/* 1줄: 제목 + 페이지 */}
                                    <BookmarkHeader>
                                      {editingKey === bm.key ? (
                                        <BookmarkLabelInput
                                          autoFocus
                                          value={editingLabel}
                                          onChange={(e) =>
                                            setEditingLabel(e.target.value)
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              saveEditBookmark(bm.key);
                                            }
                                            if (e.key === "Escape") {
                                              cancelEditBookmark();
                                            }
                                          }}
                                        />
                                      ) : (
                                        <BookmarkLabelButton
                                          onClick={() => goToBookmark(bm)}
                                        >
                                          📘 {displayLabel}
                                        </BookmarkLabelButton>
                                      )}

                                      <BookmarkPageText>
                                        {bm.page}p
                                      </BookmarkPageText>
                                    </BookmarkHeader>

                                    {/* 2줄: 수정/삭제 버튼 + 폴더 선택 */}
                                    <BookmarkMiddleRow>
                                      <BookmarkActions>
                                        {editingKey === bm.key ? (
                                          <>
                                            <ChangeButton
                                              onClick={() =>
                                                saveEditBookmark(bm.key)
                                              }
                                            >
                                              저장
                                            </ChangeButton>
                                            <CancelButton
                                              onClick={cancelEditBookmark}
                                            >
                                              취소
                                            </CancelButton>
                                            <RemoveButton
                                              onClick={() =>
                                                removeBookmark(bm.key)
                                              }
                                            >
                                              삭제
                                            </RemoveButton>
                                          </>
                                        ) : (
                                          <>
                                            <ChangeButton
                                              onClick={() =>
                                                startEditBookmark(
                                                  bm,
                                                  displayLabel
                                                )
                                              }
                                            >
                                              수정
                                            </ChangeButton>
                                            <RemoveButton
                                              onClick={() =>
                                                removeBookmark(bm.key)
                                              }
                                            >
                                              삭제
                                            </RemoveButton>
                                          </>
                                        )}
                                      </BookmarkActions>

                                      <FolderSelect
                                        value={bm.folderId || ""}
                                        onChange={(e) =>
                                          handleChangeBookmarkFolder(
                                            bm.key,
                                            e.target.value
                                          )
                                        }
                                      >
                                        <option value="">(폴더 없음)</option>
                                        {fileFolders.map((f) => (
                                          <option key={f.id} value={f.id}>
                                            {f.name}
                                          </option>
                                        ))}
                                      </FolderSelect>
                                    </BookmarkMiddleRow>

                                    {/* 3줄: 생성 날짜 */}
                                    <BookmarkDateRow>{bm.date}</BookmarkDateRow>
                                  </BookmarkItem>
                                );
                              })
                            )}
                          </FolderBookmarkList>
                        )}
                      </FolderWrapper>
                    );
                  })}

                  {/* 2) 폴더에 속하지 않은 즐겨찾기들 (항상 아래에 출력) */}
                  {bookmarksWithoutFolder.map((bm) => {
                    const displayLabel = getBookmarkDisplayLabel(
                      bm.label,
                      indexMap[bm.key]
                    );

                    return (
                      <BookmarkItem key={bm.key}>
                        {/* 1줄: 제목 + 페이지 */}
                        <BookmarkHeader>
                          {editingKey === bm.key ? (
                            <BookmarkLabelInput
                              autoFocus
                              value={editingLabel}
                              onChange={(e) => setEditingLabel(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  saveEditBookmark(bm.key);
                                }
                                if (e.key === "Escape") {
                                  cancelEditBookmark();
                                }
                              }}
                            />
                          ) : (
                            <BookmarkLabelButton
                              onClick={() => goToBookmark(bm)}
                            >
                              📘 {displayLabel}
                            </BookmarkLabelButton>
                          )}

                          <BookmarkPageText>{bm.page}p</BookmarkPageText>
                        </BookmarkHeader>

                        {/* 2줄: 수정/삭제 버튼 + 폴더 선택 */}
                        <BookmarkMiddleRow>
                          <BookmarkActions>
                            {editingKey === bm.key ? (
                              <>
                                <ChangeButton
                                  onClick={() => saveEditBookmark(bm.key)}
                                >
                                  저장
                                </ChangeButton>
                                <CancelButton onClick={cancelEditBookmark}>
                                  취소
                                </CancelButton>
                                <RemoveButton
                                  onClick={() => removeBookmark(bm.key)}
                                >
                                  삭제
                                </RemoveButton>
                              </>
                            ) : (
                              <>
                                <ChangeButton
                                  onClick={() =>
                                    startEditBookmark(bm, displayLabel)
                                  }
                                >
                                  수정
                                </ChangeButton>
                                <RemoveButton
                                  onClick={() => removeBookmark(bm.key)}
                                >
                                  삭제
                                </RemoveButton>
                              </>
                            )}
                          </BookmarkActions>

                          <FolderSelect
                            value={bm.folderId || ""}
                            onChange={(e) =>
                              handleChangeBookmarkFolder(bm.key, e.target.value)
                            }
                          >
                            <option value="">(폴더 없음)</option>
                            {fileFolders.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folder.name}
                              </option>
                            ))}
                          </FolderSelect>
                        </BookmarkMiddleRow>

                        {/* 3줄: 생성 날짜 */}
                        <BookmarkDateRow>{bm.date}</BookmarkDateRow>
                      </BookmarkItem>
                    );
                  })}
                </BookmarkList>
              )}
            </FileGroup>
          );
        })}
      </RightSidebar>
    </Container>
  );
}
