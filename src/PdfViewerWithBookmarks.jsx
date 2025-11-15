import { useState, useEffect, useRef } from "react";
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
  border: 2px dashed ${(props) => (props.$dragOver ? "#4a90e2" : "transparent")};
`;

const Sidebar = styled.div`
  width: 200px;
  border-right: 1px solid #ccc;
  padding: 10px;
  overflow-y: auto;
  flex-shrink: 0;
`;

// 왼쪽 접힘 탭
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

// 오른쪽 접힘 탭
const RightCollapsedTab = styled.div`
  width: 24px;
  background: #f0f0f0;
  border-left: 1px solid #ccc;
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

// 형광펜 / 지우개 모드일 때 커서 변경
const Main = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  position: relative;
  cursor: ${(props) => (props.$highlight ? "crosshair" : "default")};
`;

const PagesWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 40px;
`;

// 각 페이지 컨테이너 (캔버스 + 텍스트 레이어)
const PageContainer = styled.div`
  position: relative;
  margin-bottom: 20px;
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
  cursor: ${(props) => (props.$highlight ? "crosshair" : "default")};
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

// 우측 사이드바 (리사이즈 가능)
const RightSidebar = styled.div`
  width: ${(props) => props.$width}px;
  border-left: 1px solid #ccc;
  padding: 10px;
  overflow-y: auto;
  flex-shrink: 0;
`;

const EmptyText = styled.p`
  color: #999;
  font-size: 12px;
`;

const BookmarkItem = styled.li`
  display: flex;
  flex-direction: column;
  margin-bottom: 6px;
  border-bottom: 1px solid #eee;
  padding: 4px 0;
  gap: 4px;
`;

const BookmarkHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const BookmarkMiddleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
`;

const BookmarkLabelButton = styled.button`
  font-size: 15px;
  background: none;
  border: none;
  color: #007bff;
  cursor: pointer;
  padding: 0;
  text-align: left;
`;

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

const BookmarkDateRow = styled.div`
  font-size: 10px;
  color: #777;
  margin-left: 2px;
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
  margin-bottom: 4px;
`;

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

const FolderList = styled.ul`
  list-style: none;
  padding-left: 0;
  margin: 8px 0 16px;
`;

const FolderToggleButton = styled.button`
  border: none;
  background: none;
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
`;

const AddFolderButton = styled.button`
  font-size: 11px;
  border: 1px solid #ccc;
  background: #f8f8f8;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  margin-bottom: 4px;

  &:hover {
    background: #eee;
  }
`;

// 폴더 삭제 버튼 (컨텍스트 메뉴용 텍스트 스타일)
const DeleteFolderButton = styled.button`
  font-size: 11px;
  border: none;
  background: none;
  color: #c00;
  cursor: pointer;
`;

// 컨텍스트 메뉴
const ContextMenu = styled.ul`
  position: fixed;
  top: ${(props) => props.$y}px;
  left: ${(props) => props.$x}px;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: #ffffff;
  border: 1px solid #ccc;
  border-radius: 4px;
  min-width: 140px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 9999;
`;

const ContextMenuItem = styled.li`
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: #f0f0f0;
  }
`;

// 폴더 선택 모달
const DialogOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
`;

const Dialog = styled.div`
  background: #fff;
  padding: 16px 20px;
  border-radius: 8px;
  min-width: 260px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
`;

const DialogTitle = styled.h4`
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: bold;
  color: #333;
`;

const DialogSelect = styled.select`
  width: 100%;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid #ccc;
  margin-top: 4px;
`;

const DialogActions = styled.div`
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const DialogButton = styled.button`
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #ccc;
  background: #f8f8f8;
  cursor: pointer;

  &:hover {
    background: #eee;
  }
`;

// 오른쪽 리사이즈 핸들
const RightResizeHandle = styled.div`
  width: 4px;
  cursor: col-resize;
  background: #ddd;
  flex-shrink: 0;
  align-self: stretch;

  &:hover {
    background: #ccc;
  }
`;

// 자동 라벨 / 커스텀 라벨 처리 헬퍼
const getBookmarkDisplayLabel = (label, idx) => {
  const trimmed = (label || "").trim();

  // label이 비어 있을 때만 자동으로 "즐겨찾기N" 생성
  if (!trimmed) {
    return `즐겨찾기${idx + 1}`;
  }

  // 한 번이라도 사용자가 입력한 값은 그대로 사용
  return trimmed;
};

// 줌 상수
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const INITIAL_SCALE = 1.0;

// 형광펜 색상
const DEFAULT_HIGHLIGHT_COLOR = "rgba(255, 255, 0, 0.35)";

// PDF 페이지 위에 텍스트 레이어(span들)를 직접 그리는 헬퍼
const renderTextLayerOnPage = async (page, viewport, container) => {
  if (!container) return;

  const textContent = await page.getTextContent();

  container.innerHTML = "";
  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;
  container.style.position = "absolute";
  container.style.left = "0";
  container.style.top = "0";
  container.style.pointerEvents = "none";

  const textItems = textContent.items || [];
  const styles = textContent.styles || {};

  const frag = document.createDocumentFragment();

  textItems.forEach((item) => {
    const text = item.str || "";
    if (!text) return;

    const mm = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(mm[2], mm[3]);
    const x = mm[4];
    const y = mm[5];

    const span = document.createElement("span");
    span.textContent = text;
    span.style.position = "absolute";
    span.style.whiteSpace = "pre";
    span.style.fontSize = `${fontHeight}px`;

    const font = styles[item.fontName];
    if (font && font.fontFamily) {
      span.style.fontFamily = font.fontFamily;
    }

    span.style.left = `${x}px`;
    span.style.top = `${y - fontHeight}px`;

    frag.appendChild(span);
  });

  container.appendChild(frag);
};

