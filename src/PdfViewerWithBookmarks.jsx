import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import styled from "styled-components";
// 🔹 네이티브 PDFium 엔진 어댑터 (PDF.js 호환 API)
import {
  getDocument,
  matrixTransform,
  isRenderCancelledError as engineIsRenderCancelledError,
} from "./utils/pdfEngine";
import PageSidebar from "./components/SidePage";
import BookmarkSidebar from "./components/BookMarkPage";
import PdfToolbar from "./components/ToolBar";
import { pdfCache, makeDocKey, makeRenderKey } from "./utils/pdfCache";
import colorPenCursor from "./png/colorPen.png"; // 글자 형광펜
import freeAreaCursor from "./png/freeArea.png"; // 자유영역 형광펜
import eraserCursor from "./png/eraser.png"; // 지우개

let ipcRenderer = null;

if (typeof window !== "undefined" && window.require) {
  try {
    const electron = window.require("electron");
    ipcRenderer = electron.ipcRenderer;
  } catch (e) {
    console.warn("ipcRenderer 로드 실패:", e);
  }
}

// 저장 디바운스 (localStorage·IPC 호출 빈도 완화)
const safeSetLocalStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`localStorage 저장 실패(${key}):`, e);
  }
};

const safeGetLocalStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`localStorage 읽기 실패(${key}):`, e);
    return null;
  }
};

const safeParseJSON = (raw, fallback = null) => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn("JSON 파싱 실패:", e);
    return fallback;
  }
};

// 🔹 파일 드래그인지 판별하는 헬퍼 (북마크 드래그와 구분용)
const isFileDragEvent = (e) => {
  const dt = e.dataTransfer;
  if (!dt) return false;
  return Array.from(dt.types || []).includes("Files");
};

// 레이아웃
const Container = styled.div`
  display: flex;
  height: 100vh;
  font-family: sans-serif;
  border: 2px dashed ${(props) => (props.$dragOver ? "#4a90e2" : "transparent")};
`;

// 중앙 영역 (탭바 + 본문)
const Center = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

// 상단 탭 바
const TabBar = styled.div`
  display: flex;
  align-items: flex-end;
  height: 32px;
  padding: 0 6px;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
  flex-shrink: 0;
  overflow-x: auto;
`;

// 개별 탭
const Tab = styled.div`
  display: flex;
  align-items: center;
  width: 100px;
  padding: 4px 8px;
  margin-right: 4px;
  border-radius: 6px 6px 0 0;
  border: 1px solid #ccc;
  border-bottom: ${(props) =>
    props.$active ? "1px solid #ffffff" : "1px solid #ccc"};
  background: ${(props) => (props.$active ? "#ffffff" : "#e6e6e6")};
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: ${(props) => (props.$dragging ? 0.6 : 1)};
`;

const TabTitle = styled.span`
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const TabCloseButton = styled.button`
  border: none;
  background: transparent;
  padding: 0 4px;
  margin-left: 4px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;

  &:hover {
    background: rgba(0, 0, 0, 0.08);
    border-radius: 50%;
  }
`;

// 메인 영역 (커서 모드 변경)
const Main = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  position: relative;

  cursor: ${(props) => {
    if (props.$erase) {
      return `url(${eraserCursor}) 6 6, auto`;
    }
    if (props.$textHighlight) {
      return `url(${colorPenCursor}) 4 18, auto`;
    }
    if (props.$freeHighlight) {
      return `url(${freeAreaCursor}) 4 18, crosshair`;
    }
    return "default";
  }};
`;

const PagesWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 40px;
`;

// ✅ 각 페이지 컨테이너: min-height/min-width로 페이지 높이를 미리 확보
//    (윈도잉으로 캔버스가 해제되어도 스크롤 위치가 안정적)
const PageContainer = styled.div`
  position: relative;
  margin-bottom: 20px;
  min-height: ${(props) => (props.$minHeight ? `${props.$minHeight}px` : "0")};
  min-width: ${(props) => (props.$minWidth ? `${props.$minWidth}px` : "0")};
  /* 🔹 스크롤 성능 최적화: 페이지 내부 변경이 외부 레이아웃에 영향 주지 않음을 명시
     - layout: 자식의 레이아웃이 외부에 영향 주지 않음
     - style: 자식의 카운터/quotes가 외부에 영향 주지 않음
     - paint: 컨테이너 영역 밖으로 페인트가 나가지 않음
     수천 페이지에 GPU 레이어를 생성하지 않으면서 스크롤 페인트 비용을 줄여줌 */
  contain: layout style paint;
`;

// PDF 캔버스
const Canvas = styled.canvas`
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);

  cursor: ${(props) => {
    if (props.$erase) {
      return `url(${eraserCursor}) 6 6, auto`;
    }
    if (props.$textHighlight) {
      return `url(${colorPenCursor}) 4 18, auto`;
    }
    if (props.$freeHighlight) {
      return `url(${freeAreaCursor}) 4 18, crosshair`;
    }
    return "default";
  }};