export default function PdfViewerWithBookmarks() {
  const [pdf, setPdf] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [totalPages, setTotalPages] = useState(0);

  const [bookmarks, setBookmarks] = useState([]);
  const [fileName, setFileName] = useState("");
  const [thumbnails, setThumbnails] = useState([]);

  // 페이지 텍스트 (텍스트 검색용)
  const [pageTexts, setPageTexts] = useState([]);

  // 검색 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState([]); // { page, start, end }
  const [searchIndex, setSearchIndex] = useState(0);

  // 전역 폴더
  const [folders, setFolders] = useState([]);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState({});

  // 확대/축소
  const [scale, setScale] = useState(INITIAL_SCALE);

  // 오른쪽 사이드바 너비 상태
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const rightDragActiveRef = useRef(false);
  const rightDragStartXRef = useRef(0);
  const rightDragStartWidthRef = useRef(320);

  // 왼쪽/오른쪽 접힘 상태
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);

  // 🔵 드래그 오버 상태
  const [isDragOver, setIsDragOver] = useState(false);

  const canvasRefs = useRef([]);
  const textLayerRefs = useRef([]); // 텍스트 레이어 ref
  const mainRef = useRef(null);
  const toolbarRef = useRef(null);
  const scrollTickingRef = useRef(false);

  const sidebarRef = useRef(null);
  const thumbnailRefs = useRef([]);

  const [editingKey, setEditingKey] = useState(null);
  const [editingLabel, setEditingLabel] = useState("");

  // 형광펜 / 지우개 상태
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [isEraseMode, setIsEraseMode] = useState(false);
  const [highlights, setHighlights] = useState([]); // {id,fileName,page,x,y,width,height,color}
  const highlightStartRef = useRef(null);

  // PDF 문서 캐시 (세션 동안만 유지)
  const pdfCacheRef = useRef({});

  // 썸네일 렌더 세대 관리 (파일 전환시 이전 비동기 결과 무시)
  const thumbnailGenerationRef = useRef(0);

  // 컨텍스트 메뉴 상태
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    type: null, // 'folder' | 'bookmark'
    target: null, // { folderId } or { key }
  });

  // 폴더 변경 모달 상태
  const [folderDialog, setFolderDialog] = useState({
    visible: false,
    bookmarkKey: null,
    value: "",
  });

  useEffect(() => {
    const preventDefault = (e) => {
      e.preventDefault();
    };

    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", preventDefault);

    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
    };
  }, []);

  // 로컬 스토리지 로드
  useEffect(() => {
    const saved = localStorage.getItem("gyul-pdf-bookmarks");
    if (saved) setBookmarks(JSON.parse(saved));

    const savedFolders = localStorage.getItem("gyul-pdf-folders");
    if (savedFolders) setFolders(JSON.parse(savedFolders));

    const savedHighlights = localStorage.getItem("gyul-pdf-highlights");
    if (savedHighlights) setHighlights(JSON.parse(savedHighlights));
  }, []);

  // 저장
  useEffect(() => {
    localStorage.setItem("gyul-pdf-bookmarks", JSON.stringify(bookmarks));
  }, [bookmarks]);

  useEffect(() => {
    localStorage.setItem("gyul-pdf-folders", JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    localStorage.setItem("gyul-pdf-highlights", JSON.stringify(highlights));
  }, [highlights]);

  // 페이지 입력 동기화
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // Ctrl+Z 되돌리기 (현재 파일의 마지막 형광펜 삭제)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHighlights((prev) => {
          if (!fileName) return prev;
          let targetIndex = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].fileName === fileName) {
              targetIndex = i;
              break;
            }
          }
          if (targetIndex === -1) return prev;
          const next = [...prev];
          next.splice(targetIndex, 1);
          return next;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fileName]);

  // 컨텍스트 메뉴 닫기 (어디든 클릭/스크롤 시)
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu((prev) =>
        prev.visible
          ? { visible: false, x: 0, y: 0, type: null, target: null }
          : prev
      );
    };

    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("scroll", handleGlobalClick, true);

    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("scroll", handleGlobalClick, true);
    };
  }, []);

  // 오른쪽 사이드바 리사이즈용 전역 mousemove / mouseup
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!rightDragActiveRef.current || isRightCollapsed) return;

      const delta = rightDragStartXRef.current - e.clientX;
      const MIN_WIDTH = 200;
      const MAX_WIDTH = 600;

      let newWidth = rightDragStartWidthRef.current + delta;
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;

      setRightSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (rightDragActiveRef.current) {
        rightDragActiveRef.current = false;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isRightCollapsed]);

  const handleRightResizeMouseDown = (e) => {
    e.preventDefault();
    if (isRightCollapsed) return;
    rightDragActiveRef.current = true;
    rightDragStartXRef.current = e.clientX;
    rightDragStartWidthRef.current = rightSidebarWidth;
  };

  // 형광펜 영역 그리기
  const drawHighlightsForPage = (pageNum) => {
    if (!pdf) return;
    const canvas = canvasRefs.current[pageNum - 1];
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pageHighlights = highlights.filter(
      (h) => h.fileName === fileName && h.page === pageNum
    );
    if (pageHighlights.length === 0) return;

    ctx.save();
    pageHighlights.forEach((h) => {
      const x = h.x * canvas.width;
      const y = h.y * canvas.height;
      const w = h.width * canvas.width;
      const hgt = h.height * canvas.height;
      ctx.fillStyle = h.color || DEFAULT_HIGHLIGHT_COLOR;
      ctx.fillRect(x, y, w, hgt);
    });
    ctx.restore();
  };

  // 검색된 텍스트만 하이라이트
  const applySearchHighlightForPage = (pageNum) => {
    const q = searchQuery.trim();
    if (!q) return;

    const textLayerDiv = textLayerRefs.current[pageNum - 1];
    if (!textLayerDiv) return;

    const lowerQ = q.toLowerCase();
    const spans = textLayerDiv.querySelectorAll("span");

    spans.forEach((span) => {
      const fullText = span.textContent || "";
      const lowerText = fullText.toLowerCase();

      let index = lowerText.indexOf(lowerQ);
      if (index === -1) return;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;

      while (index !== -1) {
        if (index > lastIndex) {
          frag.appendChild(
            document.createTextNode(fullText.slice(lastIndex, index))
          );
        }
        const mark = document.createElement("span");
        mark.textContent = fullText.slice(index, index + q.length);
        mark.style.backgroundColor = "rgba(10, 59, 255, 1)";
        frag.appendChild(mark);
        lastIndex = index + q.length;
        index = lowerText.indexOf(lowerQ, lastIndex);
      }

      if (lastIndex < fullText.length) {
        frag.appendChild(document.createTextNode(fullText.slice(lastIndex)));
      }

      span.innerHTML = "";
      span.appendChild(frag);
    });
  };

  // 한 페이지 렌더
  const renderPage = async (num, scaleValue = scale) => {
    if (!pdf) return;
    const canvas = canvasRefs.current[num - 1];
    const textLayerDiv = textLayerRefs.current[num - 1];
    if (!canvas || !textLayerDiv) return;

    const page = await pdf.getPage(num);
    const viewport = page.getViewport({ scale: scaleValue });
    const ctx = canvas.getContext("2d");

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    await renderTextLayerOnPage(page, viewport, textLayerDiv);

    drawHighlightsForPage(num);
    applySearchHighlightForPage(num);
  };

  // 전체 페이지 렌더
  useEffect(() => {
    if (!pdf || totalPages === 0) return;

    let cancelled = false;
    const MAX_CONCURRENT = 4;
    const queue = Array.from({ length: totalPages }, (_, i) => i + 1);

    const worker = async () => {
      while (!cancelled && queue.length) {
        const pageNum = queue.shift();
        if (!pageNum) break;
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
  }, [pdf, totalPages, scale, highlights, searchMatches]);

  // 썸네일 생성 (세대 ID 사용)
  const generateThumbnails = async (pdfDoc, generation) => {
    const total = pdfDoc.numPages;
    const BATCH_SIZE = 5;

    for (let start = 1; start <= total; start += BATCH_SIZE) {
      if (thumbnailGenerationRef.current !== generation) return;

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

      if (thumbnailGenerationRef.current !== generation) return;

      setThumbnails((prev) => {
        const length = total;
        const next =
          prev && prev.length === length
            ? [...prev]
            : new Array(length).fill(null);

        batchResults.forEach(({ index, dataUrl }) => {
          next[index] = dataUrl;
        });

        return next;
      });
    }
  };

  // ✅ PDF 로드 공통 함수
  const loadPdfFromFile = async (file) => {
    if (!file) return;

    const name = file.name;
    setFileName(name);

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    pdfCacheRef.current[name] = pdfDoc;

    const newGeneration = thumbnailGenerationRef.current + 1;
    thumbnailGenerationRef.current = newGeneration;

    setThumbnails(new Array(pdfDoc.numPages).fill(null));

    setPdf(pdfDoc);
    setTotalPages(pdfDoc.numPages);
    setCurrentPage(1);
    setScale(INITIAL_SCALE);

    // 검색 관련 상태 리셋
    setPageTexts([]);
    setSearchMatches([]);
    setSearchIndex(0);
    setSearchQuery("");

    generateThumbnails(pdfDoc, newGeneration);
  };

  // 파일 열기 (input)
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadPdfFromFile(file);
  };

  // === 드래그앤드롭 핸들러 ===
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      alert("PDF 파일만 열 수 있습니다.");
      return;
    }

    await loadPdfFromFile(file);
  };

  // === 페이지 텍스트 추출 (텍스트 검색용) ===
  useEffect(() => {
    if (!pdf || totalPages === 0) {
      setPageTexts([]);
      return;
    }

    let cancelled = false;

    const extractTexts = async () => {
      const texts = [];
      for (let i = 1; i <= totalPages; i++) {
        if (cancelled) return;
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          let fullText = "";
          textContent.items.forEach((item) => {
            const str = item.str || "";
            if (!str) return;
            if (fullText) fullText += " ";
            fullText += str;
          });
          texts.push(fullText);
        } catch (e) {
          texts.push("");
        }
      }
      if (!cancelled) {
        setPageTexts(texts);
      }
    };

    extractTexts();

    return () => {
      cancelled = true;
    };
  }, [pdf, totalPages]);

  // 스크롤 위치 계산
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

  // 북마크 여부
  const isPageBookmarked = (pageNum) => {
    if (!fileName) return false;
    return bookmarks.some((b) => b.fileName === fileName && b.page === pageNum);
  };

  // 북마크 토글
  const toggleBookmarkPage = (pageNum) => {
    if (!fileName) return;
    const key = `${fileName}-${pageNum}`;

    setBookmarks((prev) => {
      const exists = prev.some((b) => b.key === key);
      if (exists) {
        return prev.filter((b) => b.key !== key);
      }

      const newBookmark = {
        key,
        fileName,
        page: pageNum,
        date: new Date().toLocaleString(),
        label: "",
        folderId: null,
      };
      return [...prev, newBookmark];
    });
  };

  // 페이지 점프
  const jumpToPage = (pageNum) => {
    if (!totalPages) return;
    const target = Math.min(Math.max(pageNum, 1), totalPages);
    setCurrentPage(target);
    scrollToPage(target);
  };

  // 스크롤 시 현재 페이지 계산
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

  // Ctrl + 휠 줌
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

  // 썸네일 자동 스크롤
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

  // 북마크 추가
  const addBookmark = () => {
    if (!fileName) return;
    toggleBookmarkPage(currentPage);
  };

  const removeBookmark = (key) => {
    setBookmarks((prev) => prev.filter((b) => b.key !== key));
  };

  // 북마크로 이동
  const goToBookmark = async (bm) => {
    if (fileName === bm.fileName && pdf) {
      jumpToPage(bm.page);
      return;
    }

    const cachedDoc = pdfCacheRef.current[bm.fileName];
    if (!cachedDoc) {
      alert(
        `이 북마크의 PDF("${bm.fileName}")는 현재 메모리에 없습니다.\n먼저 해당 파일을 한 번 열어주세요.`
      );
      return;
    }

    const newGeneration = thumbnailGenerationRef.current + 1;
    thumbnailGenerationRef.current = newGeneration;

    setThumbnails(new Array(cachedDoc.numPages).fill(null));

    setPdf(cachedDoc);
    setFileName(bm.fileName);
    setTotalPages(cachedDoc.numPages);
    setScale(INITIAL_SCALE);
    setCurrentPage(bm.page);

    generateThumbnails(cachedDoc, newGeneration);

    setTimeout(() => {
      scrollToPage(bm.page);
    }, 200);
  };

  // 전역 폴더 추가
  const handleAddFolder = () => {
    setFolders((prev) => {
      const nextIndex = prev.length + 1;
      const newFolder = {
        id: `folder-${Date.now()}-${nextIndex}`,
        name: `폴더${nextIndex}`,
        createdAt: new Date().toLocaleString(),
      };
      return [...prev, newFolder];
    });
  };

  // 폴더 이름 수정
  const startEditFolder = (folder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

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

  const cancelEditFolder = () => {
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  const toggleFolderCollapse = (folderId) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  // 폴더 삭제: 폴더는 제거, 폴더 안 즐겨찾기는 "폴더 없음"으로 이동
  const handleDeleteFolder = (folderId) => {
    const folder = folders.find((f) => f.id === folderId);
    const name = folder ? folder.name : "";

    if (
      !window.confirm(
        `"${name}" 폴더를 삭제하시겠습니까?\n(폴더 안 즐겨찾기는 삭제되지 않고, '폴더 없음'으로 이동합니다.)`
      )
    ) {
      return;
    }

    setFolders((prev) => prev.filter((f) => f.id !== folderId));

    setBookmarks((prev) =>
      prev.map((bm) =>
        bm.folderId === folderId ? { ...bm, folderId: null } : bm
      )
    );

    setCollapsedFolders((prev) => {
      const next = { ...prev };
      delete next[folderId];
      return next;
    });

    if (editingFolderId === folderId) {
      setEditingFolderId(null);
      setEditingFolderName("");
    }
  };

  const handleChangeBookmarkFolder = (bookmarkKey, folderId) => {
    setBookmarks((prev) =>
      prev.map((bm) =>
        bm.key === bookmarkKey ? { ...bm, folderId: folderId || null } : bm
      )
    );
  };

  const startEditBookmark = (bm, displayLabel) => {
    setEditingKey(bm.key);
    setEditingLabel(displayLabel);
  };

  const saveEditBookmark = (key) => {
    setBookmarks((prev) =>
      prev.map((bm) =>
        bm.key === key ? { ...bm, label: editingLabel.trim() } : bm
      )
    );
    setEditingKey(null);
    setEditingLabel("");
  };

  const cancelEditBookmark = () => {
    setEditingKey(null);
    setEditingLabel("");
  };

  // 줌 핸들러
  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  };

  const handleResetZoom = () => {
    setScale(INITIAL_SCALE);
  };

  // 지우개: 해당 점에 걸린 마지막 하이라이트 삭제
  const eraseHighlightAtPoint = (pageNum, e) => {
    if (!fileName) return;
    const canvas = canvasRefs.current[pageNum - 1];
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const xNorm = (e.clientX - rect.left) / canvas.width;
    const yNorm = (e.clientY - rect.top) / canvas.height;

    setHighlights((prev) => {
      let targetIndex = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        const h = prev[i];
        if (h.fileName !== fileName || h.page !== pageNum) continue;
        if (
          xNorm >= h.x &&
          xNorm <= h.x + h.width &&
          yNorm >= h.y &&
          yNorm <= h.y + h.height
        ) {
          targetIndex = i;
          break;
        }
      }
      if (targetIndex === -1) return prev;
      const next = [...prev];
      next.splice(targetIndex, 1);
      return next;
    });
  };

  // 형광펜: 캔버스 마우스 다운 & 전역 마우스 업
  const handleCanvasMouseDown = (pageNum) => (e) => {
    if (isEraseMode) {
      eraseHighlightAtPoint(pageNum, e);
      return;
    }

    if (!isHighlightMode || !fileName) return;

    const canvas = canvasRefs.current[pageNum - 1];
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    highlightStartRef.current = {
      page: pageNum,
      rect,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };

    const onMouseUp = (ev) => {
      if (!highlightStartRef.current) {
        window.removeEventListener("mouseup", onMouseUp);
        return;
      }

      const {
        page,
        rect: startRect,
        canvasWidth,
        canvasHeight,
        startClientX,
        startClientY,
      } = highlightStartRef.current;

      highlightStartRef.current = null;
      window.removeEventListener("mouseup", onMouseUp);

      const endX = ev.clientX - startRect.left;
      const endY = ev.clientY - startRect.top;
      const startX = startClientX - startRect.left;
      const startY = startClientY - startRect.top;

      const normStartX = startX / canvasWidth;
      const normStartY = startY / canvasHeight;
      const normEndX = endX / canvasWidth;
      const normEndY = endY / canvasHeight;

      const rawWidth = Math.abs(normStartX - normEndX);
      const rawHeight = Math.abs(normStartY - normEndY);

      const MIN_WIDTH = 0.005;
      if (rawWidth < MIN_WIDTH) return;

      const MIN_LINE_HEIGHT = 0.02;
      let width = rawWidth;
      let height;
      let minX;
      let minY;

      minX = Math.min(normStartX, normEndX);

      if (rawHeight < MIN_LINE_HEIGHT) {
        const centerY = (normStartY + normEndY) / 2;
        height = MIN_LINE_HEIGHT;
        minY = centerY - height / 2;
        if (minY < 0) minY = 0;
        if (minY + height > 1) minY = 1 - height;
      } else {
        height = rawHeight;
        minY = Math.min(normStartY, normEndY);
      }

      setHighlights((prev) => [
        ...prev,
        {
          id: `${fileName}-${page}-${Date.now()}-${Math.random()}`,
          fileName,
          page,
          x: minX,
          y: minY,
          width,
          height,
          color: DEFAULT_HIGHLIGHT_COLOR,
        },
      ]);
    };

    window.addEventListener("mouseup", onMouseUp);
  };

  // 전역 북마크 인덱스 (자동 라벨용)
  const indexMap = {};
  bookmarks.forEach((bm, idx) => {
    indexMap[bm.key] = idx;
  });

  const unassignedBookmarks = bookmarks.filter((bm) => !bm.folderId);

  // === 텍스트 검색 로직 ===
  const handleSearch = () => {
    const q = searchQuery.trim();
    if (!q || pageTexts.length === 0) {
      setSearchMatches([]);
      setSearchIndex(0);
      return;
    }

    const lowerQ = q.toLowerCase();
    const matches = [];

    pageTexts.forEach((text, idx) => {
      if (!text) return;
      const lowerText = text.toLowerCase();
      let pos = lowerText.indexOf(lowerQ);
      while (pos !== -1) {
        matches.push({
          page: idx + 1,
          start: pos,
          end: pos + q.length,
        });
        pos = lowerText.indexOf(lowerQ, pos + q.length);
      }
    });

    setSearchMatches(matches);
    if (matches.length > 0) {
      setSearchIndex(0);
      jumpToPage(matches[0].page);
    } else {
      setSearchIndex(0);
    }
  };

  const gotoMatch = (nextIndex) => {
    if (searchMatches.length === 0) return;
    const len = searchMatches.length;
    let idx = ((nextIndex % len) + len) % len;
    setSearchIndex(idx);
    const match = searchMatches[idx];
    jumpToPage(match.page);
  };

  const hasSearchResults = searchMatches.length > 0;

  // === 컨텍스트 메뉴 핸들러 ===
  const handleFolderContextMenu = (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      type: "folder",
      target: { folderId: folder.id },
    });
  };

  const handleBookmarkContextMenu = (e, bm) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      type: "bookmark",
      target: { key: bm.key },
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, type: null, target: null });
  };

  const handleFolderRenameFromMenu = () => {
    if (!contextMenu.target) return;
    const folder = folders.find((f) => f.id === contextMenu.target.folderId);
    if (folder) {
      startEditFolder(folder);
    }
    closeContextMenu();
  };

  const handleFolderDeleteFromMenu = () => {
    if (!contextMenu.target) return;
    handleDeleteFolder(contextMenu.target.folderId);
    closeContextMenu();
  };

  const handleBookmarkFolderChangeFromMenu = () => {
    if (!contextMenu.target) return;
    const bm = bookmarks.find((b) => b.key === contextMenu.target.key);
    if (!bm) return;

    setFolderDialog({
      visible: true,
      bookmarkKey: bm.key,
      value: bm.folderId || "",
    });
    closeContextMenu();
  };

  const handleBookmarkRenameFromMenu = () => {
    if (!contextMenu.target) return;
    const bm = bookmarks.find((b) => b.key === contextMenu.target.key);
    if (bm) {
      const displayLabel = getBookmarkDisplayLabel(bm.label, indexMap[bm.key]);
      startEditBookmark(bm, displayLabel);
    }
    closeContextMenu();
  };

  const handleBookmarkDeleteFromMenu = () => {
    if (!contextMenu.target) return;
    removeBookmark(contextMenu.target.key);
    closeContextMenu();
  };

  const closeFolderDialog = () => {
    setFolderDialog({
      visible: false,
      bookmarkKey: null,
      value: "",
    });
  };

  const confirmFolderDialog = () => {
    if (!folderDialog.bookmarkKey) {
      closeFolderDialog();
      return;
    }
    handleChangeBookmarkFolder(folderDialog.bookmarkKey, folderDialog.value);
    closeFolderDialog();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDragOver(true);
  };

  // === 렌더링 ===
  return (
    <Container
      $dragOver={isDragOver}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 왼쪽 페이지 탭 (접힘/펼침) */}
      {isLeftCollapsed ? (
        <LeftCollapsedTab onClick={() => setIsLeftCollapsed(false)}>
          📄 페이지
        </LeftCollapsedTab>
      ) : (
        <Sidebar ref={sidebarRef}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <h3 style={{ margin: 0 }}>📄 페이지</h3>
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
          {thumbnails.map((src, idx) => {
            const pageNum = idx + 1;
            const bookmarked = isPageBookmarked(pageNum);

            return (
              <PageThumbnail
                key={idx}
                ref={(el) => {
                  if (el) thumbnailRefs.current[idx] = el;
                }}
                active={currentPage === pageNum}
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

                {src ? (
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
        </Sidebar>
      )}

      {/* 중앙 본문 */}
      <Main
        ref={mainRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        $highlight={isHighlightMode || isEraseMode}
      >
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

              {/* 형광펜 토글 */}
              <button
                type="button"
                onClick={() =>
                  setIsHighlightMode((prev) => {
                    const next = !prev;
                    if (next) setIsEraseMode(false);
                    return next;
                  })
                }
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
                onClick={() =>
                  setIsEraseMode((prev) => {
                    const next = !prev;
                    if (next) setIsHighlightMode(false);
                    return next;
                  })
                }
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

              {/* 텍스트 검색 영역 */}
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
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      // 엔터로 검색 실행 및 다음 결과 이동
                      if (!hasSearchResults) {
                        handleSearch();
                      } else {
                        gotoMatch(searchIndex + 1);
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
                  onClick={handleSearch}
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
                    minWidth: 60,
                    textAlign: "center",
                  }}
                >
                  {hasSearchResults
                    ? `${searchIndex + 1} / ${searchMatches.length}`
                    : ""}
                </span>
                <button
                  type="button"
                  disabled={!hasSearchResults}
                  onClick={() => gotoMatch(searchIndex - 1)}
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
                  onClick={() => gotoMatch(searchIndex + 1)}
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
            Array.from({ length: totalPages }, (_, i) => {
              const pageNum = i + 1;
              return (
                <PageContainer key={i}>
                  <Canvas
                    ref={(el) => {
                      if (el) canvasRefs.current[i] = el;
                    }}
                    onMouseDown={handleCanvasMouseDown(pageNum)}
                    $highlight={isHighlightMode || isEraseMode}
                  />
                  {/* 텍스트 레이어 (검색된 텍스트 하이라이트용) */}
                  <div
                    ref={(el) => {
                      if (el) textLayerRefs.current[i] = el;
                    }}
                    className="textLayer"
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      pointerEvents: "none",
                    }}
                  />
                </PageContainer>
              );
            })}
        </PagesWrapper>
      </Main>

      {/* 오른쪽 즐겨찾기 탭 (접힘/펼침 + 리사이즈) */}
      {isRightCollapsed ? (
        <RightCollapsedTab onClick={() => setIsRightCollapsed(false)}>
          📑 즐겨찾기
        </RightCollapsedTab>
      ) : (
        <>
          <RightResizeHandle onMouseDown={handleRightResizeMouseDown} />

          <RightSidebar $width={rightSidebarWidth}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>📑 즐겨찾기</h3>
              <button
                type="button"
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: 12,
                }}
                onClick={() => setIsRightCollapsed(true)}
              >
                접기
              </button>
            </div>

            <AddFolderButton type="button" onClick={handleAddFolder}>
              + 폴더 추가
            </AddFolderButton>

            {folders.length === 0 && (
              <EmptyText>아직 생성된 폴더가 없습니다.</EmptyText>
            )}

            <FolderList>
              {folders.map((folder) => {
                const folderBookmarks = bookmarks.filter(
                  (bm) => bm.folderId === folder.id
                );
                const isFolderCollapsed = collapsedFolders[folder.id];

                return (
                  <FolderWrapper
                    key={folder.id}
                    onContextMenu={(e) => handleFolderContextMenu(e, folder)}
                  >
                    <FolderTitleRow>
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
                              if (e.nativeEvent.isComposing) return;
                              if (e.key === "Enter") {
                                e.preventDefault();
                                saveEditFolder(folder.id);
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditFolder();
                              }
                            }}
                          />
                        ) : (
                          <FolderName onClick={() => startEditFolder(folder)}>
                            {folder.name}
                          </FolderName>
                        )}
                      </div>

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

                        {editingFolderId === folder.id && (
                          <>
                            <button
                              style={{
                                fontSize: 11,
                                border: "none",
                                background: "none",
                                color: "blue",
                                cursor: "pointer",
                              }}
                              onClick={() => saveEditFolder(folder.id)}
                            >
                              저장
                            </button>
                            <button
                              style={{
                                fontSize: 11,
                                border: "none",
                                background: "none",
                                color: "#555",
                                cursor: "pointer",
                              }}
                              onClick={cancelEditFolder}
                            >
                              취소
                            </button>
                          </>
                        )}
                      </div>
                    </FolderTitleRow>

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
                              <BookmarkItem
                                key={bm.key}
                                onContextMenu={(e) =>
                                  handleBookmarkContextMenu(e, bm)
                                }
                              >
                                <BookmarkHeader>
                                  {editingKey === bm.key ? (
                                    <BookmarkLabelInput
                                      autoFocus
                                      value={editingLabel}
                                      onChange={(e) =>
                                        setEditingLabel(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.nativeEvent.isComposing) return;

                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          saveEditBookmark(bm.key);
                                        }
                                        if (e.key === "Escape") {
                                          e.preventDefault();
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
                                    {bm.fileName} · {bm.page}p
                                  </BookmarkPageText>
                                </BookmarkHeader>

                                <BookmarkMiddleRow />
                              </BookmarkItem>
                            );
                          })
                        )}
                      </FolderBookmarkList>
                    )}
                  </FolderWrapper>
                );
              })}
            </FolderList>

            {/* 폴더에 속하지 않은 즐겨찾기 */}
            <h4 style={{ margin: "8px 0 4px" }}>📌 폴더 없음</h4>
            {unassignedBookmarks.length === 0 ? (
              <EmptyText>폴더에 속하지 않은 즐겨찾기가 없습니다.</EmptyText>
            ) : (
              <FolderBookmarkList>
                {unassignedBookmarks.map((bm) => {
                  const displayLabel = getBookmarkDisplayLabel(
                    bm.label,
                    indexMap[bm.key]
                  );
                  return (
                    <BookmarkItem
                      key={bm.key}
                      onContextMenu={(e) => handleBookmarkContextMenu(e, bm)}
                    >
                      <BookmarkHeader>
                        {editingKey === bm.key ? (
                          <BookmarkLabelInput
                            autoFocus
                            value={editingLabel}
                            onChange={(e) => setEditingLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.nativeEvent.isComposing) return;

                              if (e.key === "Enter") {
                                e.preventDefault();
                                saveEditBookmark(bm.key);
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditBookmark();
                              }
                            }}
                          />
                        ) : (
                          <BookmarkLabelButton onClick={() => goToBookmark(bm)}>
                            📘 {displayLabel}
                          </BookmarkLabelButton>
                        )}

                        <BookmarkPageText>
                          {bm.fileName} · {bm.page}p
                        </BookmarkPageText>
                      </BookmarkHeader>

                      <BookmarkMiddleRow />
                    </BookmarkItem>
                  );
                })}
              </FolderBookmarkList>
            )}
          </RightSidebar>
        </>
      )}

      {/* 컨텍스트 메뉴 렌더링 */}
      {contextMenu.visible && contextMenu.type === "folder" && (
        <ContextMenu
          $x={contextMenu.x}
          $y={contextMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuItem onClick={handleFolderRenameFromMenu}>
            이름 변경
          </ContextMenuItem>
          <ContextMenuItem onClick={handleFolderDeleteFromMenu}>
            삭제
          </ContextMenuItem>
        </ContextMenu>
      )}

      {contextMenu.visible && contextMenu.type === "bookmark" && (
        <ContextMenu
          $x={contextMenu.x}
          $y={contextMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuItem onClick={handleBookmarkFolderChangeFromMenu}>
            폴더 변경
          </ContextMenuItem>
          <ContextMenuItem onClick={handleBookmarkRenameFromMenu}>
            이름 수정
          </ContextMenuItem>
          <ContextMenuItem onClick={handleBookmarkDeleteFromMenu}>
            삭제
          </ContextMenuItem>
        </ContextMenu>
      )}

      {/* 폴더 선택 모달 */}
      {folderDialog.visible && (
        <DialogOverlay onClick={closeFolderDialog}>
          <Dialog onClick={(e) => e.stopPropagation()}>
            <DialogTitle>폴더 선택</DialogTitle>
            <DialogSelect
              value={folderDialog.value}
              onChange={(e) =>
                setFolderDialog((prev) => ({
                  ...prev,
                  value: e.target.value,
                }))
              }
            >
              <option value="">(폴더 없음)</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </DialogSelect>
            <DialogActions>
              <DialogButton onClick={confirmFolderDialog}>확인</DialogButton>
              <DialogButton onClick={closeFolderDialog}>취소</DialogButton>
            </DialogActions>
          </Dialog>
        </DialogOverlay>
      )}
    </Container>
  );
}

// import { useState, useEffect, useRef } from "react";
// import styled from "styled-components";
// import * as pdfjsLib from "pdfjs-dist";
// import "pdfjs-dist/web/pdf_viewer.css";
// import offSvg from "../src/svg/off.svg";
// import onSvg from "../src/svg/on.svg";

// pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// // 레이아웃
// const Container = styled.div`
//   display: flex;
//   height: 100vh;
//   font-family: sans-serif;
// `;

// const Sidebar = styled.div`
//   width: 200px;
//   border-right: 1px solid #ccc;
//   padding: 10px;
//   overflow-y: auto;
//   flex-shrink: 0;
// `;

// // 왼쪽 접힘 탭
// const LeftCollapsedTab = styled.div`
//   width: 24px;
//   background: #f0f0f0;
//   border-right: 1px solid #ccc;
//   display: flex;
//   align-items: center;
//   justify-content: center;
//   writing-mode: vertical-rl;
//   text-orientation: mixed;
//   cursor: pointer;
//   font-size: 12px;
//   flex-shrink: 0;
//   user-select: none;

//   &:hover {
//     background: #e4e4e4;
//   }
// `;

// // 오른쪽 접힘 탭
// const RightCollapsedTab = styled.div`
//   width: 24px;
//   background: #f0f0f0;
//   border-left: 1px solid #ccc;
//   display: flex;
//   align-items: center;
//   justify-content: center;
//   writing-mode: vertical-rl;
//   text-orientation: mixed;
//   cursor: pointer;
//   font-size: 12px;
//   flex-shrink: 0;
//   user-select: none;