`;

// 형광펜 전용 캔버스
const HighlightCanvas = styled.canvas`
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 1;
`;

// 줌 상수
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const INITIAL_SCALE = 1.5;
const ACTUAL_SIZE_SCALE = 1.0;
// 메타 캐시 없을 때 레이아웃 즉시 확정용 (A4, pt)
const FALLBACK_PAGE_W_PT = 595;
const FALLBACK_PAGE_H_PT = 842;

// 형광펜 색상
const DEFAULT_HIGHLIGHT_COLOR = "rgba(0, 255, 0, 0.6)";

// 🔹 성능 튜닝 상수
//   - WINDOW_SIZE: 화면에 보이는 페이지 위·아래로 미리 렌더링할 페이지 수
//   - KEEP_RENDERED_RANGE: 이 범위를 벗어난 페이지는 캔버스 픽셀을 해제
//   - MAX_DPR: 고해상도 모니터에서 캔버스가 폭증하는 것을 방지
//   - BODY_RENDER_CONCURRENCY / THUMB_RENDER_CONCURRENCY:
//       CPU 코어 수에 맞춰 동시 렌더 수를 자동 조정 (코어가 많을수록 더 공격적으로)
const WINDOW_SIZE = 3;
const KEEP_RENDERED_RANGE = 6;
const PAGE_MARGIN_BOTTOM = 20;
// DOM에 실제로 마운트할 페이지 범위 (현재 위치 ±)
const MOUNT_BUFFER = Math.max(WINDOW_SIZE + 4, KEEP_RENDERED_RANGE + 4);
const MAX_DPR = 1.5;
const SCROLL_SETTLE_MS = 80;

const HARDWARE_CONCURRENCY =
  typeof navigator !== "undefined" && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;

// PDFium 네이티브: libuv 워커 + 파일 I/O 파이프라인 — 코어 활용을 더 공격적으로
const BODY_RENDER_CONCURRENCY = Math.max(
  2,
  Math.min(8, Math.floor(HARDWARE_CONCURRENCY * 0.75)),
);
const THUMB_RENDER_CONCURRENCY = Math.max(
  1,
  Math.min(3, Math.floor(HARDWARE_CONCURRENCY / 4)),
);

// 사이드바 표시 폭(~165px) × DPR(최대 2) — 이전 80px 대비 선명도 개선
const THUMB_DISPLAY_WIDTH = 168;
const THUMB_JPEG_QUALITY = 0.88;
const getThumbPixelWidth = () =>
  Math.round(
    THUMB_DISPLAY_WIDTH *
      (typeof window !== "undefined"
        ? Math.min(window.devicePixelRatio || 1, 2)
        : 1),
  );

// 16GB RAM: 동시에 PDFium 문서를 열어둘 탭 수·RAM 썸네일·프리렌더 상한
const MAX_OPEN_PDF_DOCS = 2;
const THUMB_RAM_RADIUS = 48;
const MAX_PAGE_TEXT_CACHE_ENTRIES = 40;
const MAX_PRERENDER_PAGES = 36;
const PRERENDER_PAGE_RADIUS = 28;

const getOutputScale = () =>
  Math.min(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    MAX_DPR,
  );

// 텍스트 레이어 데이터(span 좌표 등)를 미리 계산
//   - 캐시에 저장 가능한 평탄한 객체 배열로 반환
//   - PDF.js의 viewport.transform * item.transform 결과를 미리 적용
const computeTextLayerData = (textContent, viewport) => {
  const items = textContent.items || [];
  const styles = textContent.styles || {};
  const data = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = item.str || "";
    if (!text) {
      data[i] = null;
      continue;
    }
    const mm = matrixTransform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(mm[2], mm[3]);
    const font = styles[item.fontName];
    data[i] = {
      text,
      x: mm[4],
      y: mm[5] - fontHeight,
      fontHeight,
      fontFamily: font?.fontFamily || null,
    };
  }
  return data;
};

// 미리 계산된 textLayerData로 DOM 렌더
const paintTextLayerFromData = (
  container,
  textLayerData,
  cssWidth,
  cssHeight,
) => {
  if (!container) return;
  container.innerHTML = "";
  container.style.width = `${cssWidth}px`;
  container.style.height = `${cssHeight}px`;
  container.style.position = "absolute";
  container.style.left = "0";
  container.style.top = "0";

  const frag = document.createDocumentFragment();

  for (let i = 0; i < textLayerData.length; i++) {
    const d = textLayerData[i];
    if (!d) continue;

    const span = document.createElement("span");
    span.textContent = d.text;
    span.dataset.spanIndex = String(i);
    span.dataset.rawText = d.text;
    span.style.position = "absolute";
    span.style.whiteSpace = "pre";
    span.style.fontSize = `${d.fontHeight}px`;
    span.style.cursor = "inherit";
    if (d.fontFamily) span.style.fontFamily = d.fontFamily;
    span.style.left = `${d.x}px`;
    span.style.top = `${d.y}px`;

    frag.appendChild(span);
  }

  container.appendChild(frag);
};

// 텍스트 레이어 직접 렌더 (PDF.js 페이지에서 가져옴)
const renderTextLayerOnPage = async (page, viewport, container) => {
  if (!container) return null;
  const textContent = await page.getTextContent();
  const data = computeTextLayerData(textContent, viewport);
  paintTextLayerFromData(container, data, viewport.width, viewport.height);
  return data;
};

export default function PdfViewerWithBookmarks() {
  const [pdf, setPdf] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [totalPages, setTotalPages] = useState(0);

  const [bookmarks, setBookmarks] = useState([]);
  const [fileName, setFileName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [thumbnails, setThumbnails] = useState([]);
  // 점프 시 즉시 미리보기로 쓸 수 있게 ref로도 미러링
  const thumbnailsRef = useRef([]);
  useEffect(() => {
    thumbnailsRef.current = thumbnails;
  }, [thumbnails]);

  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [draggingTabId, setDraggingTabId] = useState(null);

  const [pageTexts, setPageTexts] = useState([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState([]);
  const [searchIndex, setSearchIndex] = useState(0);

  const [scale, setScale] = useState(INITIAL_SCALE);
  const [mountRange, setMountRange] = useState({ lo: 1, hi: 1 });
  const mountRangeRef = useRef({ lo: 1, hi: 1 });

  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [thumbnailScale, setThumbnailScale] = useState(1);
  const [showOnlyBookmarked, setShowOnlyBookmarked] = useState(false);

  const [isDragOver, setIsDragOver] = useState(false);

  const canvasRefs = useRef([]);
  const textLayerRefs = useRef([]);
  const highlightCanvasRefs = useRef([]);
  const pageContainerRefs = useRef([]);
  const mainRef = useRef(null);
  const toolbarRef = useRef(null);
  const currentPageRef = useRef(1);
  const activeTabIdRef = useRef(null);
  const activePdfRef = useRef(null);

  // ✅ 이미 렌더 완료된 페이지 기록
  const renderedPagesRef = useRef(new Set());
  // pdf/scale 변경 시 이전 렌더 결과 무시 (뒤집힘·깨짐 방지)
  const renderGenerationRef = useRef(0);
  const pageRenderTasksRef = useRef(new Map());
  // 화면에 보이는 페이지 (형광펜 등 무거운 작업 범위 제한)
  const visiblePagesRef = useRef(new Set());
  const [visiblePagesVersion, setVisiblePagesVersion] = useState(0);

  // 🔹 스크롤 중인지 추적 (스크롤 중에는 무거운 PDF.js 렌더링을 보류해 jank 방지)
  const isScrollingRef = useRef(false);
  const scrollSettleTimerRef = useRef(null);
  const scrollRenderKickRef = useRef(null);
  // 페이지별 렌더 품질: 'preview' | 'full'
  const pageQualityRef = useRef(new Map());
  // 점프·현재 페이지 full 렌더 중에는 일반 백그라운드 워커 일시 정지
  const backgroundRenderPausedRef = useRef(false);

  // 모드 상태
  const [isHighlightMode, setIsHighlightMode] = useState(false); // 자유영역 형광펜
  const [isTextHighlightMode, setIsTextHighlightMode] = useState(false); // 글자 형광펜
  const [isEraseMode, setIsEraseMode] = useState(false);

  // 모든 형광펜(자유 + 글자)을 사각형으로 저장
  const [highlights, setHighlights] = useState([]);
  const highlightStartRef = useRef(null);

  const pdfCacheRef = useRef({});

  // ✅ 페이지 기본 높이/너비 저장 (1페이지 기준)
  const basePageHeightRef = useRef(null);
  const basePageWidthRef = useRef(null);
  const baseScaleRef = useRef(INITIAL_SCALE);

  // ✅ 캐시용 문서 키 (현재 활성 PDF)
  const docKeyRef = useRef(null);
  // ✅ 페이지별 메타(예: rotation, viewport size) 캐시 - 캐시 hit 시 PDF.js getPage를 건너뛰는 데 사용
  const docMetaRef = useRef(null);

  // 🔹 썸네일 렌더 상태
  //   - 큐: 우선 처리할 페이지 번호 (사이드바의 보이는 페이지 기준)
  //   - inProgress: 현재 렌더링 중인 페이지 (중복 방지)
  //   - done: 이미 완료된 페이지
  const thumbRequestQueueRef = useRef([]);
  const thumbInProgressRef = useRef(new Set());
  const thumbDoneRef = useRef(new Set());
  const thumbWorkerActiveRef = useRef(false);

  // 🔹 본문 우선: 본문에서 최소 1페이지가 렌더링되기 전엔 새 썸네일 렌더링을 보류
  //    (IndexedDB에 이미 있는 캐시 썸네일은 그대로 즉시 표시됨)
  const bodyFirstReadyRef = useRef(false);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    activePdfRef.current = pdf;
  }, [pdf]);

  // 컴포넌트 언마운트 시: 모든 PDF 문서와 렌더 작업 정리
  useEffect(() => {
    return () => {
      pageRenderTasksRef.current.forEach((task) => {
        try {
          task.cancel();
        } catch (_) {
          /* ignore */
        }
      });
      pageRenderTasksRef.current.clear();
      Object.values(pdfCacheRef.current).forEach((doc) => {
        try {
          doc?.destroy?.();
        } catch (_) {
          /* ignore */
        }
      });
      pdfCacheRef.current = {};
    };
  }, []);

  // 🔹 북마크/형광펜 로드 (한 번만)
  useEffect(() => {
    const localBookmarks = safeParseJSON(
      safeGetLocalStorage("gyul-pdf-bookmarks"),
      [],
    );
    if (Array.isArray(localBookmarks) && localBookmarks.length > 0) {
      setBookmarks(localBookmarks);
    }

    const localHighlights = safeParseJSON(
      safeGetLocalStorage("gyul-pdf-highlights"),
      [],
    );
    if (Array.isArray(localHighlights)) {
      setHighlights(localHighlights);
    }

    let cancelled = false;
    (async () => {
      if (!ipcRenderer) return;
      try {
        const fileBookmarks = await ipcRenderer.invoke("load-bookmarks");
        if (
          !cancelled &&
          Array.isArray(fileBookmarks) &&
          fileBookmarks.length > 0
        ) {
          setBookmarks(fileBookmarks);
        }
      } catch (e) {
        console.warn("파일에서 북마크 로드 실패:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 북마크 저장 (디바운스 + 첫 마운트 스킵)
  const bookmarksMountedRef = useRef(false);
  useEffect(() => {
    if (!bookmarksMountedRef.current) {
      bookmarksMountedRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      safeSetLocalStorage("gyul-pdf-bookmarks", JSON.stringify(bookmarks));
      if (ipcRenderer) {
        try {
          ipcRenderer.send("save-bookmarks", bookmarks);
        } catch (e) {
          console.warn("save-bookmarks IPC 실패:", e);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [bookmarks]);

  // 형광펜 저장 (디바운스 + 첫 마운트 스킵)
  const highlightsMountedRef = useRef(false);
  useEffect(() => {
    if (!highlightsMountedRef.current) {
      highlightsMountedRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      safeSetLocalStorage("gyul-pdf-highlights", JSON.stringify(highlights));
    }, 300);
    return () => clearTimeout(timer);
  }, [highlights]);

  // 페이지 입력 동기화
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // 활성 탭 상태 동기화 (썸네일/pageTexts 배열은 RAM 절약을 위해 탭에 보관하지 않음)
  useEffect(() => {
    if (!activeTabId) return;

    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeTabId);
      if (idx === -1) return prev;
      const tab = prev[idx];
      if (
        tab.fileName === fileName &&
        tab.filePath === filePath &&
        tab.pdf === pdf &&
        tab.totalPages === totalPages &&
        tab.currentPage === currentPage &&
        tab.pageInput === pageInput &&
        tab.scale === scale &&
        tab.searchQuery === searchQuery &&
        tab.searchMatches === searchMatches &&
        tab.searchIndex === searchIndex
      ) {
        return prev;
      }
      const next = prev.slice();
      next[idx] = {
        ...tab,
        fileName,
        filePath,
        pdf,
        totalPages,
        currentPage,
        pageInput,
        scale,
        searchQuery,
        searchMatches,
        searchIndex,
        docKey: tab.docKey || docKeyRef.current,
      };
      return next;
    });
  }, [
    activeTabId,
    fileName,
    filePath,
    pdf,
    totalPages,
    currentPage,
    pageInput,
    scale,
    searchQuery,
    searchMatches,
    searchIndex,
  ]);

  // 검색 하이라이트(파란색)
  const applySearchHighlightForPage = useCallback((pageNum, query) => {
    const q = (query ?? "").trim();
    const textLayerDiv = textLayerRefs.current[pageNum - 1];
    if (!textLayerDiv) return;

    const spans = textLayerDiv.querySelectorAll("span[data-span-index]");

    if (!q) {
      spans.forEach((span) => {
        const el = span;
        const rawText = el.dataset.rawText || el.textContent || "";
        el.innerHTML = "";
        el.appendChild(document.createTextNode(rawText));
      });
      return;
    }

    const lowerQ = q.toLowerCase();

    spans.forEach((span) => {
      const el = span;
      const rawText = el.dataset.rawText || el.textContent || "";
      const fullText = rawText;
      const lowerText = fullText.toLowerCase();

      let index = lowerText.indexOf(lowerQ);
      if (index === -1) {
        el.innerHTML = "";
        el.appendChild(document.createTextNode(fullText));
        return;
      }

      const frag = document.createDocumentFragment();
      let lastIndex = 0;

      while (index !== -1) {
        if (index > lastIndex) {
          frag.appendChild(
            document.createTextNode(fullText.slice(lastIndex, index)),
          );
        }
        const mark = document.createElement("span");
        mark.textContent = fullText.slice(index, index + q.length);
        mark.style.backgroundColor = "rgba(10, 59, 255, 0.8)";
        frag.appendChild(mark);
        lastIndex = index + q.length;
        index = lowerText.indexOf(lowerQ, lastIndex);
      }

      if (lastIndex < fullText.length) {
        frag.appendChild(document.createTextNode(fullText.slice(lastIndex)));
      }

      el.innerHTML = "";
      el.appendChild(frag);
    });
  }, []);

  // Ctrl+Z: 마지막 형광펜 삭제
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!fileName) return;

        setHighlights((prev) => {
          let targetIndex = -1;
          let latest = -Infinity;

          for (let i = 0; i < prev.length; i++) {
            const h = prev[i];
            if (h.fileName !== fileName) continue;
            const t = h.createdAt || 0;
            if (t >= latest) {
              latest = t;
              targetIndex = i;
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

  const getPageStride = useCallback(
    (scaleVal = scale) => {
      const h =
        basePageHeightRef.current && baseScaleRef.current
          ? (basePageHeightRef.current * scaleVal) / baseScaleRef.current
          : FALLBACK_PAGE_H_PT * INITIAL_SCALE;
      return h + PAGE_MARGIN_BOTTOM;
    },
    [scale],
  );

  const pageFromScrollTop = useCallback(
    (scrollTop, scaleVal = scale) => {
      const stride = getPageStride(scaleVal);
      if (stride <= 0) return 1;
      return Math.min(
        totalPages || 1,
        Math.max(1, Math.floor(scrollTop / stride) + 1),
      );
    },
    [getPageStride, totalPages, scale],
  );

  const ensureMountRange = useCallback(
    (centerPage) => {
      if (!totalPages) return { lo: 1, hi: 1, changed: false };
      const center = Math.min(
        totalPages,
        Math.max(1, centerPage || currentPageRef.current || 1),
      );
      const lo = Math.max(1, center - MOUNT_BUFFER);
      const hi = Math.min(totalPages, center + MOUNT_BUFFER);
      const prev = mountRangeRef.current;
      if (prev.lo === lo && prev.hi === hi) return { lo, hi, changed: false };
      mountRangeRef.current = { lo, hi };
      setMountRange({ lo, hi });
      return { lo, hi, changed: true };
    },
    [totalPages],
  );

  // 🔹 윈도잉: 보이는 페이지 ± WINDOW_SIZE만 그리고, KEEP_RENDERED_RANGE를 벗어난 페이지는 해제
  const computeRenderTargets = (total) => {
    const visible = visiblePagesRef.current;
    const cp = currentPageRef.current || 1;

    const centers = new Set();
    if (visible.size > 0) {
      visible.forEach((p) => centers.add(p));
    } else {
      centers.add(cp);
    }

    const renderTargets = new Set();
    const keepTargets = new Set();

    centers.forEach((c) => {
      for (let k = -WINDOW_SIZE; k <= WINDOW_SIZE; k++) {
        const p = c + k;
        if (p >= 1 && p <= total) renderTargets.add(p);
      }
      for (let k = -KEEP_RENDERED_RANGE; k <= KEEP_RENDERED_RANGE; k++) {
        const p = c + k;
        if (p >= 1 && p <= total) keepTargets.add(p);
      }
    });

    return { renderTargets, keepTargets };
  };

  // 렌더 큐 정렬: 현재 페이지 → 인접 → 나머지 (거리순)
  const buildRenderQueue = (renderTargets, tier) => {
    const cp = currentPageRef.current || 1;
    const queue = [];
    renderTargets.forEach((p) => {
      const q = pageQualityRef.current.get(p);
      if (tier === "full" && q === "full") return;
      if (tier === "preview" && (q === "preview" || q === "full")) return;
      if (pageRenderTasksRef.current.has(p)) return;
      queue.push(p);
    });
    const score = (p) => {
      if (p === cp) return 0;
      if (Math.abs(p - cp) === 1) return 1;
      return 2 + Math.abs(p - cp);
    };
    queue.sort((a, b) => score(a) - score(b));
    return queue;
  };

  const pickNextFromQueue = (queue) => {
    if (!queue.length) return null;
    const cp = currentPageRef.current || 1;
    const idx = queue.indexOf(cp);
    if (idx >= 0) return queue.splice(idx, 1)[0];
    return queue.shift();
  };

  // 현재 보고 있는 페이지를 선명(full)하게 — 스크롤 멈춤·페이지 변경 시
  const ensureCurrentPageFull = useCallback(async () => {
    if (!pdf || isScrollingRef.current) return;
    const p = currentPageRef.current || 1;
    if (pageQualityRef.current.get(p) === "full") return;

    const gen = renderGenerationRef.current;
    if (!renderedPagesRef.current.has(p)) {
      await renderPage(p, scale, { tier: "preview" });
    }
    if (gen !== renderGenerationRef.current) return;
    if (pageQualityRef.current.get(p) === "full") return;
    await renderPage(p, scale, { tier: "full" });
  }, [pdf, scale]);

  const cancelAllPageRenderTasks = () => {
    pageRenderTasksRef.current.forEach((task) => {
      try {
        task.cancel();
      } catch (_) {
        /* ignore */
      }
    });
    pageRenderTasksRef.current.clear();
  };

  // keepSet에 포함되지 않은 페이지의 렌더 작업만 취소
  // (멀리 점프할 때 워커를 즉시 해제하여 target 페이지를 우선 처리)
  const cancelRenderTasksExcept = (keepSet) => {
    const tasks = pageRenderTasksRef.current;
    Array.from(tasks.entries()).forEach(([pageNum, task]) => {
      if (keepSet && keepSet.has(pageNum)) return;
      try {
        task.cancel();
      } catch (_) {
        /* ignore */
      }
      tasks.delete(pageNum);
    });
  };

  // 특정 페이지의 캔버스/텍스트 레이어 픽셀 메모리를 해제
  // (페이지 컨테이너의 CSS 크기는 estimatedPageHeight로 유지되어 스크롤 위치 보존)
  const releasePageMemory = (pageNum) => {
    const canvas = canvasRefs.current[pageNum - 1];
    const highlightCanvas = highlightCanvasRefs.current[pageNum - 1];
    const textLayerDiv = textLayerRefs.current[pageNum - 1];

    const task = pageRenderTasksRef.current.get(pageNum);
    if (task) {
      try {
        task.cancel();
      } catch (_) {
        /* ignore */
      }
      pageRenderTasksRef.current.delete(pageNum);
    }

    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = "";
      canvas.style.height = "";
    }
    if (highlightCanvas) {
      highlightCanvas.width = 0;
      highlightCanvas.height = 0;
      highlightCanvas.style.width = "";
      highlightCanvas.style.height = "";
    }
    if (textLayerDiv) {
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.width = "";
      textLayerDiv.style.height = "";
    }
    renderedPagesRef.current.delete(pageNum);
    pageQualityRef.current.delete(pageNum);
  };

  const releaseAllPagesMemory = () => {
    for (let p = 1; p <= totalPages; p++) {
      releasePageMemory(p);
    }
  };

  const layoutCanvasForPage = (num, scaleVal = scale) => {
    const canvas = canvasRefs.current[num - 1];
    if (!canvas) return null;
    const baseW = basePageWidthRef.current;
    const baseH = basePageHeightRef.current;
    const baseS = baseScaleRef.current;
    if (!baseW || !baseH || !baseS) return null;

    const cssWidth = (baseW * scaleVal) / baseS;
    const cssHeight = (baseH * scaleVal) / baseS;
    const outputScale = getOutputScale();
    const pxWidth = Math.floor(cssWidth * outputScale);
    const pxHeight = Math.floor(cssHeight * outputScale);
    const highlightCanvas = highlightCanvasRefs.current[num - 1];
    const pageContainer = pageContainerRefs.current[num - 1];
    try {
      sizeUpCanvas(
        canvas,
        highlightCanvas,
        pageContainer,
        cssWidth,
        cssHeight,
        pxWidth,
        pxHeight,
      );
    } catch (_) {
      return null;
    }
    return { canvas, cssWidth, cssHeight, pxWidth, pxHeight };
  };

  const drawImageOnPageCanvas = (num, src, scaleVal = scale) => {
    if (!num || !src) return false;
    if (renderedPagesRef.current.has(num)) return false;
    const layout = layoutCanvasForPage(num, scaleVal);
    if (!layout) return false;

    const { canvas } = layout;
    const generation = renderGenerationRef.current;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (generation !== renderGenerationRef.current) return;
      if (renderedPagesRef.current.has(num)) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } catch (_) {
        /* ignore */
      }
      img.onload = null;
      img.src = "";
    };
    img.src = src;
    return true;
  };

  const drawPreviewFromThumb = (num) => {
    const thumb = thumbnailsRef.current?.[num - 1];
    if (!thumb) return false;
    return drawImageOnPageCanvas(num, thumb);
  };

  const applyCachedRenderToPage = async (
    num,
    cached,
    scaleValue = scale,
    generation = renderGenerationRef.current,
  ) => {
    if (!cached?.imageBlob) return false;
    const canvas = canvasRefs.current[num - 1];
    const textLayerDiv = textLayerRefs.current[num - 1];
    const highlightCanvas = highlightCanvasRefs.current[num - 1];
    const pageContainer = pageContainerRefs.current[num - 1];
    if (!canvas || !textLayerDiv) return false;

    const outputScale = getOutputScale();
    const cssWidth = cached.cssWidth;
    const cssHeight = cached.cssHeight;
    const pxWidth = Math.floor(cssWidth * outputScale);
    const pxHeight = Math.floor(cssHeight * outputScale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    sizeUpCanvas(
      canvas,
      highlightCanvas,
      pageContainer,
      cssWidth,
      cssHeight,
      pxWidth,
      pxHeight,
    );

    let bitmap = null;
    try {
      bitmap = await createImageBitmap(cached.imageBlob);
    } catch (_) {
      bitmap = null;
    }
    if (generation !== renderGenerationRef.current) {
      try {
        bitmap?.close?.();
      } catch (_) {
        /* ignore */
      }
      return false;
    }

    if (!bitmap) return false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    try {
      bitmap.close?.();
    } catch (_) {
      /* ignore */
    }

    if (Array.isArray(cached.textLayer)) {
      paintTextLayerFromData(
        textLayerDiv,
        cached.textLayer,
        cssWidth,
        cssHeight,
      );
    } else if (pdf) {
      try {
        const page = await pdf.getPage(num);
        if (generation === renderGenerationRef.current) {
          const viewport = page.getViewport({
            scale: scaleValue,
            rotation: page.rotate,
          });
          await renderTextLayerOnPage(page, viewport, textLayerDiv);
        }
      } catch (_) {
        /* ignore */
      }
    }

    applySearchHighlightForPage(num, searchQuery);
    updateThumbnailFromCanvas(num, canvas);
    renderedPagesRef.current.add(num);
    pageQualityRef.current.set(num, "full");
    return true;
  };

  // 멀리 점프 직후: 캐시/썸네일로 회색 화면을 즉시 채움
  const paintJumpPlaceholder = async (num, scaleValue = scale) => {
    if (!num || renderedPagesRef.current.has(num)) return true;
    if (drawPreviewFromThumb(num)) return true;

    const docKey = docKeyRef.current;
    if (docKey) {
      try {
        const [cachedThumb, outputScale] = await Promise.all([
          pdfCache.getThumb(docKey, num),
          Promise.resolve(getOutputScale()),
        ]);
        if (cachedThumb && drawImageOnPageCanvas(num, cachedThumb, scaleValue)) {
          return true;
        }
        const renderKey = makeRenderKey(docKey, num, scaleValue, outputScale);
        const cached = await pdfCache.getRender(renderKey);
        if (
          cached &&
          (await applyCachedRenderToPage(
            num,
            cached,
            scaleValue,
            renderGenerationRef.current,
          ))
        ) {
          return true;
        }
      } catch (_) {
        /* ignore */
      }
    }

    try {
      const dataUrl = await renderThumbnailForPage(num);
      if (dataUrl) {
        writeThumbnail(num, dataUrl);
        drawImageOnPageCanvas(num, dataUrl, scaleValue);
        return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  };

  const resetRenderState = () => {
    renderedPagesRef.current = new Set();
    pageQualityRef.current = new Map();
    backgroundRenderPausedRef.current = false;
    renderGenerationRef.current += 1;
    cancelAllPageRenderTasks();
  };

  // PDF 문서 닫기: 활성 문서면 렌더 취소 후 main 프로세스 docId 해제
  const teardownPdf = useCallback((pdfDoc) => {
    if (!pdfDoc) return;
    if (activePdfRef.current === pdfDoc) {
      resetRenderState();
      cancelAllPageRenderTasks();
    }
    try {
      pdfDoc.destroy();
    } catch (_) {
      /* ignore */
    }
  }, []);

  const isRenderCancelledError = engineIsRenderCancelledError;

  // 캔버스를 특정 크기로 셋업
  const sizeUpCanvas = (canvas, highlightCanvas, pageContainer, cssWidth, cssHeight, pxWidth, pxHeight) => {
    canvas.width = pxWidth;
    canvas.height = pxHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    if (highlightCanvas) {
      highlightCanvas.width = pxWidth;
      highlightCanvas.height = pxHeight;
      highlightCanvas.style.width = `${cssWidth}px`;
      highlightCanvas.style.height = `${cssHeight}px`;
    }
    if (pageContainer) {
      pageContainer.style.width = `${cssWidth}px`;
      pageContainer.style.height = `${cssHeight}px`;
    }
  };

  // 🔹 본문 캔버스에서 썸네일 추출(보너스 경로 - 본문이 그려진 김에 만들기)
  const trimThumbnailsRam = useCallback(
    (centerPage) => {
      if (!totalPages) return;
      const center = centerPage || currentPageRef.current || 1;
      const lo = Math.max(1, center - THUMB_RAM_RADIUS);
      const hi = Math.min(totalPages, center + THUMB_RAM_RADIUS);
      setThumbnails((prev) => {
        if (!prev?.length) return prev;
        let changed = false;
        const next = [...prev];
        for (let i = 0; i < next.length; i++) {
          const p = i + 1;
          if (next[i] && (p < lo || p > hi)) {
            next[i] = null;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [totalPages],
  );

  const writeThumbnail = (num, dataUrl) => {
    if (!dataUrl) return;
    thumbDoneRef.current.add(num);
    setThumbnails((prev) => {
      const length = (prev && prev.length) || totalPages || num;
      const next =
        prev && prev.length === length
          ? [...prev]
          : new Array(length).fill(null);
      if (next[num - 1]) return next;
      next[num - 1] = dataUrl;
      return next;
    });
    const docKey = docKeyRef.current;
    if (docKey) {
      pdfCache.setThumb(docKey, num, dataUrl).catch(() => {});
    }
  };

  const hydrateThumbFromCache = useCallback(async (pageNum) => {
    const docKey = docKeyRef.current;
    if (!docKey || pageNum < 1) return false;
    if (thumbnailsRef.current?.[pageNum - 1]) return true;
    try {
      const url = await pdfCache.getThumb(docKey, pageNum);
      if (url) {
        writeThumbnail(pageNum, url);
        return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }, []);

  const updateThumbnailFromCanvas = (num, canvas) => {
    if (thumbDoneRef.current.has(num)) return;
    try {
      if (!canvas.width || !canvas.height) return;
      const ratio = canvas.height / canvas.width || 1;
      const thumbW = getThumbPixelWidth();
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = thumbW;
      thumbCanvas.height = Math.max(1, Math.round(thumbW * ratio));
      const tctx = thumbCanvas.getContext("2d");
      if (!tctx) return;
      tctx.drawImage(
        canvas,
        0,
        0,
        canvas.width,
        canvas.height,
        0,
        0,
        thumbCanvas.width,
        thumbCanvas.height,
      );
      const dataUrl = thumbCanvas.toDataURL("image/jpeg", THUMB_JPEG_QUALITY);
      writeThumbnail(num, dataUrl);
    } catch (e) {
      console.warn("썸네일 생성 실패:", e);
    }
  };

  // 🔹 저배율 전용 썸네일 렌더링 (본문과 독립적, 매우 빠름)
  const renderThumbnailForPage = async (num) => {
    if (!pdf) return null;
    if (thumbDoneRef.current.has(num)) return null;
    try {
      const thumbW = getThumbPixelWidth();
      const page = await pdf.getPage(num);
      const baseViewport = page.getViewport({
        scale: 1.0,
        rotation: page.rotate,
      });
      const thumbScale = thumbW / baseViewport.width;
      const viewport = page.getViewport({
        scale: thumbScale,
        rotation: page.rotate,
      });

      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = Math.max(1, Math.floor(viewport.width));
      thumbCanvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = thumbCanvas.getContext("2d");
      if (!ctx) return null;

      await page.render({ canvasContext: ctx, viewport }).promise;
      return thumbCanvas.toDataURL("image/jpeg", THUMB_JPEG_QUALITY);
    } catch (e) {
      // 페이지 객체 무효 등은 무시
      return null;
    }
  };

  // 🔹 우선순위 큐 워커: N개 슬롯 병렬 처리 + requestIdleCallback로 양보
  const startThumbWorker = () => {
    if (thumbWorkerActiveRef.current) return;
    if (!pdf) return;
    // 본문 우선: 본문이 첫 페이지를 그리기 전엔 새 썸네일 렌더링을 시작하지 않음
    // (요청은 큐에 쌓아두었다가 본문이 준비되면 즉시 처리)
    if (!bodyFirstReadyRef.current) return;
    thumbWorkerActiveRef.current = true;

    // 포어그라운드에서는 UI에 양보 (requestIdleCallback),
    // 백그라운드(hidden)에서는 throttle 회피를 위해 즉시 다음 단계 (setTimeout)
    const yieldNext = (cb) => {
      if (typeof document !== "undefined" && document.hidden) {
        setTimeout(cb, 0);
      } else if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(cb, { timeout: 200 });
      } else {
        setTimeout(cb, 0);
      }
    };

    const generationAtStart = renderGenerationRef.current;
    let activeSlots = 0;

    const pickNext = () => {
      const queue = thumbRequestQueueRef.current;
      while (queue.length) {
        const p = queue.shift();
        if (
          !p ||
          thumbDoneRef.current.has(p) ||
          thumbInProgressRef.current.has(p)
        )
          continue;
        return p;
      }
      // 큐가 비면 현재 페이지 주변만 생성 (전체 문서 스캔 방지)
      const total = totalPages || 0;
      const cp = currentPageRef.current || 1;
      for (let d = 0; d <= total; d++) {
        for (const p of [cp - d, cp + d]) {
          if (
            p >= 1 &&
            p <= total &&
            !thumbDoneRef.current.has(p) &&
            !thumbInProgressRef.current.has(p)
          ) {
            return p;
          }
        }
      }
      return null;
    };

    const slotStep = async () => {
      if (
        !thumbWorkerActiveRef.current ||
        generationAtStart !== renderGenerationRef.current
      ) {
        activeSlots = Math.max(0, activeSlots - 1);
        if (activeSlots === 0) thumbWorkerActiveRef.current = false;
        return;
      }
      const next = pickNext();
      if (next == null) {
        activeSlots = Math.max(0, activeSlots - 1);
        if (activeSlots === 0) thumbWorkerActiveRef.current = false;
        return;
      }

      thumbInProgressRef.current.add(next);
      try {
        const dataUrl = await renderThumbnailForPage(next);
        if (generationAtStart !== renderGenerationRef.current) {
          activeSlots = Math.max(0, activeSlots - 1);
          if (activeSlots === 0) thumbWorkerActiveRef.current = false;
          return;
        }
        if (dataUrl) {
          writeThumbnail(next, dataUrl);
        } else {
          thumbDoneRef.current.add(next);
        }
      } catch (_) {
        thumbDoneRef.current.add(next);
      } finally {
        thumbInProgressRef.current.delete(next);
      }
      // 다음 페이지로 (idle 시간에 양보)
      yieldNext(slotStep);
    };

    // N개 슬롯을 동시에 띄움 (각 슬롯이 한 페이지씩 처리)
    const slots = Math.max(1, THUMB_RENDER_CONCURRENCY);
    for (let i = 0; i < slots; i++) {
      activeSlots += 1;
      yieldNext(slotStep);
    }
  };

  // 🔹 백그라운드 사전 렌더: DOM 캔버스 건드리지 않고 오프스크린 캔버스로 렌더해서 IndexedDB에만 저장
  //    - 사용자가 다른 창으로 잠시 자리 비웠을 때 모든 페이지를 미리 캐싱
  //    - 다시 돌아와 스크롤하면 캐시 hit으로 즉시 표시됨
  const prerenderInFlightRef = useRef(new Set());
  const prerenderDoneRef = useRef(new Set());

  const renderPageToCache = async (num) => {
    if (!pdf) return false;
    const docKey = docKeyRef.current;
    if (!docKey) return false;

    const outputScale = getOutputScale();
    const scaleValue = scale;
    const renderKey = makeRenderKey(docKey, num, scaleValue, outputScale);

    // 이미 캐시되어 있으면 즉시 종료
    try {
      const cached = await pdfCache.getRender(renderKey);
      if (cached) return true;
    } catch (_) {
      /* ignore */
    }

    let page;
    try {
      page = await pdf.getPage(num);
    } catch (_) {
      return false;
    }

    const viewport = page.getViewport({
      scale: scaleValue,
      rotation: page.rotate,
    });
    const cssWidth = viewport.width;
    const cssHeight = viewport.height;
    const pxWidth = Math.floor(cssWidth * outputScale);
    const pxHeight = Math.floor(cssHeight * outputScale);

    const off = document.createElement("canvas");
    off.width = Math.max(1, pxWidth);
    off.height = Math.max(1, pxHeight);
    const ctx = off.getContext("2d");
    if (!ctx) return false;

    const transform =
      outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform,
    });

    try {
      await renderTask.promise;
    } catch (err) {
      if (isRenderCancelledError(err)) return false;
      return false;
    }

    // 텍스트 레이어 데이터도 함께 캐싱 (다음 표시에서 PDF.js 호출 회피)
    let textLayerData = null;
    try {
      const textContent = await page.getTextContent();
      textLayerData = computeTextLayerData(textContent, viewport);
    } catch (_) {
      textLayerData = null;
    }

    await new Promise((resolve) => {
      try {
        off.toBlob(
          (blob) => {
            if (!blob) {
              resolve();
              return;
            }
            pdfCache
              .setRender(renderKey, {
                docKey,
                imageBlob: blob,
                cssWidth,
                cssHeight,
                outputScale,
                textLayer: textLayerData,
              })
              .then(() => resolve())
              .catch(() => resolve());
          },
          "image/jpeg",
          0.85,
        );
      } catch (_) {
        resolve();
      }
    });

    return true;
  };

  // SidePage에서 호출하는 우선 요청 핸들러
  const requestThumbnail = useCallback(
    (pageNum) => {
      if (!pdf || !pageNum) return;
      if (pageNum < 1 || pageNum > totalPages) return;
      if (thumbnailsRef.current?.[pageNum - 1]) return;
      void hydrateThumbFromCache(pageNum).then((hit) => {
        if (hit) return;
        if (thumbDoneRef.current.has(pageNum)) return;
        const queue = thumbRequestQueueRef.current;
        const idx = queue.indexOf(pageNum);
        if (idx !== -1) queue.splice(idx, 1);
        queue.unshift(pageNum);
        startThumbWorker();
      });
    },
    [pdf, totalPages, hydrateThumbFromCache],
  );

  // 한 페이지 렌더 (캐시 hit이면 PDF.js 호출 우회)
  //   tier: 'preview' — 스크롤 중 빠른 저해상도, 'full' — 최종 화질(+텍스트 레이어)
  const renderPage = async (num, scaleValue = scale, options = {}) => {
    const tier = options.tier === "preview" ? "preview" : "full";
    const isPreview = tier === "preview";
    const isJump = !!options.jump;

    const canvas = canvasRefs.current[num - 1];
    const textLayerDiv = textLayerRefs.current[num - 1];
    const highlightCanvas = highlightCanvasRefs.current[num - 1];
    const pageContainer = pageContainerRefs.current[num - 1];

    if (!canvas || !textLayerDiv) return false;

    const existingQuality = pageQualityRef.current.get(num);
    if (tier === "full" && existingQuality === "full") return true;
    if (
      isPreview &&
      (existingQuality === "preview" || existingQuality === "full")
    ) {
      return true;
    }

    // preview → full 업그레이드 시 진행 중인 preview 렌더 취소
    if (tier === "full") {
      const prevTask = pageRenderTasksRef.current.get(num);
      if (prevTask) {
        try {
          prevTask.cancel();
        } catch (_) {
          /* ignore */
        }
        pageRenderTasksRef.current.delete(num);
      }
    }

    const generation = renderGenerationRef.current;
    const outputScale = getOutputScale();
    const docKey = docKeyRef.current;

    // 1) 캐시 hit — full 렌더(또는 점프 placeholder) 시 즉시 표시
    if (docKey && !isPreview) {
      const renderKey = makeRenderKey(docKey, num, scaleValue, outputScale);
      try {
        const cached = await pdfCache.getRender(renderKey);
        if (
          cached &&
          generation === renderGenerationRef.current &&
          (await applyCachedRenderToPage(
            num,
            cached,
            scaleValue,
            generation,
          ))
        ) {
          return true;
        }
      } catch (e) {
        console.warn("렌더 캐시 조회 실패:", e);
      }
    }

    // 2) 일반 렌더 - PDF.js로 그리기
    if (!pdf) return false;

    const page = await pdf.getPage(num);
    if (generation !== renderGenerationRef.current) return false;

    const viewport = page.getViewport({
      scale: scaleValue,
      rotation: page.rotate,
    });

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const prevTask = pageRenderTasksRef.current.get(num);
    if (prevTask) {
      try {
        prevTask.cancel();
      } catch (_) {
        /* ignore */
      }
      pageRenderTasksRef.current.delete(num);
    }

    const cssWidth = viewport.width;
    const cssHeight = viewport.height;
    const pxWidth = Math.floor(cssWidth * outputScale);
    const pxHeight = Math.floor(cssHeight * outputScale);

    sizeUpCanvas(
      canvas,
      highlightCanvas,
      pageContainer,
      cssWidth,
      cssHeight,
      pxWidth,
      pxHeight,
    );
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const transform =
      outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform,
      intent: isJump ? "jump" : isPreview ? "preview" : "display",
    });
    pageRenderTasksRef.current.set(num, renderTask);

    try {
      await renderTask.promise;
    } catch (err) {
      if (pageRenderTasksRef.current.get(num) === renderTask) {
        pageRenderTasksRef.current.delete(num);
      }
      if (isRenderCancelledError(err)) return false;
      throw err;
    }

    if (pageRenderTasksRef.current.get(num) === renderTask) {
      pageRenderTasksRef.current.delete(num);
    }

    if (generation !== renderGenerationRef.current) return false;

    pageQualityRef.current.set(num, tier);

    if (!isPreview) {
      const textLayerData = await renderTextLayerOnPage(
        page,
        viewport,
        textLayerDiv,
      );

      applySearchHighlightForPage(num, searchQuery);
      updateThumbnailFromCanvas(num, canvas);

      if (docKey) {
        const renderKey = makeRenderKey(docKey, num, scaleValue, outputScale);
        try {
          canvas.toBlob(
            (blob) => {
              if (!blob) return;
              pdfCache
                .setRender(renderKey, {
                  docKey,
                  imageBlob: blob,
                  cssWidth,
                  cssHeight,
                  outputScale,
                  textLayer: textLayerData,
                })
                .catch(() => {});
            },
            "image/jpeg",
            0.85,
          );
        } catch (_) {
          /* ignore */
        }
      }
    } else {
      applySearchHighlightForPage(num, searchQuery);
    }

    renderedPagesRef.current.add(num);
    return true;
  };

  // pdf/scale/totalPages 바뀔 때 렌더 기록 초기화 + 캔버스 픽셀 해제
  useEffect(() => {
    resetRenderState();
    releaseAllPagesMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, totalPages, scale]);

  // 가상 스크롤: 현재 페이지 주변만 DOM 마운트
  useEffect(() => {
    if (!pdf || !totalPages) return;
    const cp = currentPageRef.current || 1;
    const lo = Math.max(1, cp - MOUNT_BUFFER);
    const hi = Math.min(totalPages, cp + MOUNT_BUFFER);
    mountRangeRef.current = { lo, hi };
    setMountRange({ lo, hi });
  }, [pdf, totalPages]);

  // 스크롤 위치에 따라 마운트 범위 이동 (멀리 점프 시에는 jumpToPage가 직접 설정)
  const jumpScrollLockRef = useRef(false);
  const jumpInProgressRef = useRef(false);
  const pendingJumpScrollTopRef = useRef(null);

  // 가상 마운트 직후 스크롤을 페인트 전에 맞춤 (한 프레임 깜빡임·smooth 스크롤 방지)
  useLayoutEffect(() => {
    const top = pendingJumpScrollTopRef.current;
    if (top == null) return;
    const container = mainRef.current;
    if (!container) return;
    pendingJumpScrollTopRef.current = null;
    container.scrollTop = top;
  }, [mountRange.lo, mountRange.hi]);
  useEffect(() => {
    const container = mainRef.current;
    if (!container || !pdf || !totalPages) return;

    let scheduled = false;
    const onScroll = () => {
      if (jumpScrollLockRef.current) return;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const center = pageFromScrollTop(container.scrollTop);
        const lo = Math.max(1, center - MOUNT_BUFFER);
        const hi = Math.min(totalPages, center + MOUNT_BUFFER);
        const prev = mountRangeRef.current;
        if (prev.lo === lo && prev.hi === hi) return;
        mountRangeRef.current = { lo, hi };
        setMountRange({ lo, hi });
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [pdf, totalPages, scale, pageFromScrollTop]);

  // PDF 변경 시 썸네일 큐/상태 초기화 + 영구 캐시 일괄 로드
  useEffect(() => {
    thumbRequestQueueRef.current = [];
    thumbInProgressRef.current = new Set();
    thumbDoneRef.current = new Set();
    thumbWorkerActiveRef.current = false;
    // 본문이 다시 첫 페이지를 그릴 때까지 새 썸네일 렌더링은 보류
    bodyFirstReadyRef.current = false;

    if (!pdf || totalPages === 0) return;
    const docKey = docKeyRef.current;
    if (!docKey) return;

    let cancelled = false;
    (async () => {
      try {
        const cp = currentPageRef.current || 1;
        const lo = Math.max(1, cp - THUMB_RAM_RADIUS);
        const hi = Math.min(totalPages, cp + THUMB_RAM_RADIUS);
        const cached = await pdfCache.getThumbsInRange(docKey, lo, hi);
        if (cancelled) return;
        setThumbnails((prev) => {
          const next =
            prev?.length === totalPages
              ? [...prev]
              : new Array(totalPages).fill(null);
          cached.forEach((url, pageNum) => {
            if (!next[pageNum - 1]) {
              next[pageNum - 1] = url;
              thumbDoneRef.current.add(pageNum);
            }
          });
          return next;
        });
        if (bodyFirstReadyRef.current) startThumbWorker();
      } catch (_) {
        if (bodyFirstReadyRef.current) startThumbWorker();
      }
    })();

    // 안전 타임아웃: 본문 렌더가 늦어져도 1.5초 후엔 썸네일 워커 가동 (잠금 방지)
    const fallbackTimer = setTimeout(() => {
      if (cancelled) return;
      if (!bodyFirstReadyRef.current) {
        bodyFirstReadyRef.current = true;
        startThumbWorker();
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, totalPages]);

  // PDF 열림 직후: 현재 페이지 preview→full 우선 (첫 화면까지 시간 단축)
  useEffect(() => {
    if (!pdf || totalPages === 0) return;

    const cp = currentPageRef.current || currentPage || 1;
    ensureMountRange(cp);
    visiblePagesRef.current = new Set(
      [cp - 1, cp, cp + 1].filter((p) => p >= 1 && p <= totalPages),
    );

    if (!basePageWidthRef.current || !basePageHeightRef.current) {
      basePageWidthRef.current = FALLBACK_PAGE_W_PT * INITIAL_SCALE;
      basePageHeightRef.current = FALLBACK_PAGE_H_PT * INITIAL_SCALE;
      baseScaleRef.current = INITIAL_SCALE;
    }

    const gen = renderGenerationRef.current;
    const scaleNow = scale;

    void (async () => {
      backgroundRenderPausedRef.current = true;
      try {
        await renderPage(cp, scaleNow, { tier: "preview" });
        if (gen !== renderGenerationRef.current) return;
        await renderPage(cp, scaleNow, { tier: "full" });
        if (gen !== renderGenerationRef.current) return;
        bodyFirstReadyRef.current = true;
        startThumbWorker();
      } catch (_) {
        /* ignore */
      } finally {
        backgroundRenderPausedRef.current = false;
        setVisiblePagesVersion((v) => v + 1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, totalPages]);

  // 🔹 백그라운드 렌더 + 윈도우 밖 메모리 해제
  useEffect(() => {
    if (!pdf || totalPages === 0) return;
    if (jumpInProgressRef.current) return;

    const tier = isScrollingRef.current ? "preview" : "full";
    const { renderTargets, keepTargets } = computeRenderTargets(totalPages);

    const toRelease = [];
    renderedPagesRef.current.forEach((p) => {
      if (!keepTargets.has(p)) toRelease.push(p);
    });
    toRelease.forEach((p) => releasePageMemory(p));

    const queue = buildRenderQueue(renderTargets, tier);

    let cancelled = false;
    const generationAtStart = renderGenerationRef.current;
    const MAX_CONCURRENT = BODY_RENDER_CONCURRENCY;

    const worker = async () => {
      while (!cancelled && queue.length) {
        while (backgroundRenderPausedRef.current && !cancelled) {
          await new Promise((r) => setTimeout(r, 16));
        }
        const pageNum = pickNextFromQueue(queue);
        if (!pageNum) break;
        const activeTier = isScrollingRef.current ? "preview" : "full";
        try {
          const ok = await renderPage(pageNum, scale, { tier: activeTier });
          if (
            ok &&
            !cancelled &&
            generationAtStart === renderGenerationRef.current
          ) {
            if (!bodyFirstReadyRef.current) {
              bodyFirstReadyRef.current = true;
              startThumbWorker();
            }
          }
        } catch (e) {
          console.error(e);
        }
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT, queue.length); i++) {
      workers.push(worker());
    }

    return () => {
      cancelled = true;
    };
  }, [pdf, totalPages, scale, currentPage, visiblePagesVersion]);

  // 백그라운드 사전 렌더: hidden일 때 현재 페이지 주변만, 전체 문서 스캔 없음
  useEffect(() => {
    if (!pdf || totalPages === 0) return;
    prerenderInFlightRef.current = new Set();
    prerenderDoneRef.current = new Set();

    let cancelled = false;
    let prerenderCount = 0;
    const SLOTS = Math.max(1, Math.min(2, BODY_RENDER_CONCURRENCY - 1));

    const pickNext = () => {
      if (prerenderCount >= MAX_PRERENDER_PAGES) return null;
      const cp = currentPageRef.current || 1;
      const lo = Math.max(1, cp - PRERENDER_PAGE_RADIUS);
      const hi = Math.min(totalPages, cp + PRERENDER_PAGE_RADIUS);
      for (let d = 0; d <= PRERENDER_PAGE_RADIUS; d++) {
        for (const p of [cp - d, cp + d]) {
          if (p < lo || p > hi) continue;
          if (renderedPagesRef.current.has(p)) continue;
          if (pageRenderTasksRef.current.has(p)) continue;
          if (prerenderDoneRef.current.has(p)) continue;
          if (prerenderInFlightRef.current.has(p)) continue;
          return p;
        }
      }
      return null;
    };

    const slotLoop = async () => {
      while (!cancelled && document.hidden) {
        const p = pickNext();
        if (p == null) return;
        prerenderInFlightRef.current.add(p);
        try {
          await renderPageToCache(p);
          prerenderCount += 1;
          prerenderDoneRef.current.add(p);
        } catch (_) {
          prerenderDoneRef.current.add(p);
        } finally {
          prerenderInFlightRef.current.delete(p);
        }
      }
    };

    const startIfHidden = () => {
      if (!document.hidden || cancelled) return;
      prerenderCount = 0;
      for (let i = 0; i < SLOTS; i++) {
        void slotLoop();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        startIfHidden();
      }
      // visible 상태가 되면 slotLoop의 while 조건이 false가 되어 자연 종료
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    // 이미 hidden 상태로 들어와 있다면 즉시 시작
    if (document.hidden) startIfHidden();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, totalPages, scale]);

  // 형광펜(자유+글자) 캔버스에 그리기
  // - 현재 파일의 형광펜만 페이지별로 묶어 한 번에 그림
  // - 보이는 페이지 + 인접 페이지만 우선 처리하여 대용량 PDF에서도 가벼움
  const highlightsByPage = useMemo(() => {
    const map = new Map();
    if (!fileName) return map;
    highlights.forEach((h) => {
      if (h.fileName !== fileName) return;
      if (!map.has(h.page)) map.set(h.page, []);
      map.get(h.page).push(h);
    });
    return map;
  }, [highlights, fileName]);

  useEffect(() => {
    if (!pdf || totalPages === 0) return;
    if (!fileName) return;

    const visible = visiblePagesRef.current;
    const pagesToDraw = new Set();

    if (visible.size > 0) {
      visible.forEach((p) => {
        pagesToDraw.add(p);
        if (p > 1) pagesToDraw.add(p - 1);
        if (p < totalPages) pagesToDraw.add(p + 1);
      });
    } else {
      const around = 2;
      const cp = currentPageRef.current || 1;
      for (
        let p = Math.max(1, cp - around);
        p <= Math.min(totalPages, cp + around);
        p++
      ) {
        pagesToDraw.add(p);
      }
    }

    pagesToDraw.forEach((pageNum) => {
      const baseCanvas = canvasRefs.current[pageNum - 1];
      const highlightCanvas = highlightCanvasRefs.current[pageNum - 1];
      if (!baseCanvas || !highlightCanvas) return;

      const ctx = highlightCanvas.getContext("2d");
      if (!ctx) return;

      if (
        highlightCanvas.width !== baseCanvas.width ||
        highlightCanvas.height !== baseCanvas.height
      ) {
        highlightCanvas.width = baseCanvas.width;
        highlightCanvas.height = baseCanvas.height;
      } else {
        ctx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);
      }

      const pageHighlights = highlightsByPage.get(pageNum);
      if (!pageHighlights || pageHighlights.length === 0) return;

      pageHighlights.forEach((h) => {
        const x = h.x * highlightCanvas.width;
        const y = h.y * highlightCanvas.height;
        const w = h.width * highlightCanvas.width;
        const hgt = h.height * highlightCanvas.height;
        ctx.fillStyle = h.color || DEFAULT_HIGHLIGHT_COLOR;
        ctx.fillRect(x, y, w, hgt);
      });
    });
  }, [
    highlightsByPage,
    pdf,
    totalPages,
    scale,
    fileName,
    visiblePagesVersion,
    currentPage,
  ]);

  // PDF 로딩 (arrayBuffer 또는 sourcePath 중 하나 필수; path면 main에서 직접 열기)
  const loadPdfFromArrayBuffer = useCallback(
    async (
      arrayBuffer,
      name,
      sourcePath = null,
      initialPage = 1,
      options = {},
    ) => {
      const usePathOnly = !!sourcePath && !arrayBuffer;
      if (!arrayBuffer && !usePathOnly) return null;
      const makeActive = options.makeActive !== false; // 기본 true

      const docKey = makeDocKey({ filePath: sourcePath, fileName: name });

      // 1) 메타 캐시와 PDF 파싱 병렬 (순차 대기 제거)
      let cachedMeta = null;
      let pdfDoc;
      try {
        const metaPromise = pdfCache.getDocMeta(docKey).catch(() => null);
        const docPromise = usePathOnly
          ? getDocument({ path: sourcePath }).promise
          : getDocument({ data: arrayBuffer }).promise;
        [cachedMeta, pdfDoc] = await Promise.all([metaPromise, docPromise]);
      } catch (e) {
        console.error("PDF 로딩 실패:", e);
        alert(`PDF 파일을 여는 데 실패했습니다.\n${e?.message || e}`);
        return null;
      }

      const cacheKey = sourcePath || name;
      const prevCached = pdfCacheRef.current[cacheKey];
      if (prevCached && prevCached !== pdfDoc) {
        teardownPdf(prevCached);
      }
      pdfCacheRef.current[cacheKey] = pdfDoc;

      const total = pdfDoc.numPages;
      const thumbnailsInit = new Array(total).fill(null);
      const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // 3) 탭 추가/병합 - getPage(1) 기다리지 않고 즉시 UI 반영
      let resolvedTabId = newId;
      setTabs((prev) => {
        const byPath =
          sourcePath != null
            ? prev.find((t) => t.filePath === sourcePath)
            : null;
        const byName = prev.find((t) => t.fileName === name);
        const existing = byPath || byName;

        if (existing) {
          resolvedTabId = existing.id;
          if (existing.pdf && existing.pdf !== pdfDoc) {
            teardownPdf(existing.pdf);
          }
          return prev.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  pdf: pdfDoc,
                  docKey,
                  fileName: name,
                  filePath: sourcePath || t.filePath || null,
                  totalPages: total,
                  currentPage: initialPage,
                  pageInput: String(initialPage),
                  scale: INITIAL_SCALE,
                  thumbnails: thumbnailsInit,
                  pageTexts: [],
                  searchQuery: "",
                  searchMatches: [],
                  searchIndex: 0,
                }
              : t,
          );
        }

        return [
          ...prev,
          {
            id: newId,
            fileName: name,
            filePath: sourcePath,
            docKey,
            pdf: pdfDoc,
            totalPages: total,
            currentPage: initialPage,
            pageInput: String(initialPage),
            scale: INITIAL_SCALE,
            thumbnails: thumbnailsInit,
            pageTexts: [],
            searchQuery: "",
            searchMatches: [],
            searchIndex: 0,
          },
        ];
      });

      // 4) 활성화 여부에 따라 메인 뷰어 상태 갱신
      //    (병렬 로드 시 첫 파일만 활성화하여 보이는 페이지를 빠르게 렌더)
      if (makeActive) {
        docKeyRef.current = docKey;
        currentPageRef.current = initialPage;
        if (cachedMeta?.basePageWidth && cachedMeta?.basePageHeight) {
          docMetaRef.current = cachedMeta;
          basePageHeightRef.current = cachedMeta.basePageHeight;
          basePageWidthRef.current = cachedMeta.basePageWidth;
          baseScaleRef.current = INITIAL_SCALE;
        } else {
          basePageWidthRef.current = FALLBACK_PAGE_W_PT * INITIAL_SCALE;
          basePageHeightRef.current = FALLBACK_PAGE_H_PT * INITIAL_SCALE;
          baseScaleRef.current = INITIAL_SCALE;
        }
        setActiveTabId(resolvedTabId);
        setFileName(name);
        setFilePath(sourcePath || "");
        setPdf(pdfDoc);
        setTotalPages(total);
        setCurrentPage(initialPage);
        setPageInput(String(initialPage));
        setScale(INITIAL_SCALE);
        setThumbnails(thumbnailsInit);
        setPageTexts([]);
        setSearchQuery("");
        setSearchMatches([]);
        setSearchIndex(0);
      }

      // 5) 백그라운드: 첫 페이지 viewport 정밀 계산 + 메타 캐시 갱신
      //    loadDocument 시 firstPage 메타가 오면 getPage(1)은 IPC 없이 즉시 반환
      void (async () => {
        try {
          const firstPage = await pdfDoc.getPage(1);
          const firstViewport = firstPage.getViewport({
            scale: INITIAL_SCALE,
            rotation: firstPage.rotate,
          });
          if (docKeyRef.current === docKey) {
            basePageHeightRef.current = firstViewport.height;
            basePageWidthRef.current = firstViewport.width;
            baseScaleRef.current = INITIAL_SCALE;
          }
          const meta = {
            totalPages: total,
            basePageHeight: firstViewport.height,
            basePageWidth: firstViewport.width,
            baseScale: INITIAL_SCALE,
            docKey,
          };
          if (docKeyRef.current === docKey) {
            docMetaRef.current = meta;
          }
          pdfCache.setDocMeta(docKey, meta).catch(() => {});
        } catch (_) {
          /* ignore */
        }
      })();

      return resolvedTabId;
    },
    [teardownPdf],
  );

  const loadPdfFromPath = useCallback(
    async (filepath, initialPage = 1) => {
      if (!filepath) return;

      const name = filepath.split(/[/\\]/).pop() || "PDF";
      try {
        await loadPdfFromArrayBuffer(null, name, filepath, initialPage);
      } catch (err) {
        console.error("loadPdfFromPath 실패:", err);
        alert(
          `PDF 파일을 여는 데 실패했습니다.\n경로: ${filepath}\n${err?.message || ""}`,
        );
      }
    },
    [loadPdfFromArrayBuffer],
  );

  // 탭 상태에서 메인 뷰어 상태를 동기화
  const applyTabState = useCallback((tab) => {
    if (!tab) return;
    setActiveTabId(tab.id);
    setFileName(tab.fileName || "");
    setFilePath(tab.filePath || "");
    setPdf(tab.pdf || null);
    setTotalPages(tab.totalPages || 0);
    setCurrentPage(tab.currentPage || 1);
    setPageInput(tab.pageInput || String(tab.currentPage || 1));
    setScale(tab.scale || INITIAL_SCALE);
    setThumbnails(
      tab.totalPages ? new Array(tab.totalPages).fill(null) : [],
    );
    setPageTexts([]);
    pageTextsCacheRef.current = new Map();
    setSearchQuery(tab.searchQuery || "");
    setSearchMatches(tab.searchMatches || []);
    setSearchIndex(tab.searchIndex || 0);
    docKeyRef.current =
      tab.docKey ||
      (tab.filePath || tab.fileName
        ? makeDocKey({ filePath: tab.filePath, fileName: tab.fileName })
        : null);
    currentPageRef.current = tab.currentPage || 1;
    ensureMountRange(tab.currentPage || 1);
    resetRenderState();
  }, [ensureMountRange]);

  // 탭 선택: 비활성 탭 PDFium 해제, 필요 시 경로에서 다시 로드
  const handleSelectTab = useCallback(
    async (tabId) => {
      let tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      for (const t of tabs) {
        if (t.id !== tabId && t.pdf) {
          teardownPdf(t.pdf);
        }
      }
      setTabs((prev) =>
        prev.map((t) => (t.id !== tabId && t.pdf ? { ...t, pdf: null } : t)),
      );

      if (!tab.pdf && tab.filePath) {
        try {
          const doc = await getDocument({ path: tab.filePath }).promise;
          const cacheKey = tab.filePath || tab.fileName;
          if (cacheKey) pdfCacheRef.current[cacheKey] = doc;
          tab = { ...tab, pdf: doc };
          setTabs((prev) =>
            prev.map((t) => (t.id === tabId ? { ...t, pdf: doc } : t)),
          );
        } catch (e) {
          console.error("탭 PDF 재로드 실패:", e);
          return;
        }
      }

      applyTabState(tab);
    },
    [tabs, applyTabState, teardownPdf],
  );

  // 탭 닫기 (setState 콜백 안에서 다른 setState를 호출하지 않음)
  const handleCloseTab = useCallback(
    (tabId) => {
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;

      const closingTab = tabs[idx];
      const closingActive = tabId === activeTabId;
      const newTabs = tabs.slice(0, idx).concat(tabs.slice(idx + 1));
      const newActive = closingActive
        ? newTabs[idx] || newTabs[idx - 1] || null
        : null;

      setTabs(newTabs);

      if (closingTab?.pdf) {
        teardownPdf(closingTab.pdf);
      }
      const cacheKey = closingTab?.filePath || closingTab?.fileName;
      if (cacheKey && pdfCacheRef.current[cacheKey]) {
        delete pdfCacheRef.current[cacheKey];
      }
      const closedDocKey =
        closingTab?.docKey ||
        (closingTab?.filePath || closingTab?.fileName
          ? makeDocKey({
              filePath: closingTab.filePath,
              fileName: closingTab.fileName,
            })
          : null);
      if (closedDocKey) {
        pdfCache.clearDocCache(closedDocKey).catch(() => {});
      }

      if (closingActive) {
        if (newActive) {
          applyTabState(newActive);
        } else {
          setActiveTabId(null);
          setFileName("");
          setFilePath("");
          setPdf(null);
          setTotalPages(0);
          setCurrentPage(1);
          setPageInput("1");
          setScale(INITIAL_SCALE);
          setThumbnails([]);
          setPageTexts([]);
          setSearchQuery("");
          setSearchMatches([]);
          setSearchIndex(0);
          resetRenderState();
        }
      }
    },
    [tabs, activeTabId, applyTabState, teardownPdf],
  );

  // 🔹 여러 파일을 병렬로 로드 (첫 파일만 active, 나머지는 백그라운드 탭)
  const loadFilesParallel = useCallback(
    async (files) => {
      const pdfFiles = files.filter(
        (f) =>
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf"),
      );
      if (pdfFiles.length === 0) return;

      // arrayBuffer 변환은 빠르게 병렬 처리
      const buffers = await Promise.all(
        pdfFiles.map(async (f) => ({
          buf: await f.arrayBuffer().catch(() => null),
          name: f.name,
          path: f.path || null,
        })),
      );

      // 모든 PDF를 병렬로 파싱. 첫 번째 파일만 active로
      await Promise.allSettled(
        buffers.map(({ buf, name, path }, idx) => {
          if (!buf && !path) return Promise.resolve();
          return loadPdfFromArrayBuffer(path ? null : buf, name, path, 1, {
            makeActive: idx === 0,
          });
        }),
      );
    },
    [loadPdfFromArrayBuffer],
  );

  // 파일 열기 (input) - 다중 선택 + 병렬 로딩
  const handleFile = useCallback(
    async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      await loadFilesParallel(files);
      // 같은 파일을 다시 선택할 수 있도록 input 초기화
      e.target.value = "";
    },
    [loadFilesParallel],
  );

  // 🔹 컨테이너 드래그
  const handleDragOver = (e) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;

    const pdfFiles = files.filter(
      (f) =>
        f.type === "application/pdf" ||
        f.name.toLowerCase().endsWith(".pdf"),
    );

    if (pdfFiles.length === 0) {
      alert("PDF 파일만 열 수 있습니다.");
      return;
    }
    if (pdfFiles.length < files.length) {
      console.warn(
        `${files.length - pdfFiles.length}개 파일이 PDF가 아니어서 제외됨`,
      );
    }

    // 병렬 로딩: 첫 파일만 active로 만들어 즉시 보이고, 나머지는 백그라운드에서 탭만 추가
    await loadFilesParallel(pdfFiles);
  };

  const handleDragEnter = (e) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDragOver(true);
  };

  // 페이지 텍스트 캐시 (검색 시점에 지연 추출하여 큰 PDF의 초기 응답성 개선)
  // 추가: 렌더 캐시에 textLayer가 있으면 그 결과를 텍스트로 활용
  const pageTextsCacheRef = useRef(new Map());
  const trimPageTextCache = () => {
    const cache = pageTextsCacheRef.current;
    while (cache.size > MAX_PAGE_TEXT_CACHE_ENTRIES) {
      const first = cache.keys().next().value;
      if (first === undefined) break;
      cache.delete(first);
    }
  };
  useEffect(() => {
    pageTextsCacheRef.current = new Map();
    setPageTexts([]);
  }, [pdf]);

  const extractPageText = useCallback(
    async (pageNum) => {
      const cache = pageTextsCacheRef.current;
      if (cache.has(pageNum)) return cache.get(pageNum);

      // 1) 렌더 캐시의 textLayer에서 빠르게 합치기
      const docKey = docKeyRef.current;
      if (docKey) {
        try {
          const outputScale = getOutputScale();
          // 가장 흔한 INITIAL_SCALE 키부터 시도 (대표 캐시)
          const candidates = [scale, INITIAL_SCALE, 1, 2];
          const tried = new Set();
          for (const s of candidates) {
            if (tried.has(s)) continue;
            tried.add(s);
            const key = makeRenderKey(docKey, pageNum, s, outputScale);
            const cached = await pdfCache.getRender(key);
            if (cached?.textLayer && Array.isArray(cached.textLayer)) {
              let fullText = "";
              for (const d of cached.textLayer) {
                if (!d?.text) continue;
                if (fullText) fullText += " ";
                fullText += d.text;
              }
              cache.set(pageNum, fullText);
              trimPageTextCache();
              return fullText;
            }
          }
        } catch (_) {
          /* ignore */
        }
      }

      // 2) PDF.js로 추출
      if (!pdf) return "";
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        let fullText = "";
        const items = textContent.items || [];
        for (let k = 0; k < items.length; k++) {
          const str = items[k].str || "";
          if (!str) continue;
          if (fullText) fullText += " ";
          fullText += str;
        }
        cache.set(pageNum, fullText);
        trimPageTextCache();
        return fullText;
      } catch (_) {
        cache.set(pageNum, "");
        trimPageTextCache();
        return "";
      }
    },
    [pdf, scale],
  );

  // 검색 시: 모든 페이지 텍스트를 청크 단위로 병렬 추출 (캐시 활용)
  const ensureAllPageTexts = useCallback(async () => {
    if (!pdf || totalPages === 0) return [];
    const cache = pageTextsCacheRef.current;
    const missing = [];
    for (let i = 1; i <= totalPages; i++) {
      if (!cache.has(i)) missing.push(i);
    }
    const CHUNK = 8;
    for (let start = 0; start < missing.length; start += CHUNK) {
      const batch = missing.slice(start, start + CHUNK);
      await Promise.all(batch.map((p) => extractPageText(p)));
    }
    const result = new Array(totalPages);
    for (let i = 1; i <= totalPages; i++) {
      result[i - 1] = cache.get(i) || "";
    }
    return result;
  }, [pdf, totalPages, extractPageText]);

  // OS에서 처음 열린 PDF
  useEffect(() => {
    if (!ipcRenderer) return;

    const openInitialPdf = async () => {
      try {
        const filepath = await ipcRenderer.invoke("get-initial-pdf-path");
        if (filepath) {
          await loadPdfFromPath(filepath, 1);
        }
      } catch (err) {
        console.error("초기 PDF 로드 실패:", err);
      }
    };

    openInitialPdf();
  }, [loadPdfFromPath]);

  // 실행 중 다른 PDF 열기
  useEffect(() => {
    if (!ipcRenderer) return;

    const handler = (_event, filepath) => {
      if (filepath) {
        loadPdfFromPath(filepath, 1);
      }
    };

    ipcRenderer.on("open-pdf-from-os", handler);

    return () => {
      ipcRenderer.removeListener("open-pdf-from-os", handler);
    };
  }, [loadPdfFromPath]);

  // 🔹 스크롤 중 표시 (passive scroll listener로 부담 최소화)
  useEffect(() => {
    const container = mainRef.current;
    if (!container) return;

    const onScroll = () => {
      isScrollingRef.current = true;
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
      }
      // 스크롤 중에도 저해상도 프리뷰 렌더를 돌리기 위해 (rAF로 스로틀)
      if (!scrollRenderKickRef.current) {
        scrollRenderKickRef.current = requestAnimationFrame(() => {
          scrollRenderKickRef.current = null;
          setVisiblePagesVersion((v) => v + 1);
        });
      }
      scrollSettleTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        void (async () => {
          await ensureCurrentPageFull();
          setVisiblePagesVersion((v) => v + 1);
        })();
      }, SCROLL_SETTLE_MS);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
        scrollSettleTimerRef.current = null;
      }
      if (scrollRenderKickRef.current) {
        cancelAnimationFrame(scrollRenderKickRef.current);
        scrollRenderKickRef.current = null;
      }
    };
  }, [ensureCurrentPageFull]);

  // 현재 페이지가 바뀌면 해당 페이지 full 렌더 (jumpToPage가 이미 처리 중이면 생략)
  useEffect(() => {
    if (!pdf || !currentPage || isScrollingRef.current) return;
    if (jumpInProgressRef.current) return;
    trimThumbnailsRam(currentPage);
    void ensureCurrentPageFull();
  }, [currentPage, pdf, ensureCurrentPageFull, trimThumbnailsRam]);

  // Ctrl+휠 줌 (passive 회피용: native listener로 등록)
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    const container = mainRef.current;
    if (!container) return;

    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const clientY = e.clientY;
      const canvases = canvasRefs.current;
      let targetIndex = -1;
      let minDist = Infinity;

      for (let idx = 0; idx < canvases.length; idx++) {
        const canvas = canvases[idx];
        if (!canvas) continue;
        const rect = canvas.getBoundingClientRect();

        if (clientY >= rect.top && clientY <= rect.bottom) {
          targetIndex = idx;
          minDist = 0;
          break;
        }
        const dist = Math.min(
          Math.abs(clientY - rect.top),
          Math.abs(clientY - rect.bottom),
        );
        if (dist < minDist) {
          targetIndex = idx;
          minDist = dist;
        }
      }

      if (targetIndex === -1) return;

      const targetCanvas = canvases[targetIndex];
      const pageRect = targetCanvas.getBoundingClientRect();
      const relY = (clientY - pageRect.top) / pageRect.height;

      const prevScale = scaleRef.current;
      const isZoomOut = e.deltaY > 0;
      const nextScale = isZoomOut
        ? Math.max(prevScale - SCALE_STEP, MIN_SCALE)
        : Math.min(prevScale + SCALE_STEP, MAX_SCALE);

      if (nextScale === prevScale) return;

      setScale(nextScale);

      const savedRelY = relY;
      const savedTargetIndex = targetIndex;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const c = mainRef.current;
          const canvasAfter = canvasRefs.current[savedTargetIndex];
          if (!c || !canvasAfter) return;

          const rectAfter = canvasAfter.getBoundingClientRect();
          const clampedRelY = Math.min(Math.max(savedRelY, 0), 1);
          const targetY = rectAfter.top + clampedRelY * rectAfter.height;
          const delta = targetY - clientY;

          let newScrollTop = c.scrollTop + delta;
          const maxScrollTop = c.scrollHeight - c.clientHeight;
          if (newScrollTop < 0) newScrollTop = 0;
          if (newScrollTop > maxScrollTop) newScrollTop = maxScrollTop;

          c.scrollTop = newScrollTop;
        });
      });
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // IntersectionObserver로 현재 페이지 + 보이는 페이지 추적
  useEffect(() => {
    if (!pdf || totalPages === 0) return;
    if (!mainRef.current) return;

    const root = mainRef.current;
    let visibleScheduled = false;
    const scheduleVisibleUpdate = () => {
      if (visibleScheduled) return;
      visibleScheduled = true;
      requestAnimationFrame(() => {
        visibleScheduled = false;
        setVisiblePagesVersion((v) => v + 1);
      });
    };

    // 현재 페이지 추적도 별도 rAF로 코얼레싱 (스크롤마다 setState 폭주 방지)
    let pageScheduled = false;
    let pendingBestPage = null;
    const scheduleCurrentPageUpdate = () => {
      if (pageScheduled) return;
      pageScheduled = true;
      requestAnimationFrame(() => {
        pageScheduled = false;
        if (
          pendingBestPage != null &&
          pendingBestPage !== currentPageRef.current
        ) {
          setCurrentPage(pendingBestPage);
        }
        pendingBestPage = null;
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const container = mainRef.current;
        if (!container) return;

        let visibleChanged = false;
        entries.forEach((entry) => {
          const pageNum = Number(entry.target.dataset.page);
          if (!pageNum) return;

          if (entry.isIntersecting) {
            if (!visiblePagesRef.current.has(pageNum)) {
              visiblePagesRef.current.add(pageNum);
              visibleChanged = true;
            }
          } else {
            if (visiblePagesRef.current.delete(pageNum)) {
              visibleChanged = true;
            }
          }
        });
        if (visibleChanged) scheduleVisibleUpdate();

        const bottomGap =
          container.scrollHeight - container.scrollTop - container.clientHeight;

        if (bottomGap <= 8) {
          pendingBestPage = totalPages;
          scheduleCurrentPageUpdate();
          return;
        }

        let bestPage = currentPageRef.current;
        let bestRatio = 0;
        entries.forEach((entry) => {
          const pageNum = Number(entry.target.dataset.page);
          if (!pageNum) return;
          const ratio = entry.intersectionRatio;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = pageNum;
          }
        });

        if (bestRatio > 0) {
          pendingBestPage = bestPage;
          scheduleCurrentPageUpdate();
        }
      },
      {
        root,
        rootMargin: "200px 0px 200px 0px",
        // threshold 개수를 줄여 스크롤 중 콜백 발화 빈도를 낮춤
        threshold: [0, 0.5],
      },
    );

    pageContainerRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
      visiblePagesRef.current = new Set();
    };
  }, [pdf, totalPages, mountRange.lo, mountRange.hi]);

  // 북마크
  const toggleBookmarkPage = useCallback(
    (pageNum) => {
      if (!fileName) return;
      const key = `${fileName}-${pageNum}`;

      setBookmarks((prev) => {
        const exists = prev.some((b) => b.key === key);
        if (exists) return prev.filter((b) => b.key !== key);
        return [
          ...prev,
          {
            key,
            fileName,
            filePath: filePath || null,
            page: pageNum,
            date: new Date().toLocaleString(),
            label: "",
            folderId: null,
          },
        ];
      });
    },
    [fileName, filePath],
  );

  const computeScrollTopForPage = useCallback(
    (pageNum) => {
      const toolbar = toolbarRef.current;
      const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
      const stride = getPageStride();
      return Math.max(0, (pageNum - 1) * stride - toolbarHeight - 10);
    },
    [getPageStride],
  );

  // 스크롤로 페이지 이동 (O(1)). instant=true면 scrollTop 직접 대입(애니메이션 없음)
  const scrollToPage = useCallback(
    (pageNum, instant = false) => {
      const container = mainRef.current;
      if (!container) return;
      const top = computeScrollTopForPage(pageNum);
      if (instant) {
        container.scrollTop = top;
      } else {
        container.scrollTo({ top, behavior: "smooth" });
      }
    },
    [computeScrollTopForPage],
  );

  // ✅ 페이지 추정 높이/너비 (1페이지 기준, scale에 따라 변경)
  const estimatedPageHeight =
    basePageHeightRef.current && baseScaleRef.current
      ? (basePageHeightRef.current * scale) / baseScaleRef.current
      : null;
  const estimatedPageWidth =
    basePageWidthRef.current && baseScaleRef.current
      ? (basePageWidthRef.current * scale) / baseScaleRef.current
      : null;

  // 🔹 페이지 점프: 가상 마운트 → 동기 스크롤 → placeholder → 저해상도 → 선명(full)
  const jumpToPage = useCallback(
    (pageNum) => {
      if (!totalPages || !pdf) return;
      const target =
        pageNum < 1 ? 1 : pageNum > totalPages ? totalPages : pageNum;

      const cp = currentPageRef.current || 1;
      const isFar = Math.abs(target - cp) > KEEP_RENDERED_RANGE;

      jumpInProgressRef.current = true;
      jumpScrollLockRef.current = true;
      isScrollingRef.current = false;
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
        scrollSettleTimerRef.current = null;
      }

      const keepRendering = new Set([target, target - 1, target + 1]);
      cancelRenderTasksExcept(keepRendering);

      if (isFar) {
        const toRelease = [];
        renderedPagesRef.current.forEach((p) => {
          if (Math.abs(p - target) > KEEP_RENDERED_RANGE) toRelease.push(p);
        });
        toRelease.forEach((p) => releasePageMemory(p));
      }

      currentPageRef.current = target;
      const near = [];
      for (let k = -WINDOW_SIZE; k <= WINDOW_SIZE; k++) {
        const p = target + k;
        if (p >= 1 && p <= totalPages) near.push(p);
      }
      visiblePagesRef.current = new Set(near);

      const scrollTop = computeScrollTopForPage(target);
      pendingJumpScrollTopRef.current = scrollTop;
      const { changed: mountChanged } = ensureMountRange(target);
      if (!mountChanged) {
        pendingJumpScrollTopRef.current = null;
        const container = mainRef.current;
        if (container) container.scrollTop = scrollTop;
      }
      setCurrentPage(target);

      if (!thumbDoneRef.current.has(target)) requestThumbnail(target);

      backgroundRenderPausedRef.current = true;
      (async () => {
        const generationAtStart = renderGenerationRef.current;
        const neighbors = [target - 1, target + 1].filter(
          (p) => p >= 1 && p <= totalPages,
        );

        try {
          if (generationAtStart !== renderGenerationRef.current) return;

          await paintJumpPlaceholder(target, scale);
          for (const p of neighbors) drawPreviewFromThumb(p);

          if (pageQualityRef.current.get(target) !== "full") {
            await renderPage(target, scale, { tier: "preview", jump: true });
          }
          if (generationAtStart !== renderGenerationRef.current) return;

          if (!bodyFirstReadyRef.current) {
            bodyFirstReadyRef.current = true;
            startThumbWorker();
          }
        } catch (err) {
          console.error("priority render 실패:", err);
        } finally {
          backgroundRenderPausedRef.current = false;
          jumpInProgressRef.current = false;
          jumpScrollLockRef.current = false;
        }

        void renderPage(target, scale, { tier: "full" });
        void Promise.allSettled(
          neighbors.map((p) => renderPage(p, scale, { tier: "preview" })),
        ).then(() => {
          setVisiblePagesVersion((v) => v + 1);
        });
      })();
    },
    [
      pdf,
      totalPages,
      scale,
      requestThumbnail,
      ensureMountRange,
      computeScrollTopForPage,
    ],
  );

  // 북마크로 이동
  const goToBookmark = useCallback(async (bm) => {
    const targetTab = tabs.find((t) =>
      bm.filePath ? t.filePath === bm.filePath : t.fileName === bm.fileName,
    );
    if (targetTab) {
      handleSelectTab(targetTab.id);
      setTimeout(() => {
        jumpToPage(bm.page);
      }, 200);
    } else {
      const cacheKey = bm.filePath || bm.fileName;
      const cachedDoc = pdfCacheRef.current[cacheKey];
      if (cachedDoc) {
        const total = cachedDoc.numPages;
        const thumbnailsInit = new Array(total).fill(null);
        const tabId = `tab-${Date.now()}-${Math.random()}`;

        const newTab = {
          id: tabId,
          fileName: bm.fileName,
          filePath: bm.filePath || null,
          pdf: cachedDoc,
          totalPages: total,
          currentPage: bm.page,
          pageInput: String(bm.page),
          scale: INITIAL_SCALE,
          thumbnails: thumbnailsInit,
          pageTexts: [],
          searchQuery: "",
          searchMatches: [],
          searchIndex: 0,
        };

        setTabs((prev) => [...prev, newTab]);

        setActiveTabId(tabId);
        setFileName(bm.fileName);
        setFilePath(bm.filePath || "");
        setPdf(cachedDoc);
        setTotalPages(total);
        setCurrentPage(bm.page);
        setPageInput(String(bm.page));
        setScale(INITIAL_SCALE);
        setThumbnails(thumbnailsInit);
        setPageTexts([]);
        setSearchQuery("");
        setSearchMatches([]);
        setSearchIndex(0);

        resetRenderState();

        setTimeout(() => {
          jumpToPage(bm.page);
        }, 200);
      } else if (bm.filePath && ipcRenderer) {
        try {
          await loadPdfFromPath(bm.filePath, bm.page);
          setTimeout(() => {
            jumpToPage(bm.page);
          }, 200);
        } catch (e) {
          alert(
            `PDF 파일을 다시 여는 데 실패했습니다.\n경로: ${bm.filePath}\n파일이 옮겨졌는지 / 삭제되지 않았는지 확인해주세요.`,
          );
        }
      } else {
        alert(
          `이 북마크의 PDF("${bm.fileName}") 정보를 찾을 수 없습니다.\n파일을 직접 다시 열어주세요.`,
        );
      }
    }
  }, [tabs, handleSelectTab, jumpToPage, loadPdfFromPath]);

  // 줌
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  }, []);

  const handleResetZoom = useCallback(() => {
    setScale(ACTUAL_SIZE_SCALE);
  }, []);

  // 지우개: 좌표에 걸린 형광펜 한 개만 삭제
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

  // 자유영역 형광펜
  const handleCanvasMouseDown = (pageNum) => (e) => {
    if (isEraseMode) {
      eraseHighlightAtPoint(pageNum, e);
      return;
    }

    if (isTextHighlightMode) {
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

      const createdAt = Date.now();

      setHighlights((prev) => [
        ...prev,
        {
          id: `${fileName}-${page}-${createdAt}-${Math.random()}`,
          fileName,
          page,
          x: minX,
          y: minY,
          width,
          height,
          color: DEFAULT_HIGHLIGHT_COLOR,
          createdAt,
          type: "free",
        },
      ]);
    };

    window.addEventListener("mouseup", onMouseUp);
  };

  // 글자 형광펜
  const handleTextLayerMouseUp = (pageNum) => (e) => {
    const container = textLayerRefs.current[pageNum - 1];
    if (!container || !fileName) return;

    const selection = window.getSelection();
    if (!selection) return;

    if (isEraseMode) {
      eraseHighlightAtPoint(pageNum, e);
      selection.removeAllRanges();
      return;
    }

    if (!isTextHighlightMode) {
      return;
    }

    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);

    if (!container.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();
      return;
    }

    if (selection.isCollapsed) {
      selection.removeAllRanges();
      return;
    }

    const canvas = canvasRefs.current[pageNum - 1];
    if (!canvas) {
      selection.removeAllRanges();
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const rects = Array.from(range.getClientRects());

    const createdAtBase = Date.now();
    let offset = 0;
    const newHighlights = [];

    rects.forEach((rect) => {
      const left = Math.max(rect.left, canvasRect.left);
      const right = Math.min(rect.right, canvasRect.right);
      const top = Math.max(rect.top, canvasRect.top);
      const bottom = Math.min(rect.bottom, canvasRect.bottom);

      const widthPx = right - left;
      const heightPx = bottom - top;
      if (widthPx <= 0 || heightPx <= 0) return;

      const xNorm = (left - canvasRect.left) / canvasRect.width;
      const yNorm = (top - canvasRect.top) / canvasRect.height;
      const wNorm = widthPx / canvasRect.width;
      const hNorm = heightPx / canvasRect.height;

      const MIN_WIDTH = 0.005;
      const MIN_HEIGHT = 0.005;
      if (wNorm < MIN_WIDTH || hNorm < MIN_HEIGHT) return;

      const createdAt = createdAtBase + offset++;
      newHighlights.push({
        id: `${fileName}-${pageNum}-${createdAt}-${Math.random()}`,
        fileName,
        page: pageNum,
        x: xNorm,
        y: yNorm,
        width: wNorm,
        height: hNorm,
        color: DEFAULT_HIGHLIGHT_COLOR,
        createdAt,
        type: "text",
      });
    });

    if (newHighlights.length > 0) {
      setHighlights((prev) => [...prev, ...newHighlights]);
    }

    selection.removeAllRanges();
  };

  // 텍스트 검색 (검색 시점에 텍스트 추출)
  const isSearchingRef = useRef(false);
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchMatches([]);
      setSearchIndex(0);
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        applySearchHighlightForPage(pageNum, "");
      }
      return;
    }
    if (isSearchingRef.current) return;
    isSearchingRef.current = true;

    try {
      const texts = await ensureAllPageTexts();
      if (texts.length === 0) {
        setSearchMatches([]);
        setSearchIndex(0);
        return;
      }
      setPageTexts(texts);

      const lowerQ = q.toLowerCase();
      const matches = [];
      texts.forEach((text, idx) => {
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
      setSearchIndex(0);
      if (matches.length > 0) jumpToPage(matches[0].page);
    } finally {
      isSearchingRef.current = false;
    }
  }, [
    searchQuery,
    totalPages,
    ensureAllPageTexts,
    applySearchHighlightForPage,
    jumpToPage,
  ]);

  // 검색어 변경 시: DOM 원복 + 보이는 페이지에 즉시 하이라이트 반영
  useEffect(() => {
    if (!pdf || totalPages === 0) return;

    const q = searchQuery.trim();
    if (q === "") {
      setSearchMatches([]);
      setSearchIndex(0);
    }

    const pages = visiblePagesRef.current;
    if (pages.size > 0) {
      pages.forEach((p) => applySearchHighlightForPage(p, q));
    } else {
      const cp = currentPageRef.current || 1;
      const around = 2;
      for (
        let p = Math.max(1, cp - around);
        p <= Math.min(totalPages, cp + around);
        p++
      ) {
        applySearchHighlightForPage(p, q);
      }
    }
  }, [
    searchQuery,
    pdf,
    totalPages,
    visiblePagesVersion,
    applySearchHighlightForPage,
  ]);

  const gotoMatch = useCallback(
    (nextIndex) => {
      if (searchMatches.length === 0) return;
      const len = searchMatches.length;
      const idx = ((nextIndex % len) + len) % len;
      setSearchIndex(idx);
      jumpToPage(searchMatches[idx].page);
    },
    [searchMatches, jumpToPage],
  );

  const hasSearchResults = searchMatches.length > 0;
  const pdfLoaded = !!pdf;

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) jumpToPage(currentPage - 1);
  }, [currentPage, jumpToPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) jumpToPage(currentPage + 1);
  }, [currentPage, totalPages, jumpToPage]);

  const handlePageInputSubmit = useCallback(() => {
    const num = Number(pageInput);
    if (!Number.isNaN(num)) jumpToPage(num);
  }, [pageInput, jumpToPage]);

  const handleToggleHighlight = useCallback(() => {
    setIsHighlightMode((prev) => {
      const next = !prev;
      if (next) {
        setIsTextHighlightMode(false);
        setIsEraseMode(false);
      }
      return next;
    });
  }, []);

  const handleToggleTextHighlight = useCallback(() => {
    setIsTextHighlightMode((prev) => {
      const next = !prev;
      if (next) {
        setIsHighlightMode(false);
        setIsEraseMode(false);
      }
      return next;
    });
  }, []);

  const handleToggleErase = useCallback(() => {
    setIsEraseMode((prev) => {
      const next = !prev;
      if (next) {
        setIsHighlightMode(false);
        setIsTextHighlightMode(false);
      }
      return next;
    });
  }, []);

  // 탭 드래그
  const handleTabDragStart = useCallback((e, tabId) => {
    setDraggingTabId(tabId);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tabId);
    }
  }, []);

  const handleTabDragOver = useCallback(
    (e, targetTabId) => {
      e.preventDefault();
      if (!draggingTabId || draggingTabId === targetTabId) return;

      setTabs((prev) => {
        const fromIndex = prev.findIndex((t) => t.id === draggingTabId);
        const toIndex = prev.findIndex((t) => t.id === targetTabId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex)
          return prev;

        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [draggingTabId],
  );

  const handleTabDragEnd = useCallback(() => {
    setDraggingTabId(null);
  }, []);

  return (
    <Container
      $dragOver={isDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
    >
      {/* 왼쪽 페이지 사이드바 */}
      <PageSidebar
        totalPages={totalPages}
        currentPage={currentPage}
        thumbnails={thumbnails}
        fileName={fileName}
        bookmarks={bookmarks}
        isLeftCollapsed={isLeftCollapsed}
        setIsLeftCollapsed={setIsLeftCollapsed}
        showOnlyBookmarked={showOnlyBookmarked}
        setShowOnlyBookmarked={setShowOnlyBookmarked}
        thumbnailScale={thumbnailScale}
        setThumbnailScale={setThumbnailScale}
        jumpToPage={jumpToPage}
        toggleBookmarkPage={toggleBookmarkPage}
        onRequestThumbnail={requestThumbnail}
      />

      {/* 중앙 영역 */}
      <Center>
        <TabBar>
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              $active={tab.id === activeTabId}
              $dragging={draggingTabId === tab.id}
              onClick={() => handleSelectTab(tab.id)}
              draggable
              onDragStart={(e) => handleTabDragStart(e, tab.id)}
              onDragOver={(e) => handleTabDragOver(e, tab.id)}
              onDragEnd={handleTabDragEnd}
            >
              <TabTitle>{tab.fileName}</TabTitle>
              <TabCloseButton
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
              >
                ✕
              </TabCloseButton>
            </Tab>
          ))}
        </TabBar>

        <Main
          ref={mainRef}
          $freeHighlight={isHighlightMode}
          $textHighlight={isTextHighlightMode}
          $erase={isEraseMode}
        >
          <PdfToolbar
            ref={toolbarRef}
            pdfLoaded={pdfLoaded}
            onFileChange={handleFile}
            currentPage={currentPage}
            totalPages={totalPages}
            pageInput={pageInput}
            onChangePageInput={setPageInput}
            onSubmitPageInput={handlePageInputSubmit}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
            // 형광펜 / 지우개
            isHighlightMode={isHighlightMode}
            isTextHighlightMode={isTextHighlightMode}
            isEraseMode={isEraseMode}
            onToggleHighlight={handleToggleHighlight}
            onToggleTextHighlight={handleToggleTextHighlight}
            onToggleErase={handleToggleErase}
            // 검색
            searchQuery={searchQuery}
            onChangeSearchQuery={setSearchQuery}
            hasSearchResults={hasSearchResults}
            searchIndex={searchIndex}
            searchTotal={searchMatches.length}
            onSearch={handleSearch}
            onGotoMatch={gotoMatch}
            // 줌
            scale={scale}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={handleResetZoom}
          />

          <PagesWrapper>
            {pdf &&
              (() => {
                const stride = getPageStride();
                const topSpacerH = (mountRange.lo - 1) * stride;
                const bottomSpacerH = (totalPages - mountRange.hi) * stride;
                const pageCount = mountRange.hi - mountRange.lo + 1;

                return (
                  <>
                    {topSpacerH > 0 && (
                      <div
                        aria-hidden
                        style={{
                          height: topSpacerH,
                          width: "100%",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {Array.from({ length: pageCount }, (_, i) => {
                      const pageNum = mountRange.lo + i;
                      const idx = pageNum - 1;
                      return (
                        <PageContainer
                          key={pageNum}
                          data-page={pageNum}
                          $minHeight={estimatedPageHeight}
                          $minWidth={estimatedPageWidth}
                          ref={(el) => {
                            if (el) pageContainerRefs.current[idx] = el;
                            else delete pageContainerRefs.current[idx];
                          }}
                        >
                          <Canvas
                            ref={(el) => {
                              if (el) canvasRefs.current[idx] = el;
                              else delete canvasRefs.current[idx];
                            }}
                            onMouseDown={handleCanvasMouseDown(pageNum)}
                            $freeHighlight={isHighlightMode}
                            $textHighlight={isTextHighlightMode}
                            $erase={isEraseMode}
                          />
                          <HighlightCanvas
                            ref={(el) => {
                              if (el) highlightCanvasRefs.current[idx] = el;
                              else delete highlightCanvasRefs.current[idx];
                            }}
                          />
                          <div
                            ref={(el) => {
                              if (el) textLayerRefs.current[idx] = el;
                              else delete textLayerRefs.current[idx];
                            }}
                            className="textLayer"
                            style={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              pointerEvents:
                                isTextHighlightMode || isEraseMode
                                  ? "auto"
                                  : "none",
                              zIndex: 2,
                              cursor: isEraseMode
                                ? `url(${eraserCursor}) 6 6, auto`
                                : isTextHighlightMode
                                  ? `url(${colorPenCursor}) 4 18, auto`
                                  : "default",
                            }}
                            onMouseUp={handleTextLayerMouseUp(pageNum)}
                          />
                        </PageContainer>
                      );
                    })}
                    {bottomSpacerH > 0 && (
                      <div
                        aria-hidden
                        style={{
                          height: bottomSpacerH,
                          width: "100%",
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </>
                );
              })()}
          </PagesWrapper>
        </Main>
      </Center>

      {/* 오른쪽 즐겨찾기 사이드바 */}
      <BookmarkSidebar
        bookmarks={bookmarks}
        setBookmarks={setBookmarks}
        goToBookmark={goToBookmark}
      />
    </Container>
  );
}