//   &:hover {
//     background: #e4e4e4;
//   }
// `;

// // 형광펜 / 지우개 모드일 때 커서 변경
// const Main = styled.div`
//   flex: 1;
//   display: flex;
//   flex-direction: column;
//   overflow: auto;
//   position: relative;
//   cursor: ${(props) => (props.$highlight ? "crosshair" : "default")};
// `;

// const PagesWrapper = styled.div`
//   display: flex;
//   flex-direction: column;
//   align-items: center;
//   padding-bottom: 40px;
// `;

// // 각 페이지 컨테이너 (캔버스 + 텍스트 레이어)
// const PageContainer = styled.div`
//   position: relative;
//   margin-bottom: 20px;
// `;

// const Toolbar = styled.div`
//   position: sticky;
//   top: 0;
//   z-index: 10;
//   background: #fff;
//   margin: 0;
//   padding: 10px;
//   display: flex;
//   align-items: center;
//   gap: 10px;
//   flex-shrink: 0;
//   border-bottom: 1px solid #eee;
// `;

// // 확대/축소 툴바
// const ZoomToolbar = styled.div`
//   margin-left: auto;
//   display: flex;
//   align-items: center;
//   gap: 4px;
// `;

// const ZoomButton = styled.button`
//   padding: 2px 6px;
//   font-size: 12px;
//   border-radius: 4px;
//   border: 1px solid #ccc;
//   background: #f8f8f8;
//   cursor: pointer;

//   &:hover {
//     background: #eee;
//   }
// `;

// const ZoomResetButton = styled(ZoomButton)`
//   font-weight: bold;
// `;

// const ZoomValue = styled.span`
//   font-size: 12px;
//   min-width: 40px;
//   text-align: center;
// `;

// // PDF 캔버스
// const Canvas = styled.canvas`
//   box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
//   cursor: ${(props) => (props.$highlight ? "crosshair" : "default")};
// `;

// // 썸네일
// const PageThumbnail = styled.div`
//   position: relative;
//   margin-bottom: 5px;
//   cursor: pointer;
//   border: ${(props) => (props.active ? "2px solid #007bff" : "1px solid #eee")};
//   padding: 2px;

//   img {
//     width: 100%;
//     display: block;
//   }
// `;

// const ThumbnailPageNumber = styled.div`
//   text-align: center;
//   font-size: 12px;
// `;

// const ThumbnailIconButton = styled.button`
//   position: absolute;
//   top: 4px;
//   right: 4px;
//   background: transparent;
//   border: none;
//   padding: 0;
//   cursor: pointer;
// `;

// const ThumbnailIcon = styled.img`
//   width: 30px;
//   height: 30px;
//   display: block;
// `;

// // 우측 사이드바 (리사이즈 가능)
// const RightSidebar = styled.div`
//   width: ${(props) => props.$width}px;
//   border-left: 1px solid #ccc;
//   padding: 10px;
//   overflow-y: auto;
//   flex-shrink: 0;
// `;

// const EmptyText = styled.p`
//   color: #999;
//   font-size: 12px;
// `;

// const BookmarkItem = styled.li`
//   display: flex;
//   flex-direction: column;
//   margin-bottom: 6px;
//   border-bottom: 1px solid #eee;
//   padding: 4px 0;
//   gap: 4px;
// `;

// const BookmarkHeader = styled.div`
//   display: flex;
//   align-items: center;
//   justify-content: space-between;
//   gap: 8px;
// `;

// const BookmarkMiddleRow = styled.div`
//   display: flex;
//   align-items: center;
//   justify-content: space-between;
//   margin-top: 2px;
// `;

// const BookmarkLabelButton = styled.button`
//   font-size: 15px;
//   background: none;
//   border: none;
//   color: #007bff;
//   cursor: pointer;
//   padding: 0;
//   text-align: left;
// `;

// const BookmarkLabelInput = styled.input`
//   font-size: 15px;
//   padding: 2px 4px;
//   border: 1px solid #ccc;
//   border-radius: 4px;
// `;

// const BookmarkPageText = styled.span`
//   font-size: 11px;
//   color: #333;
//   flex-shrink: 0;
// `;

// const BookmarkDateRow = styled.div`
//   font-size: 10px;
//   color: #777;
//   margin-left: 2px;
// `;

// const PageNumberInput = styled.input`
//   width: 60px;
//   text-align: center;
//   padding: 4px 6px;
// `;

// // 폴더 UI
// const FolderWrapper = styled.li`
//   margin-top: 8px;
//   padding-top: 4px;
//   border-top: 1px dashed #ddd;
// `;

// const FolderTitleRow = styled.div`
//   display: flex;
//   align-items: center;
//   justify-content: space-between;
//   font-size: 12px;
//   font-weight: bold;
//   color: #555;
//   margin-bottom: 4px;
// `;

// const FolderName = styled.span`
//   cursor: pointer;
// `;

// const FolderBookmarkList = styled.ul`
//   list-style: none;
//   padding-left: 10px;
//   margin: 0;
// `;

// const EmptyFolderText = styled.li`
//   font-size: 11px;
//   color: #aaa;
//   padding: 2px 0;
// `;

// const FolderList = styled.ul`
//   list-style: none;
//   padding-left: 0;
//   margin: 8px 0 16px;
// `;

// const FolderToggleButton = styled.button`
//   border: none;
//   background: none;
//   cursor: pointer;
//   font-size: 10px;
//   padding: 0 2px;
// `;

// const AddFolderButton = styled.button`
//   font-size: 11px;
//   border: 1px solid #ccc;
//   background: #f8f8f8;
//   border-radius: 4px;
//   padding: 2px 6px;
//   cursor: pointer;
//   margin-bottom: 4px;

//   &:hover {
//     background: #eee;
//   }
// `;

// // 폴더 삭제 버튼 (컨텍스트 메뉴용 텍스트 스타일)
// const DeleteFolderButton = styled.button`
//   font-size: 11px;
//   border: none;
//   background: none;
//   color: #c00;
//   cursor: pointer;
// `;

// // 컨텍스트 메뉴
// const ContextMenu = styled.ul`
//   position: fixed;
//   top: ${(props) => props.$y}px;
//   left: ${(props) => props.$x}px;
//   margin: 0;
//   padding: 4px 0;
//   list-style: none;
//   background: #ffffff;
//   border: 1px solid #ccc;
//   border-radius: 4px;
//   min-width: 140px;
//   box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
//   z-index: 9999;
// `;

// const ContextMenuItem = styled.li`
//   padding: 6px 10px;
//   font-size: 12px;
//   cursor: pointer;
//   white-space: nowrap;

//   &:hover {
//     background: #f0f0f0;
//   }
// `;

// // 폴더 선택 모달
// const DialogOverlay = styled.div`
//   position: fixed;
//   inset: 0;
//   background: rgba(0, 0, 0, 0.3);
//   display: flex;
//   align-items: center;
//   justify-content: center;
//   z-index: 10000;
// `;

// const Dialog = styled.div`
//   background: #fff;
//   padding: 16px 20px;
//   border-radius: 8px;
//   min-width: 260px;
//   box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
// `;

// const DialogTitle = styled.h4`
//   margin: 0 0 8px;
//   font-size: 14px;
//   font-weight: bold;
//   color: #333;
// `;

// const DialogSelect = styled.select`
//   width: 100%;
//   font-size: 12px;
//   padding: 4px 6px;
//   border-radius: 4px;
//   border: 1px solid #ccc;
//   margin-top: 4px;
// `;

// const DialogActions = styled.div`
//   margin-top: 12px;
//   display: flex;
//   justify-content: flex-end;
//   gap: 8px;
// `;

// const DialogButton = styled.button`
//   font-size: 12px;
//   padding: 4px 10px;
//   border-radius: 4px;
//   border: 1px solid #ccc;
//   background: #f8f8f8;
//   cursor: pointer;

//   &:hover {
//     background: #eee;
//   }
// `;

// // 오른쪽 리사이즈 핸들
// const RightResizeHandle = styled.div`
//   width: 4px;
//   cursor: col-resize;
//   background: #ddd;
//   flex-shrink: 0;
//   align-self: stretch;

//   &:hover {
//     background: #ccc;
//   }
// `;

// // 자동 라벨 / 커스텀 라벨 처리 헬퍼
// const getBookmarkDisplayLabel = (label, idx) => {
//   const trimmed = (label || "").trim();

//   // label이 비어 있을 때만 자동으로 "즐겨찾기N" 생성
//   if (!trimmed) {
//     return `즐겨찾기${idx + 1}`;
//   }

//   // 한 번이라도 사용자가 입력한 값은 그대로 사용
//   return trimmed;
// };

// // 줌 상수
// const MIN_SCALE = 0.5;
// const MAX_SCALE = 3;
// const SCALE_STEP = 0.25;
// const INITIAL_SCALE = 1.0;

// // 형광펜 색상
// const DEFAULT_HIGHLIGHT_COLOR = "rgba(255, 255, 0, 0.35)";

// // PDF 페이지 위에 텍스트 레이어(span들)를 직접 그리는 헬퍼
// const renderTextLayerOnPage = async (page, viewport, container) => {
//   if (!container) return;

//   const textContent = await page.getTextContent();

//   container.innerHTML = "";
//   container.style.width = `${viewport.width}px`;
//   container.style.height = `${viewport.height}px`;
//   container.style.position = "absolute";
//   container.style.left = "0";
//   container.style.top = "0";
//   container.style.pointerEvents = "none";

//   const textItems = textContent.items || [];
//   const styles = textContent.styles || {};

//   const frag = document.createDocumentFragment();

//   textItems.forEach((item) => {
//     const text = item.str || "";
//     if (!text) return;

//     const mm = pdfjsLib.Util.transform(viewport.transform, item.transform);
//     const fontHeight = Math.hypot(mm[2], mm[3]);
//     const x = mm[4];
//     const y = mm[5];

//     const span = document.createElement("span");
//     span.textContent = text;
//     span.style.position = "absolute";
//     span.style.whiteSpace = "pre";
//     span.style.fontSize = `${fontHeight}px`;

//     const font = styles[item.fontName];
//     if (font && font.fontFamily) {
//       span.style.fontFamily = font.fontFamily;
//     }

//     span.style.left = `${x}px`;
//     span.style.top = `${y - fontHeight}px`;

//     frag.appendChild(span);
//   });

//   container.appendChild(frag);
// };

// export default function PdfViewerWithBookmarks() {
//   const [pdf, setPdf] = useState(null);
//   const [currentPage, setCurrentPage] = useState(1);
//   const [pageInput, setPageInput] = useState("1");
//   const [totalPages, setTotalPages] = useState(0);

//   const [bookmarks, setBookmarks] = useState([]);
//   const [fileName, setFileName] = useState("");
//   const [thumbnails, setThumbnails] = useState([]);

//   // 페이지 텍스트 (텍스트 검색용)
//   const [pageTexts, setPageTexts] = useState([]);

//   // 검색 상태
//   const [searchQuery, setSearchQuery] = useState("");
//   const [searchMatches, setSearchMatches] = useState([]); // { page, start, end }
//   const [searchIndex, setSearchIndex] = useState(0);

//   // 전역 폴더
//   const [folders, setFolders] = useState([]);
//   const [editingFolderId, setEditingFolderId] = useState(null);
//   const [editingFolderName, setEditingFolderName] = useState("");
//   const [collapsedFolders, setCollapsedFolders] = useState({});

//   // 확대/축소
//   const [scale, setScale] = useState(INITIAL_SCALE);

//   // 오른쪽 사이드바 너비 상태
//   const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
//   const rightDragActiveRef = useRef(false);
//   const rightDragStartXRef = useRef(0);
//   const rightDragStartWidthRef = useRef(320);

//   // 왼쪽/오른쪽 접힘 상태
//   const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
//   const [isRightCollapsed, setIsRightCollapsed] = useState(false);

//   const canvasRefs = useRef([]);
//   const textLayerRefs = useRef([]); // 텍스트 레이어 ref
//   const mainRef = useRef(null);
//   const toolbarRef = useRef(null);
//   const scrollTickingRef = useRef(false);

//   const sidebarRef = useRef(null);
//   const thumbnailRefs = useRef([]);

//   const [editingKey, setEditingKey] = useState(null);
//   const [editingLabel, setEditingLabel] = useState("");

//   // 형광펜 / 지우개 상태
//   const [isHighlightMode, setIsHighlightMode] = useState(false);
//   const [isEraseMode, setIsEraseMode] = useState(false);
//   const [highlights, setHighlights] = useState([]); // {id,fileName,page,x,y,width,height,color}
//   const highlightStartRef = useRef(null);

//   // PDF 문서 캐시 (세션 동안만 유지)
//   const pdfCacheRef = useRef({});

//   // 썸네일 렌더 세대 관리 (파일 전환시 이전 비동기 결과 무시)
//   const thumbnailGenerationRef = useRef(0);

//   // 컨텍스트 메뉴 상태
//   const [contextMenu, setContextMenu] = useState({
//     visible: false,
//     x: 0,
//     y: 0,
//     type: null, // 'folder' | 'bookmark'
//     target: null, // { folderId } or { key }
//   });

//   // 폴더 변경 모달 상태
//   const [folderDialog, setFolderDialog] = useState({
//     visible: false,
//     bookmarkKey: null,
//     value: "",
//   });

//   // 로컬 스토리지 로드
//   useEffect(() => {
//     const saved = localStorage.getItem("gyul-pdf-bookmarks");
//     if (saved) setBookmarks(JSON.parse(saved));

//     const savedFolders = localStorage.getItem("gyul-pdf-folders");
//     if (savedFolders) setFolders(JSON.parse(savedFolders));

//     const savedHighlights = localStorage.getItem("gyul-pdf-highlights");
//     if (savedHighlights) setHighlights(JSON.parse(savedHighlights));
//   }, []);

//   // 저장
//   useEffect(() => {
//     localStorage.setItem("gyul-pdf-bookmarks", JSON.stringify(bookmarks));
//   }, [bookmarks]);

//   useEffect(() => {
//     localStorage.setItem("gyul-pdf-folders", JSON.stringify(folders));
//   }, [folders]);

//   useEffect(() => {
//     localStorage.setItem("gyul-pdf-highlights", JSON.stringify(highlights));
//   }, [highlights]);

//   // 페이지 입력 동기화
//   useEffect(() => {
//     setPageInput(String(currentPage));
//   }, [currentPage]);

//   // Ctrl+Z 되돌리기 (현재 파일의 마지막 형광펜 삭제)
//   useEffect(() => {
//     const handleKeyDown = (e) => {
//       if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
//         e.preventDefault();
//         setHighlights((prev) => {
//           if (!fileName) return prev;
//           let targetIndex = -1;
//           for (let i = prev.length - 1; i >= 0; i--) {
//             if (prev[i].fileName === fileName) {
//               targetIndex = i;
//               break;
//             }
//           }
//           if (targetIndex === -1) return prev;
//           const next = [...prev];
//           next.splice(targetIndex, 1);
//           return next;
//         });
//       }
//     };

//     window.addEventListener("keydown", handleKeyDown);
//     return () => window.removeEventListener("keydown", handleKeyDown);
//   }, [fileName]);

//   // 컨텍스트 메뉴 닫기 (어디든 클릭/스크롤 시)
//   useEffect(() => {
//     const handleGlobalClick = () => {
//       setContextMenu((prev) =>
//         prev.visible
//           ? { visible: false, x: 0, y: 0, type: null, target: null }
//           : prev
//       );
//     };

//     window.addEventListener("click", handleGlobalClick);
//     window.addEventListener("scroll", handleGlobalClick, true);

//     return () => {
//       window.removeEventListener("click", handleGlobalClick);
//       window.removeEventListener("scroll", handleGlobalClick, true);
//     };
//   }, []);

//   // 오른쪽 사이드바 리사이즈용 전역 mousemove / mouseup
//   useEffect(() => {
//     const handleMouseMove = (e) => {
//       if (!rightDragActiveRef.current || isRightCollapsed) return;

//       const delta = rightDragStartXRef.current - e.clientX;
//       const MIN_WIDTH = 200;
//       const MAX_WIDTH = 600;

//       let newWidth = rightDragStartWidthRef.current + delta;
//       if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
//       if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;

//       setRightSidebarWidth(newWidth);
//     };

//     const handleMouseUp = () => {
//       if (rightDragActiveRef.current) {
//         rightDragActiveRef.current = false;
//       }
//     };

//     window.addEventListener("mousemove", handleMouseMove);
//     window.addEventListener("mouseup", handleMouseUp);

//     return () => {
//       window.removeEventListener("mousemove", handleMouseMove);
//       window.removeEventListener("mouseup", handleMouseUp);
//     };
//   }, [isRightCollapsed]);

//   const handleRightResizeMouseDown = (e) => {
//     e.preventDefault();
//     if (isRightCollapsed) return;
//     rightDragActiveRef.current = true;
//     rightDragStartXRef.current = e.clientX;
//     rightDragStartWidthRef.current = rightSidebarWidth;
//   };

//   // 형광펜 영역 그리기
//   const drawHighlightsForPage = (pageNum) => {
//     if (!pdf) return;
//     const canvas = canvasRefs.current[pageNum - 1];
//     if (!canvas) return;

//     const ctx = canvas.getContext("2d");
//     if (!ctx) return;

//     const pageHighlights = highlights.filter(
//       (h) => h.fileName === fileName && h.page === pageNum
//     );
//     if (pageHighlights.length === 0) return;

//     ctx.save();
//     pageHighlights.forEach((h) => {
//       const x = h.x * canvas.width;
//       const y = h.y * canvas.height;
//       const w = h.width * canvas.width;
//       const hgt = h.height * canvas.height;
//       ctx.fillStyle = h.color || DEFAULT_HIGHLIGHT_COLOR;
//       ctx.fillRect(x, y, w, hgt);
//     });
//     ctx.restore();
//   };

//   // 검색된 텍스트만 하이라이트
//   const applySearchHighlightForPage = (pageNum) => {
//     const q = searchQuery.trim();
//     if (!q) return;

//     const textLayerDiv = textLayerRefs.current[pageNum - 1];
//     if (!textLayerDiv) return;

//     const lowerQ = q.toLowerCase();
//     const spans = textLayerDiv.querySelectorAll("span");

//     spans.forEach((span) => {
//       const fullText = span.textContent || "";
//       const lowerText = fullText.toLowerCase();

//       let index = lowerText.indexOf(lowerQ);
//       if (index === -1) return;

//       const frag = document.createDocumentFragment();
//       let lastIndex = 0;

//       while (index !== -1) {
//         if (index > lastIndex) {
//           frag.appendChild(
//             document.createTextNode(fullText.slice(lastIndex, index))
//           );
//         }
//         const mark = document.createElement("span");
//         mark.textContent = fullText.slice(index, index + q.length);
//         mark.style.backgroundColor = "rgba(10, 59, 255, 1)";
//         frag.appendChild(mark);
//         lastIndex = index + q.length;
//         index = lowerText.indexOf(lowerQ, lastIndex);
//       }

//       if (lastIndex < fullText.length) {
//         frag.appendChild(document.createTextNode(fullText.slice(lastIndex)));
//       }

//       span.innerHTML = "";
//       span.appendChild(frag);
//     });
//   };

//   // 한 페이지 렌더
//   const renderPage = async (num, scaleValue = scale) => {
//     if (!pdf) return;
//     const canvas = canvasRefs.current[num - 1];
//     const textLayerDiv = textLayerRefs.current[num - 1];
//     if (!canvas || !textLayerDiv) return;

//     const page = await pdf.getPage(num);
//     const viewport = page.getViewport({ scale: scaleValue });
//     const ctx = canvas.getContext("2d");

//     canvas.height = viewport.height;
//     canvas.width = viewport.width;

//     ctx.clearRect(0, 0, canvas.width, canvas.height);

//     await page.render({ canvasContext: ctx, viewport }).promise;

//     await renderTextLayerOnPage(page, viewport, textLayerDiv);

//     drawHighlightsForPage(num);
//     applySearchHighlightForPage(num);
//   };

//   // 전체 페이지 렌더
//   useEffect(() => {
//     if (!pdf || totalPages === 0) return;

//     let cancelled = false;
//     const MAX_CONCURRENT = 4;
//     const queue = Array.from({ length: totalPages }, (_, i) => i + 1);

//     const worker = async () => {
//       while (!cancelled && queue.length) {
//         const pageNum = queue.shift();
//         if (!pageNum) break;
//         try {
//           await renderPage(pageNum, scale);
//         } catch (e) {
//           // console.error(e);
//         }
//       }
//     };

//     const workers = [];
//     for (let i = 0; i < Math.min(MAX_CONCURRENT, totalPages); i++) {
//       workers.push(worker());
//     }

//     return () => {
//       cancelled = true;
//     };
//   }, [pdf, totalPages, scale, highlights, searchMatches]);

//   // 썸네일 생성 (세대 ID 사용)
//   const generateThumbnails = async (pdfDoc, generation) => {
//     const total = pdfDoc.numPages;
//     const BATCH_SIZE = 5;

//     for (let start = 1; start <= total; start += BATCH_SIZE) {
//       if (thumbnailGenerationRef.current !== generation) return;

//       const end = Math.min(start + BATCH_SIZE - 1, total);
//       const batchPromises = [];

//       for (let pageNum = start; pageNum <= end; pageNum++) {
//         batchPromises.push(
//           (async () => {
//             const page = await pdfDoc.getPage(pageNum);
//             const viewport = page.getViewport({ scale: 0.2 });
//             const canvas = document.createElement("canvas");
//             canvas.width = viewport.width;
//             canvas.height = viewport.height;
//             await page.render({
//               canvasContext: canvas.getContext("2d"),
//               viewport,
//             }).promise;
//             return { index: pageNum - 1, dataUrl: canvas.toDataURL() };
//           })()
//         );
//       }

//       const batchResults = await Promise.all(batchPromises);

//       if (thumbnailGenerationRef.current !== generation) return;

//       setThumbnails((prev) => {
//         const length = total;
//         const next =
//           prev && prev.length === length
//             ? [...prev]
//             : new Array(length).fill(null);

//         batchResults.forEach(({ index, dataUrl }) => {
//           next[index] = dataUrl;
//         });

//         return next;
//       });
//     }
//   };

//   // 파일 열기
//   const handleFile = async (e) => {
//     const file = e.target.files?.[0];
//     if (!file) return;

//     const name = file.name;
//     setFileName(name);

//     const arrayBuffer = await file.arrayBuffer();
//     const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

//     pdfCacheRef.current[name] = pdfDoc;

//     const newGeneration = thumbnailGenerationRef.current + 1;
//     thumbnailGenerationRef.current = newGeneration;

//     setThumbnails(new Array(pdfDoc.numPages).fill(null));

//     setPdf(pdfDoc);
//     setTotalPages(pdfDoc.numPages);
//     setCurrentPage(1);
//     setScale(INITIAL_SCALE);

//     // 검색 관련 상태 리셋
//     setPageTexts([]);
//     setSearchMatches([]);
//     setSearchIndex(0);
//     setSearchQuery("");

//     generateThumbnails(pdfDoc, newGeneration);
//   };

//   // === 페이지 텍스트 추출 (텍스트 검색용) ===
//   useEffect(() => {
//     if (!pdf || totalPages === 0) {
//       setPageTexts([]);
//       return;
//     }

//     let cancelled = false;

//     const extractTexts = async () => {
//       const texts = [];
//       for (let i = 1; i <= totalPages; i++) {
//         if (cancelled) return;
//         try {
//           const page = await pdf.getPage(i);
//           const textContent = await page.getTextContent();
//           let fullText = "";
//           textContent.items.forEach((item) => {
//             const str = item.str || "";
//             if (!str) return;
//             if (fullText) fullText += " ";
//             fullText += str;
//           });
//           texts.push(fullText);
//         } catch (e) {
//           texts.push("");
//         }
//       }
//       if (!cancelled) {
//         setPageTexts(texts);
//       }
//     };

//     extractTexts();

//     return () => {
//       cancelled = true;
//     };
//   }, [pdf, totalPages]);

//   // 스크롤 위치 계산
//   const scrollToPage = (pageNum) => {
//     const canvas = canvasRefs.current[pageNum - 1];
//     const container = mainRef.current;
//     const toolbar = toolbarRef.current;

//     if (canvas && container) {
//       const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;

//       let offsetTop = 0;
//       let el = canvas;

//       while (el && el !== container) {
//         offsetTop += el.offsetTop;
//         el = el.offsetParent;
//       }

//       container.scrollTo({
//         top: offsetTop - toolbarHeight - 10,
//         behavior: "smooth",
//       });
//     }
//   };

//   // 북마크 여부
//   const isPageBookmarked = (pageNum) => {
//     if (!fileName) return false;
//     return bookmarks.some((b) => b.fileName === fileName && b.page === pageNum);
//   };

//   // 북마크 토글
//   const toggleBookmarkPage = (pageNum) => {
//     if (!fileName) return;
//     const key = `${fileName}-${pageNum}`;

//     setBookmarks((prev) => {
//       const exists = prev.some((b) => b.key === key);
//       if (exists) {
//         return prev.filter((b) => b.key !== key);
//       }

//       const newBookmark = {
//         key,
//         fileName,
//         page: pageNum,
//         date: new Date().toLocaleString(),
//         label: "",
//         folderId: null,
//       };
//       return [...prev, newBookmark];
//     });
//   };

//   // 페이지 점프
//   const jumpToPage = (pageNum) => {
//     if (!totalPages) return;
//     const target = Math.min(Math.max(pageNum, 1), totalPages);
//     setCurrentPage(target);
//     scrollToPage(target);
//   };

//   // 스크롤 시 현재 페이지 계산
//   const handleScroll = () => {
//     const container = mainRef.current;
//     const toolbar = toolbarRef.current;
//     if (!container || !pdf) return;

//     if (!scrollTickingRef.current) {
//       scrollTickingRef.current = true;

//       window.requestAnimationFrame(() => {
//         scrollTickingRef.current = false;

//         const containerTop = container.getBoundingClientRect().top;
//         const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;

//         let closestPage = 1;
//         let minDiff = Infinity;

//         canvasRefs.current.forEach((canvas, idx) => {
//           if (!canvas) return;
//           const rect = canvas.getBoundingClientRect();
//           const targetY = containerTop + toolbarHeight + 10;
//           const diff = Math.abs(rect.top - targetY);

//           if (diff < minDiff) {
//             minDiff = diff;
//             closestPage = idx + 1;
//           }
//         });

//         setCurrentPage(closestPage);
//       });
//     }
//   };

//   // Ctrl + 휠 줌
//   const handleWheel = (e) => {
//     if (!e.ctrlKey) return;
//     e.preventDefault();

//     const isZoomOut = e.deltaY > 0;
//     setScale((prev) => {
//       if (isZoomOut) {
//         return Math.max(prev - SCALE_STEP, MIN_SCALE);
//       }
//       return Math.min(prev + SCALE_STEP, MAX_SCALE);
//     });
//   };

//   // 썸네일 자동 스크롤
//   useEffect(() => {
//     if (!sidebarRef.current) return;
//     const container = sidebarRef.current;
//     const thumb = thumbnailRefs.current[currentPage - 1];
//     if (!thumb) return;

//     const containerRect = container.getBoundingClientRect();
//     const thumbRect = thumb.getBoundingClientRect();

//     const thumbCenterOffset =
//       thumbRect.top -
//       containerRect.top +
//       container.scrollTop +
//       thumbRect.height / 2;

//     const targetScrollTop = thumbCenterOffset - container.clientHeight / 2;

//     container.scrollTo({
//       top: targetScrollTop,
//       behavior: "smooth",
//     });
//   }, [currentPage]);

//   // 북마크 추가
//   const addBookmark = () => {
//     if (!fileName) return;
//     toggleBookmarkPage(currentPage);
//   };

//   const removeBookmark = (key) => {
//     setBookmarks((prev) => prev.filter((b) => b.key !== key));
//   };

//   // 북마크로 이동
//   const goToBookmark = async (bm) => {
//     if (fileName === bm.fileName && pdf) {
//       jumpToPage(bm.page);
//       return;
//     }

//     const cachedDoc = pdfCacheRef.current[bm.fileName];
//     if (!cachedDoc) {
//       alert(
//         `이 북마크의 PDF("${bm.fileName}")는 현재 메모리에 없습니다.\n먼저 해당 파일을 한 번 열어주세요.`
//       );
//       return;
//     }

//     const newGeneration = thumbnailGenerationRef.current + 1;
//     thumbnailGenerationRef.current = newGeneration;

//     setThumbnails(new Array(cachedDoc.numPages).fill(null));

//     setPdf(cachedDoc);
//     setFileName(bm.fileName);
//     setTotalPages(cachedDoc.numPages);
//     setScale(INITIAL_SCALE);
//     setCurrentPage(bm.page);

//     generateThumbnails(cachedDoc, newGeneration);

//     setTimeout(() => {
//       scrollToPage(bm.page);
//     }, 200);
//   };

//   // 전역 폴더 추가
//   const handleAddFolder = () => {
//     setFolders((prev) => {
//       const nextIndex = prev.length + 1;
//       const newFolder = {
//         id: `folder-${Date.now()}-${nextIndex}`,
//         name: `폴더${nextIndex}`,
//         createdAt: new Date().toLocaleString(),
//       };
//       return [...prev, newFolder];
//     });
//   };

//   // 폴더 이름 수정
//   const startEditFolder = (folder) => {
//     setEditingFolderId(folder.id);
//     setEditingFolderName(folder.name);
//   };

//   const saveEditFolder = (folderId) => {
//     setFolders((prev) =>
//       prev.map((f) =>
//         f.id === folderId
//           ? { ...f, name: editingFolderName.trim() || f.name }
//           : f
//       )
//     );
//     setEditingFolderId(null);
//     setEditingFolderName("");
//   };

//   const cancelEditFolder = () => {
//     setEditingFolderId(null);
//     setEditingFolderName("");
//   };

//   const toggleFolderCollapse = (folderId) => {
//     setCollapsedFolders((prev) => ({
//       ...prev,
//       [folderId]: !prev[folderId],
//     }));
//   };

//   // 폴더 삭제: 폴더는 제거, 폴더 안 즐겨찾기는 "폴더 없음"으로 이동
//   const handleDeleteFolder = (folderId) => {
//     const folder = folders.find((f) => f.id === folderId);
//     const name = folder ? folder.name : "";

//     if (
//       !window.confirm(
//         `"${name}" 폴더를 삭제하시겠습니까?\n(폴더 안 즐겨찾기는 삭제되지 않고, '폴더 없음'으로 이동합니다.)`
//       )
//     ) {
//       return;
//     }

//     setFolders((prev) => prev.filter((f) => f.id !== folderId));

//     setBookmarks((prev) =>
//       prev.map((bm) =>
//         bm.folderId === folderId ? { ...bm, folderId: null } : bm
//       )
//     );

//     setCollapsedFolders((prev) => {
//       const next = { ...prev };
//       delete next[folderId];
//       return next;
//     });

//     if (editingFolderId === folderId) {
//       setEditingFolderId(null);
//       setEditingFolderName("");
//     }
//   };

//   const handleChangeBookmarkFolder = (bookmarkKey, folderId) => {
//     setBookmarks((prev) =>
//       prev.map((bm) =>
//         bm.key === bookmarkKey ? { ...bm, folderId: folderId || null } : bm
//       )
//     );
//   };

//   const startEditBookmark = (bm, displayLabel) => {
//     setEditingKey(bm.key);
//     setEditingLabel(displayLabel);
//   };

//   const saveEditBookmark = (key) => {
//     setBookmarks((prev) =>
//       prev.map((bm) =>
//         bm.key === key ? { ...bm, label: editingLabel.trim() } : bm
//       )
//     );
//     setEditingKey(null);
//     setEditingLabel("");
//   };

//   const cancelEditBookmark = () => {
//     setEditingKey(null);
//     setEditingLabel("");
//   };

//   // 줌 핸들러
//   const handleZoomIn = () => {
//     setScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
//   };

//   const handleZoomOut = () => {
//     setScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
//   };

//   const handleResetZoom = () => {
//     setScale(INITIAL_SCALE);
//   };

//   // 지우개: 해당 점에 걸린 마지막 하이라이트 삭제
//   const eraseHighlightAtPoint = (pageNum, e) => {
//     if (!fileName) return;
//     const canvas = canvasRefs.current[pageNum - 1];
//     if (!canvas) return;

//     const rect = canvas.getBoundingClientRect();
//     const xNorm = (e.clientX - rect.left) / canvas.width;
//     const yNorm = (e.clientY - rect.top) / canvas.height;

//     setHighlights((prev) => {
//       let targetIndex = -1;
//       for (let i = prev.length - 1; i >= 0; i--) {
//         const h = prev[i];
//         if (h.fileName !== fileName || h.page !== pageNum) continue;
//         if (
//           xNorm >= h.x &&
//           xNorm <= h.x + h.width &&
//           yNorm >= h.y &&
//           yNorm <= h.y + h.height
//         ) {
//           targetIndex = i;
//           break;
//         }
//       }
//       if (targetIndex === -1) return prev;
//       const next = [...prev];
//       next.splice(targetIndex, 1);
//       return next;
//     });
//   };

//   // 형광펜: 캔버스 마우스 다운 & 전역 마우스 업
//   const handleCanvasMouseDown = (pageNum) => (e) => {
//     if (isEraseMode) {
//       eraseHighlightAtPoint(pageNum, e);
//       return;
//     }

//     if (!isHighlightMode || !fileName) return;

//     const canvas = canvasRefs.current[pageNum - 1];
//     if (!canvas) return;

//     const rect = canvas.getBoundingClientRect();

//     highlightStartRef.current = {
//       page: pageNum,
//       rect,
//       canvasWidth: canvas.width,
//       canvasHeight: canvas.height,
//       startClientX: e.clientX,
//       startClientY: e.clientY,
//     };

//     const onMouseUp = (ev) => {
//       if (!highlightStartRef.current) {
//         window.removeEventListener("mouseup", onMouseUp);
//         return;
//       }

//       const {
//         page,
//         rect: startRect,
//         canvasWidth,
//         canvasHeight,
//         startClientX,
//         startClientY,
//       } = highlightStartRef.current;

//       highlightStartRef.current = null;
//       window.removeEventListener("mouseup", onMouseUp);

//       const endX = ev.clientX - startRect.left;
//       const endY = ev.clientY - startRect.top;
//       const startX = startClientX - startRect.left;
//       const startY = startClientY - startRect.top;

//       const normStartX = startX / canvasWidth;
//       const normStartY = startY / canvasHeight;
//       const normEndX = endX / canvasWidth;
//       const normEndY = endY / canvasHeight;

//       const rawWidth = Math.abs(normStartX - normEndX);
//       const rawHeight = Math.abs(normStartY - normEndY);

//       const MIN_WIDTH = 0.005;
//       if (rawWidth < MIN_WIDTH) return;

//       const MIN_LINE_HEIGHT = 0.02;
//       let width = rawWidth;
//       let height;
//       let minX;
//       let minY;

//       minX = Math.min(normStartX, normEndX);

//       if (rawHeight < MIN_LINE_HEIGHT) {
//         const centerY = (normStartY + normEndY) / 2;
//         height = MIN_LINE_HEIGHT;
//         minY = centerY - height / 2;
//         if (minY < 0) minY = 0;
//         if (minY + height > 1) minY = 1 - height;
//       } else {
//         height = rawHeight;
//         minY = Math.min(normStartY, normEndY);
//       }

//       setHighlights((prev) => [
//         ...prev,
//         {
//           id: `${fileName}-${page}-${Date.now()}-${Math.random()}`,
//           fileName,
//           page,
//           x: minX,
//           y: minY,
//           width,
//           height,
//           color: DEFAULT_HIGHLIGHT_COLOR,
//         },
//       ]);
//     };

//     window.addEventListener("mouseup", onMouseUp);
//   };

//   // 전역 북마크 인덱스 (자동 라벨용)
//   const indexMap = {};
//   bookmarks.forEach((bm, idx) => {
//     indexMap[bm.key] = idx;
//   });

//   const unassignedBookmarks = bookmarks.filter((bm) => !bm.folderId);

//   // === 텍스트 검색 로직 ===
//   const handleSearch = () => {
//     const q = searchQuery.trim();
//     if (!q || pageTexts.length === 0) {
//       setSearchMatches([]);
//       setSearchIndex(0);
//       return;
//     }

//     const lowerQ = q.toLowerCase();
//     const matches = [];

//     pageTexts.forEach((text, idx) => {
//       if (!text) return;
//       const lowerText = text.toLowerCase();
//       let pos = lowerText.indexOf(lowerQ);
//       while (pos !== -1) {
//         matches.push({
//           page: idx + 1,
//           start: pos,
//           end: pos + q.length,
//         });
//         pos = lowerText.indexOf(lowerQ, pos + q.length);
//       }
//     });

//     setSearchMatches(matches);
//     if (matches.length > 0) {
//       setSearchIndex(0);
//       jumpToPage(matches[0].page);
//     } else {
//       setSearchIndex(0);
//     }
//   };

//   const gotoMatch = (nextIndex) => {
//     if (searchMatches.length === 0) return;
//     const len = searchMatches.length;
//     let idx = ((nextIndex % len) + len) % len;
//     setSearchIndex(idx);
//     const match = searchMatches[idx];
//     jumpToPage(match.page);
//   };

//   const hasSearchResults = searchMatches.length > 0;

//   // === 컨텍스트 메뉴 핸들러 ===
//   const handleFolderContextMenu = (e, folder) => {
//     e.preventDefault();
//     e.stopPropagation();
//     setContextMenu({
//       visible: true,
//       x: e.clientX,
//       y: e.clientY,
//       type: "folder",
//       target: { folderId: folder.id },
//     });
//   };

//   const handleBookmarkContextMenu = (e, bm) => {
//     e.preventDefault();
//     e.stopPropagation();
//     setContextMenu({
//       visible: true,
//       x: e.clientX,
//       y: e.clientY,
//       type: "bookmark",
//       target: { key: bm.key },
//     });
//   };

//   const closeContextMenu = () => {
//     setContextMenu({ visible: false, x: 0, y: 0, type: null, target: null });
//   };

//   const handleFolderRenameFromMenu = () => {
//     if (!contextMenu.target) return;
//     const folder = folders.find((f) => f.id === contextMenu.target.folderId);
//     if (folder) {
//       startEditFolder(folder);
//     }
//     closeContextMenu();
//   };

//   const handleFolderDeleteFromMenu = () => {
//     if (!contextMenu.target) return;
//     handleDeleteFolder(contextMenu.target.folderId);
//     closeContextMenu();
//   };

//   const handleBookmarkFolderChangeFromMenu = () => {
//     if (!contextMenu.target) return;
//     const bm = bookmarks.find((b) => b.key === contextMenu.target.key);
//     if (!bm) return;

//     setFolderDialog({
//       visible: true,
//       bookmarkKey: bm.key,
//       value: bm.folderId || "",
//     });
//     closeContextMenu();
//   };

//   const handleBookmarkRenameFromMenu = () => {
//     if (!contextMenu.target) return;
//     const bm = bookmarks.find((b) => b.key === contextMenu.target.key);
//     if (bm) {
//       const displayLabel = getBookmarkDisplayLabel(bm.label, indexMap[bm.key]);
//       startEditBookmark(bm, displayLabel);
//     }
//     closeContextMenu();
//   };

//   const handleBookmarkDeleteFromMenu = () => {
//     if (!contextMenu.target) return;
//     removeBookmark(contextMenu.target.key);
//     closeContextMenu();
//   };

//   const closeFolderDialog = () => {
//     setFolderDialog({
//       visible: false,
//       bookmarkKey: null,
//       value: "",
//     });
//   };

//   const confirmFolderDialog = () => {
//     if (!folderDialog.bookmarkKey) {
//       closeFolderDialog();
//       return;
//     }
//     handleChangeBookmarkFolder(folderDialog.bookmarkKey, folderDialog.value);
//     closeFolderDialog();
//   };

//   // === 렌더링 ===
//   return (
//     <Container>
//       {/* 왼쪽 페이지 탭 (접힘/펼침) */}
//       {isLeftCollapsed ? (
//         <LeftCollapsedTab onClick={() => setIsLeftCollapsed(false)}>
//           📄 페이지
//         </LeftCollapsedTab>
//       ) : (
//         <Sidebar ref={sidebarRef}>
//           <div
//             style={{
//               display: "flex",
//               alignItems: "center",
//               justifyContent: "space-between",
//               marginBottom: 8,
//             }}
//           >
//             <h3 style={{ margin: 0 }}>📄 페이지</h3>
//             <button
//               type="button"
//               style={{
//                 border: "none",
//                 background: "none",
//                 cursor: "pointer",
//                 fontSize: 12,
//               }}
//               onClick={() => setIsLeftCollapsed(true)}
//             >
//               접기
//             </button>
//           </div>
//           {thumbnails.map((src, idx) => {
//             const pageNum = idx + 1;
//             const bookmarked = isPageBookmarked(pageNum);

//             return (
//               <PageThumbnail
//                 key={idx}
//                 ref={(el) => {
//                   if (el) thumbnailRefs.current[idx] = el;
//                 }}
//                 active={currentPage === pageNum}
//                 onClick={() => jumpToPage(pageNum)}
//               >
//                 <ThumbnailIconButton
//                   onClick={(e) => {
//                     e.stopPropagation();
//                     toggleBookmarkPage(pageNum);
//                   }}
//                 >
//                   <ThumbnailIcon
//                     src={bookmarked ? onSvg : offSvg}
//                     alt={bookmarked ? "bookmarked" : "not bookmarked"}
//                   />
//                 </ThumbnailIconButton>

//                 {src ? (
//                   <img src={src} alt={`Page ${pageNum}`} />
//                 ) : (
//                   <div
//                     style={{
//                       width: "100%",
//                       paddingTop: "141%",
//                       background: "#f5f5f5",
//                       fontSize: "10px",
//                       display: "flex",
//                       alignItems: "center",
//                       justifyContent: "center",
//                       color: "#999",
//                     }}
//                   >
//                     로딩 중...
//                   </div>
//                 )}

//                 <ThumbnailPageNumber>{pageNum}</ThumbnailPageNumber>
//               </PageThumbnail>
//             );
//           })}
//         </Sidebar>
//       )}

//       {/* 중앙 본문 */}
//       <Main
//         ref={mainRef}
//         onScroll={handleScroll}
//         onWheel={handleWheel}
//         $highlight={isHighlightMode || isEraseMode}
//       >
//         <Toolbar ref={toolbarRef}>
//           <input type="file" accept="application/pdf" onChange={handleFile} />
//           {pdf && (
//             <>
//               <button
//                 onClick={() => {
//                   if (currentPage > 1) {
//                     jumpToPage(currentPage - 1);
//                   }
//                 }}
//               >
//                 ◀ 이전
//               </button>

//               <PageNumberInput
//                 type="number"
//                 min={1}
//                 max={totalPages || 1}
//                 value={pageInput}
//                 onChange={(e) => setPageInput(e.target.value)}
//                 onKeyDown={(e) => {
//                   if (e.key === "Enter") {
//                     const num = Number(pageInput);
//                     if (!Number.isNaN(num)) {
//                       jumpToPage(num);
//                     }
//                   }
//                 }}
//               />
//               <span>/ {totalPages}</span>

//               <button
//                 onClick={() => {
//                   if (currentPage < totalPages) {
//                     jumpToPage(currentPage + 1);
//                   }
//                 }}
//               >
//                 다음 ▶
//               </button>

//               <button onClick={addBookmark}>⭐ 북마크 추가</button>

//               {/* 형광펜 토글 */}
//               <button
//                 type="button"
//                 onClick={() =>
//                   setIsHighlightMode((prev) => {
//                     const next = !prev;
//                     if (next) setIsEraseMode(false);
//                     return next;
//                   })
//                 }
//                 style={{
//                   padding: "4px 8px",
//                   fontSize: "12px",
//                   borderRadius: "4px",
//                   border: "1px solid #ccc",
//                   background: isHighlightMode ? "#fff7c2" : "#f8f8f8",
//                   cursor: "pointer",
//                 }}
//               >
//                 🖍 형광펜 {isHighlightMode ? "ON" : "OFF"}
//               </button>

//               {/* 지우개 토글 */}
//               <button
//                 type="button"
//                 onClick={() =>
//                   setIsEraseMode((prev) => {
//                     const next = !prev;
//                     if (next) setIsHighlightMode(false);
//                     return next;
//                   })
//                 }
//                 style={{
//                   padding: "4px 8px",
//                   fontSize: "12px",
//                   borderRadius: "4px",
//                   border: "1px solid #ccc",
//                   background: isEraseMode ? "#ffe4e4" : "#f8f8f8",
//                   cursor: "pointer",
//                 }}
//               >
//                 🧽 지우개 {isEraseMode ? "ON" : "OFF"}
//               </button>

//               {/* 텍스트 검색 영역 */}
//               <div
//                 style={{
//                   display: "flex",
//                   alignItems: "center",
//                   gap: 4,
//                   marginLeft: 8,
//                 }}
//               >
//                 <input
//                   type="text"
//                   placeholder="텍스트 검색"
//                   value={searchQuery}
//                   onChange={(e) => setSearchQuery(e.target.value)}
//                   onKeyDown={(e) => {
//                     if (e.key === "Enter") {
//                       // 엔터로 검색 실행 및 다음 결과 이동
//                       if (!hasSearchResults) {
//                         handleSearch();
//                       } else {
//                         gotoMatch(searchIndex + 1);
//                       }
//                     }
//                   }}
//                   style={{
//                     fontSize: 12,
//                     padding: "2px 4px",
//                     borderRadius: 4,
//                     border: "1px solid #ccc",
//                     minWidth: 140,
//                   }}
//                 />
//                 <button
//                   type="button"
//                   onClick={handleSearch}
//                   style={{
//                     fontSize: 12,
//                     padding: "2px 6px",
//                     borderRadius: 4,
//                     border: "1px solid #ccc",
//                     background: "#f8f8f8",
//                     cursor: "pointer",
//                   }}
//                 >
//                   검색
//                 </button>
//                 <span
//                   style={{
//                     fontSize: 11,
//                     color: "#666",
//                     minWidth: 60,
//                     textAlign: "center",
//                   }}
//                 >
//                   {hasSearchResults
//                     ? `${searchIndex + 1} / ${searchMatches.length}`
//                     : ""}
//                 </span>
//                 <button
//                   type="button"
//                   disabled={!hasSearchResults}
//                   onClick={() => gotoMatch(searchIndex - 1)}
//                   style={{
//                     fontSize: 12,
//                     padding: "2px 4px",
//                     borderRadius: 4,
//                     border: "1px solid #ccc",
//                     background: hasSearchResults ? "#f8f8f8" : "#f0f0f0",
//                     cursor: hasSearchResults ? "pointer" : "default",
//                   }}
//                 >
//                   ◀
//                 </button>
//                 <button
//                   type="button"
//                   disabled={!hasSearchResults}
//                   onClick={() => gotoMatch(searchIndex + 1)}
//                   style={{
//                     fontSize: 12,
//                     padding: "2px 4px",
//                     borderRadius: 4,
//                     border: "1px solid #ccc",
//                     background: hasSearchResults ? "#f8f8f8" : "#f0f0f0",
//                     cursor: hasSearchResults ? "pointer" : "default",
//                   }}
//                 >
//                   ▶
//                 </button>
//               </div>

//               {/* 줌 컨트롤 */}
//               <ZoomToolbar>
//                 <ZoomButton type="button" onClick={handleZoomOut}>
//                   -
//                 </ZoomButton>
//                 <ZoomValue>{Math.round(scale * 100)}%</ZoomValue>
//                 <ZoomButton type="button" onClick={handleZoomIn}>
//                   +
//                 </ZoomButton>
//                 <ZoomResetButton type="button" onClick={handleResetZoom}>
//                   100%
//                 </ZoomResetButton>
//               </ZoomToolbar>
//             </>
//           )}
//         </Toolbar>

//         <PagesWrapper>
//           {pdf &&
//             Array.from({ length: totalPages }, (_, i) => {
//               const pageNum = i + 1;
//               return (
//                 <PageContainer key={i}>
//                   <Canvas
//                     ref={(el) => {
//                       if (el) canvasRefs.current[i] = el;
//                     }}
//                     onMouseDown={handleCanvasMouseDown(pageNum)}
//                     $highlight={isHighlightMode || isEraseMode}
//                   />
//                   {/* 텍스트 레이어 (검색된 텍스트 하이라이트용) */}
//                   <div
//                     ref={(el) => {
//                       if (el) textLayerRefs.current[i] = el;
//                     }}
//                     className="textLayer"
//                     style={{
//                       position: "absolute",
//                       left: 0,
//                       top: 0,
//                       pointerEvents: "none",
//                     }}
//                   />
//                 </PageContainer>
//               );
//             })}
//         </PagesWrapper>
//       </Main>

//       {/* 오른쪽 즐겨찾기 탭 (접힘/펼침 + 리사이즈) */}
//       {isRightCollapsed ? (
//         <RightCollapsedTab onClick={() => setIsRightCollapsed(false)}>
//           📑 즐겨찾기
//         </RightCollapsedTab>
//       ) : (
//         <>
//           <RightResizeHandle onMouseDown={handleRightResizeMouseDown} />

//           <RightSidebar $width={rightSidebarWidth}>
//             <div
//               style={{
//                 display: "flex",
//                 alignItems: "center",
//                 justifyContent: "space-between",
//                 marginBottom: 8,
//               }}
//             >
//               <h3 style={{ margin: 0 }}>📑 즐겨찾기</h3>
//               <button
//                 type="button"
//                 style={{
//                   border: "none",
//                   background: "none",
//                   cursor: "pointer",
//                   fontSize: 12,
//                 }}
//                 onClick={() => setIsRightCollapsed(true)}
//               >
//                 접기
//               </button>
//             </div>

//             <AddFolderButton type="button" onClick={handleAddFolder}>
//               + 폴더 추가
//             </AddFolderButton>

//             {folders.length === 0 && (
//               <EmptyText>아직 생성된 폴더가 없습니다.</EmptyText>
//             )}

//             <FolderList>
//               {folders.map((folder) => {
//                 const folderBookmarks = bookmarks.filter(
//                   (bm) => bm.folderId === folder.id
//                 );
//                 const isFolderCollapsed = collapsedFolders[folder.id];

//                 return (
//                   <FolderWrapper
//                     key={folder.id}
//                     onContextMenu={(e) => handleFolderContextMenu(e, folder)}
//                   >
//                     <FolderTitleRow>
//                       <div
//                         style={{
//                           display: "flex",
//                           alignItems: "center",
//                           gap: 4,
//                         }}
//                       >
//                         <FolderToggleButton
//                           type="button"
//                           onClick={() => toggleFolderCollapse(folder.id)}
//                         >
//                           {isFolderCollapsed ? "▶" : "▼"}
//                         </FolderToggleButton>

//                         {editingFolderId === folder.id ? (
//                           <BookmarkLabelInput
//                             autoFocus
//                             value={editingFolderName}
//                             onChange={(e) =>
//                               setEditingFolderName(e.target.value)
//                             }
//                             onKeyDown={(e) => {
//                               if (e.nativeEvent.isComposing) return;
//                               if (e.key === "Enter") {
//                                 e.preventDefault();
//                                 saveEditFolder(folder.id);
//                               }
//                               if (e.key === "Escape") {
//                                 e.preventDefault();
//                                 cancelEditFolder();
//                               }
//                             }}
//                           />
//                         ) : (
//                           <FolderName onClick={() => startEditFolder(folder)}>
//                             {folder.name}
//                           </FolderName>
//                         )}
//                       </div>

//                       <div
//                         style={{
//                           display: "flex",
//                           alignItems: "center",
//                           gap: 4,
//                           fontSize: 10,
//                           color: "#999",
//                         }}
//                       >
//                         <span>{folderBookmarks.length}개</span>

//                         {editingFolderId === folder.id && (
//                           <>
//                             <button
//                               style={{
//                                 fontSize: 11,
//                                 border: "none",
//                                 background: "none",
//                                 color: "blue",
//                                 cursor: "pointer",
//                               }}
//                               onClick={() => saveEditFolder(folder.id)}
//                             >
//                               저장
//                             </button>
//                             <button
//                               style={{
//                                 fontSize: 11,
//                                 border: "none",
//                                 background: "none",
//                                 color: "#555",
//                                 cursor: "pointer",
//                               }}
//                               onClick={cancelEditFolder}
//                             >
//                               취소
//                             </button>
//                           </>
//                         )}
//                       </div>
//                     </FolderTitleRow>

//                     {!isFolderCollapsed && (
//                       <FolderBookmarkList>
//                         {folderBookmarks.length === 0 ? (
//                           <EmptyFolderText>
//                             이 폴더에 즐겨찾기가 없습니다.
//                           </EmptyFolderText>
//                         ) : (
//                           folderBookmarks.map((bm) => {
//                             const displayLabel = getBookmarkDisplayLabel(
//                               bm.label,
//                               indexMap[bm.key]
//                             );

//                             return (
//                               <BookmarkItem
//                                 key={bm.key}
//                                 onContextMenu={(e) =>
//                                   handleBookmarkContextMenu(e, bm)
//                                 }
//                               >
//                                 <BookmarkHeader>
//                                   {editingKey === bm.key ? (
//                                     <BookmarkLabelInput
//                                       autoFocus
//                                       value={editingLabel}
//                                       onChange={(e) =>
//                                         setEditingLabel(e.target.value)
//                                       }
//                                       onKeyDown={(e) => {
//                                         if (e.nativeEvent.isComposing) return;

//                                         if (e.key === "Enter") {
//                                           e.preventDefault();
//                                           saveEditBookmark(bm.key);
//                                         }
//                                         if (e.key === "Escape") {
//                                           e.preventDefault();
//                                           cancelEditBookmark();
//                                         }
//                                       }}
//                                     />
//                                   ) : (
//                                     <BookmarkLabelButton
//                                       onClick={() => goToBookmark(bm)}
//                                     >
//                                       📘 {displayLabel}
//                                     </BookmarkLabelButton>
//                                   )}

//                                   <BookmarkPageText>
//                                     {bm.fileName} · {bm.page}p
//                                   </BookmarkPageText>
//                                 </BookmarkHeader>

//                                 <BookmarkMiddleRow />
//                               </BookmarkItem>
//                             );
//                           })
//                         )}
//                       </FolderBookmarkList>
//                     )}
//                   </FolderWrapper>
//                 );
//               })}
//             </FolderList>

//             {/* 폴더에 속하지 않은 즐겨찾기 */}
//             <h4 style={{ margin: "8px 0 4px" }}>📌 폴더 없음</h4>
//             {unassignedBookmarks.length === 0 ? (
//               <EmptyText>폴더에 속하지 않은 즐겨찾기가 없습니다.</EmptyText>
//             ) : (
//               <FolderBookmarkList>
//                 {unassignedBookmarks.map((bm) => {
//                   const displayLabel = getBookmarkDisplayLabel(
//                     bm.label,
//                     indexMap[bm.key]
//                   );
//                   return (
//                     <BookmarkItem
//                       key={bm.key}
//                       onContextMenu={(e) => handleBookmarkContextMenu(e, bm)}
//                     >
//                       <BookmarkHeader>
//                         {editingKey === bm.key ? (
//                           <BookmarkLabelInput
//                             autoFocus
//                             value={editingLabel}
//                             onChange={(e) => setEditingLabel(e.target.value)}
//                             onKeyDown={(e) => {
//                               if (e.nativeEvent.isComposing) return;

//                               if (e.key === "Enter") {
//                                 e.preventDefault();
//                                 saveEditBookmark(bm.key);
//                               }
//                               if (e.key === "Escape") {
//                                 e.preventDefault();
//                                 cancelEditBookmark();
//                               }
//                             }}
//                           />
//                         ) : (
//                           <BookmarkLabelButton onClick={() => goToBookmark(bm)}>
//                             📘 {displayLabel}
//                           </BookmarkLabelButton>
//                         )}

//                         <BookmarkPageText>
//                           {bm.fileName} · {bm.page}p
//                         </BookmarkPageText>
//                       </BookmarkHeader>

//                       <BookmarkMiddleRow />
//                     </BookmarkItem>
//                   );
//                 })}
//               </FolderBookmarkList>
//             )}
//           </RightSidebar>
//         </>
//       )}

//       {/* 컨텍스트 메뉴 렌더링 */}
//       {contextMenu.visible && contextMenu.type === "folder" && (
//         <ContextMenu
//           $x={contextMenu.x}
//           $y={contextMenu.y}
//           onClick={(e) => e.stopPropagation()}
//         >
//           <ContextMenuItem onClick={handleFolderRenameFromMenu}>
//             이름 변경
//           </ContextMenuItem>
//           <ContextMenuItem onClick={handleFolderDeleteFromMenu}>
//             삭제
//           </ContextMenuItem>
//         </ContextMenu>
//       )}

//       {contextMenu.visible && contextMenu.type === "bookmark" && (
//         <ContextMenu
//           $x={contextMenu.x}
//           $y={contextMenu.y}
//           onClick={(e) => e.stopPropagation()}
//         >
//           <ContextMenuItem onClick={handleBookmarkFolderChangeFromMenu}>
//             폴더 변경
//           </ContextMenuItem>
//           <ContextMenuItem onClick={handleBookmarkRenameFromMenu}>
//             이름 수정
//           </ContextMenuItem>
//           <ContextMenuItem onClick={handleBookmarkDeleteFromMenu}>
//             삭제
//           </ContextMenuItem>
//         </ContextMenu>
//       )}

//       {/* 폴더 선택 모달 */}
//       {folderDialog.visible && (
//         <DialogOverlay onClick={closeFolderDialog}>
//           <Dialog onClick={(e) => e.stopPropagation()}>
//             <DialogTitle>폴더 선택</DialogTitle>
//             <DialogSelect
//               value={folderDialog.value}
//               onChange={(e) =>
//                 setFolderDialog((prev) => ({
//                   ...prev,
//                   value: e.target.value,
//                 }))
//               }
//             >
//               <option value="">(폴더 없음)</option>
//               {folders.map((folder) => (
//                 <option key={folder.id} value={folder.id}>
//                   {folder.name}
//                 </option>
//               ))}
//             </DialogSelect>
//             <DialogActions>
//               <DialogButton onClick={confirmFolderDialog}>확인</DialogButton>
//               <DialogButton onClick={closeFolderDialog}>취소</DialogButton>
//             </DialogActions>
//           </Dialog>
//         </DialogOverlay>
//       )}
//     </Container>
//   );
// }
