import { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import PageSidebar from "./components/SidePage";
import BookmarkSidebar from "./components/BookMarkPage";
import PdfToolbar from "./components/ToolBar";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

let ipcRenderer = null;

if (typeof window !== "undefined" && window.require) {
  try {
    const electron = window.require("electron");
    ipcRenderer = electron.ipcRenderer;
  } catch (e) {
    console.warn("ipcRenderer 로드 실패:", e);
  }
}

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

// 상단 탭 바 (크롬 탭 느낌)
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

// PDF 캔버스
const Canvas = styled.canvas`
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
  cursor: ${(props) => (props.$highlight ? "crosshair" : "default")};
`;

// ✅ 형광펜 전용 캔버스 (PDF 위에 얹는 레이어)
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
  const [filePath, setFilePath] = useState(""); // 현재 PDF 파일 경로
  const [thumbnails, setThumbnails] = useState([]);

  // 여러 PDF 탭
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [draggingTabId, setDraggingTabId] = useState(null);

  // 페이지 텍스트 (텍스트 검색용)
  const [pageTexts, setPageTexts] = useState([]);

  // 검색 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState([]); // { page, start, end }
  const [searchIndex, setSearchIndex] = useState(0);

  // 본문 확대/축소
  const [scale, setScale] = useState(INITIAL_SCALE);

  // 왼쪽 접힘 상태 (오른쪽은 별도 컴포넌트)
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);

  // 왼쪽 썸네일 확대/축소 배율
  const [thumbnailScale, setThumbnailScale] = useState(1);
  // 왼쪽 목록: 즐겨찾기만 보기 토글 상태
  const [showOnlyBookmarked, setShowOnlyBookmarked] = useState(false);

  // 드래그 오버 상태
  const [isDragOver, setIsDragOver] = useState(false);

  const canvasRefs = useRef([]);
  const textLayerRefs = useRef([]);
  const highlightCanvasRefs = useRef([]); // ✅ 형광펜 캔버스 ref
  const mainRef = useRef(null);
  const toolbarRef = useRef(null);
  const scrollTickingRef = useRef(false);

  // 형광펜 / 지우개 상태
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [isEraseMode, setIsEraseMode] = useState(false);
  const [highlights, setHighlights] = useState([]);
  const highlightStartRef = useRef(null);

  // PDF 문서 캐시 (세션 동안만 유지)
  const pdfCacheRef = useRef({});

  // 썸네일 렌더 세대 관리
  const thumbnailGenerationRef = useRef(0);

  // 전역 드래그앤드롭 처리 (브라우저 기본 동작 막기 + 드래그 상태만 관리)
  useEffect(() => {
    const isFileDrag = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      return Array.from(dt.types || []).includes("Files");
    };

    const handleWindowDragOver = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
      setIsDragOver(true);
    };

    const handleWindowDragLeave = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setIsDragOver(false);
    };

    const handleWindowDrop = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setIsDragOver(false);
    };

    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, []);

  // 로컬 스토리지 로드
  useEffect(() => {
    const saved = localStorage.getItem("gyul-pdf-bookmarks");
    if (saved) setBookmarks(JSON.parse(saved));

    const savedHighlights = localStorage.getItem("gyul-pdf-highlights");
    if (savedHighlights) setHighlights(JSON.parse(savedHighlights));
  }, []);

  // 저장
  useEffect(() => {
    localStorage.setItem("gyul-pdf-bookmarks", JSON.stringify(bookmarks));
  }, [bookmarks]);

  useEffect(() => {
    localStorage.setItem("gyul-pdf-highlights", JSON.stringify(highlights));
  }, [highlights]);

  // 페이지 입력 동기화
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // 현재 활성 탭에 상태 저장
  useEffect(() => {
    if (!activeTabId) return;

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              fileName,
              filePath,
              pdf,
              totalPages,
              currentPage,
              pageInput,
              scale,
              thumbnails,
              pageTexts,
              searchQuery,
              searchMatches,
              searchIndex,
            }
          : tab
      )
    );
  }, [
    activeTabId,
    fileName,
    filePath,
    pdf,
    totalPages,
    currentPage,
    pageInput,
    scale,
    thumbnails,
    pageTexts,
    searchQuery,
    searchMatches,
    searchIndex,
  ]);

  // Ctrl+Z 되돌리기 (형광펜)
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

  // 검색된 텍스트 하이라이트
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

  // 한 페이지 렌더 (PDF + 텍스트레이어, 형광펜 캔버스 사이즈만 맞춤)
  const renderPage = async (num, scaleValue = scale) => {
    if (!pdf) return;
    const canvas = canvasRefs.current[num - 1];
    const textLayerDiv = textLayerRefs.current[num - 1];
    const highlightCanvas = highlightCanvasRefs.current[num - 1];

    if (!canvas || !textLayerDiv) return;

    const page = await pdf.getPage(num);
    const viewport = page.getViewport({ scale: scaleValue });
    const ctx = canvas.getContext("2d");

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    await renderTextLayerOnPage(page, viewport, textLayerDiv);

    // 형광펜 캔버스도 크기 맞추기
    if (highlightCanvas) {
      highlightCanvas.width = canvas.width;
      highlightCanvas.height = canvas.height;
    }

    applySearchHighlightForPage(num);
  };

  // 전체 페이지 렌더 (PDF만 다시 그림) — 형광펜 때문에 재렌더하지 않도록 highlights는 빼기
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
        } catch (e) {}
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT, totalPages); i++) {
      workers.push(worker());
    }

    return () => {
      cancelled = true;
    };
  }, [pdf, totalPages, scale, searchMatches]);

  // ✅ 형광펜만 별도 캔버스에 다시 그리기
  useEffect(() => {
    if (!pdf || totalPages === 0) return;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const baseCanvas = canvasRefs.current[pageNum - 1];
      const highlightCanvas = highlightCanvasRefs.current[pageNum - 1];
      if (!baseCanvas || !highlightCanvas) continue;

      const ctx = highlightCanvas.getContext("2d");
      if (!ctx) continue;

      // PDF 캔버스 크기에 맞춰주기 (사이즈 변경 시 자동 clear)
      if (
        highlightCanvas.width !== baseCanvas.width ||
        highlightCanvas.height !== baseCanvas.height
      ) {
        highlightCanvas.width = baseCanvas.width;
        highlightCanvas.height = baseCanvas.height;
      } else {
        ctx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);
      }

      const pageHighlights = highlights.filter(
        (h) => h.fileName === fileName && h.page === pageNum
      );

      pageHighlights.forEach((h) => {
        const x = h.x * highlightCanvas.width;
        const y = h.y * highlightCanvas.height;
        const w = h.width * highlightCanvas.width;
        const hgt = h.height * highlightCanvas.height;
        ctx.fillStyle = h.color || DEFAULT_HIGHLIGHT_COLOR;
        ctx.fillRect(x, y, w, hgt);
      });
    }
  }, [highlights, pdf, totalPages, scale, fileName]);

  // 썸네일 생성
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

  // PDF 로딩 핵심 로직 (buffer + 파일명 기반, 여러 탭 + 경로 지원)
  const loadPdfFromArrayBuffer = async (
    arrayBuffer,
    name,
    sourcePath = null,
    initialPage = 1
  ) => {
    if (!arrayBuffer) return;

    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const cacheKey = sourcePath || name;
    pdfCacheRef.current[cacheKey] = pdfDoc;

    const total = pdfDoc.numPages;
    const thumbnailsInit = new Array(total).fill(null);

    // ❗ 탭 생성/업데이트는 항상 prev 기반으로 처리
    let resolvedTabId = null;

    setTabs((prev) => {
      // 1) 경로 기준으로 먼저 찾고, 없으면 이름으로 찾기
      const byPath =
        sourcePath != null ? prev.find((t) => t.filePath === sourcePath) : null;
      const byName = prev.find((t) => t.fileName === name);

      const existing = byPath || byName;

      if (existing) {
        // 이미 있는 탭이면 그 탭만 업데이트
        resolvedTabId = existing.id;
        return prev.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                pdf: pdfDoc,
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
            : t
        );
      }

      // 새 탭 생성
      const newId = `tab-${Date.now()}-${Math.random()}`;
      resolvedTabId = newId;

      const newTab = {
        id: newId,
        fileName: name,
        filePath: sourcePath,
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
      };

      return [...prev, newTab];
    });

    if (!resolvedTabId) return;

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

    const newGeneration = thumbnailGenerationRef.current + 1;
    thumbnailGenerationRef.current = newGeneration;
    generateThumbnails(pdfDoc, newGeneration);
  };

  const loadPdfFromPath = async (path, initialPage = 1) => {
    if (!ipcRenderer || !path) return;

    try {
      const buffer = await ipcRenderer.invoke("read-pdf-file", path);

      const uint8 =
        buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

      const arrayBuffer = uint8.buffer.slice(
        uint8.byteOffset,
        uint8.byteOffset + uint8.byteLength
      );

      const name = path.split(/[/\\]/).pop() || "PDF";
      await loadPdfFromArrayBuffer(arrayBuffer, name, path, initialPage);
    } catch (err) {
      console.error("loadPdfFromPath 실패:", err);
    }
  };

  // PDF 로드 공통 함수
  const loadPdfFromFile = async (file) => {
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const sourcePath = file.path || null;
    await loadPdfFromArrayBuffer(arrayBuffer, file.name, sourcePath, 1);
  };

  // 탭 선택
  const handleSelectTab = (tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    setActiveTabId(tabId);
    setFileName(tab.fileName || "");
    setFilePath(tab.filePath || "");
    setPdf(tab.pdf || null);
    setTotalPages(tab.totalPages || 0);
    setCurrentPage(tab.currentPage || 1);
    setPageInput(tab.pageInput || String(tab.currentPage || 1));
    setScale(tab.scale || INITIAL_SCALE);
    setThumbnails(
      tab.thumbnails ||
        (tab.totalPages ? new Array(tab.totalPages).fill(null) : [])
    );
    setPageTexts(tab.pageTexts || []);
    setSearchQuery(tab.searchQuery || "");
    setSearchMatches(tab.searchMatches || []);
    setSearchIndex(tab.searchIndex || 0);

    if (tab.pdf) {
      const newGeneration = thumbnailGenerationRef.current + 1;
      thumbnailGenerationRef.current = newGeneration;

      if (!tab.thumbnails || tab.thumbnails.every((t) => !t)) {
        setThumbnails(new Array(tab.pdf.numPages).fill(null));
        generateThumbnails(tab.pdf, newGeneration);
      }
    }
  };

  // 탭 닫기
  const handleCloseTab = (tabId) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1) return prev;

      const newTabs = [...prev];
      newTabs.splice(idx, 1);

      const closingActive = tabId === activeTabId;

      if (closingActive) {
        const newActive = newTabs[idx] || newTabs[idx - 1] || null;

        if (newActive) {
          setActiveTabId(newActive.id);
          setFileName(newActive.fileName || "");
          setFilePath(newActive.filePath || "");
          setPdf(newActive.pdf || null);
          setTotalPages(newActive.totalPages || 0);
          setCurrentPage(newActive.currentPage || 1);
          setPageInput(
            newActive.pageInput || String(newActive.currentPage || 1)
          );
          setScale(newActive.scale || INITIAL_SCALE);
          setThumbnails(
            newActive.thumbnails ||
              (newActive.totalPages
                ? new Array(newActive.totalPages).fill(null)
                : [])
          );
          setPageTexts(newActive.pageTexts || []);
          setSearchQuery(newActive.searchQuery || "");
          setSearchMatches(newActive.searchMatches || []);
          setSearchIndex(newActive.searchIndex || 0);

          if (newActive.pdf) {
            const newGeneration = thumbnailGenerationRef.current + 1;
            thumbnailGenerationRef.current = newGeneration;
            if (
              !newActive.thumbnails ||
              newActive.thumbnails.every((t) => !t)
            ) {
              setThumbnails(new Array(newActive.pdf.numPages).fill(null));
              generateThumbnails(newActive.pdf, newGeneration);
            }
          }
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
        }
      }

      return newTabs;
    });
  };

  // 파일 열기
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadPdfFromFile(file);
  };

  // (사용 안 해도 되는 로컬 DnD 핸들러들 - 필요하면 Container에 붙여서 사용 가능)
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

  const handleDragEnter = (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDragOver(true);
  };

  // 페이지 텍스트 추출
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

  // 앱 최초 실행 시, OS에서 넘겨준 PDF가 있으면 자동으로 열기
  useEffect(() => {
    if (!ipcRenderer) return;

    const openInitialPdf = async () => {
      try {
        const path = await ipcRenderer.invoke("get-initial-pdf-path");
        if (path) {
          await loadPdfFromPath(path, 1);
        }
      } catch (err) {
        console.error("초기 PDF 로드 실패:", err);
      }
    };

    openInitialPdf();
  }, []);

  // 앱이 이미 켜진 상태에서 다른 PDF를 연결프로그램으로 열었을 때
  useEffect(() => {
    if (!ipcRenderer) return;

    const handler = (event, path) => {
      if (path) {
        loadPdfFromPath(path, 1);
      }
    };

    ipcRenderer.on("open-pdf-from-os", handler);

    return () => {
      ipcRenderer.removeListener("open-pdf-from-os", handler);
    };
  }, []);

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
        filePath: filePath || null,
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

  const handleWheel = (e) => {
    // Ctrl이 아닐 땐 그냥 스크롤
    if (!e.ctrlKey) return;

    if (e.cancelable) {
      e.preventDefault();
    }

    const container = mainRef.current;
    if (!container) return;

    const clientY = e.clientY;

    // 1) 마우스와 가장 가까운 페이지(canvas) 찾기
    const canvases = canvasRefs.current;
    let targetIndex = -1;
    let minDist = Infinity;

    canvases.forEach((canvas, idx) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();

      // 마우스가 이 페이지 안에 있는 경우
      if (clientY >= rect.top && clientY <= rect.bottom) {
        if (0 < minDist) {
          minDist = 0;
          targetIndex = idx;
        }
      } else {
        // 위/아래에 있을 경우 거리가 가장 가까운 페이지를 선택
        const dist = Math.min(
          Math.abs(clientY - rect.top),
          Math.abs(clientY - rect.bottom)
        );
        if (dist < minDist) {
          minDist = dist;
          targetIndex = idx;
        }
      }
    });

    if (targetIndex === -1) return;

    const targetCanvas = canvases[targetIndex];
    const pageRect = targetCanvas.getBoundingClientRect();

    // 2) 이 페이지 안에서의 상대 위치 (0 ~ 1)
    const relY = (clientY - pageRect.top) / pageRect.height;

    const prevScale = scale;
    const isZoomOut = e.deltaY > 0;

    let nextScale = isZoomOut
      ? Math.max(prevScale - SCALE_STEP, MIN_SCALE)
      : Math.min(prevScale + SCALE_STEP, MAX_SCALE);

    if (nextScale === prevScale) return;

    // 먼저 scale 변경
    setScale(nextScale);

    const savedRelY = relY;
    const savedTargetIndex = targetIndex;

    const adjustScroll = () => {
      const c = mainRef.current;
      const canvasAfter = canvasRefs.current[savedTargetIndex];
      if (!c || !canvasAfter) return;

      const rectAfter = canvasAfter.getBoundingClientRect();
      const clampedRelY = Math.min(Math.max(savedRelY, 0), 1);

      // 확대 후에도 같은 상대 위치가 clientY에 오도록 만들겠다는 목표
      const targetY = rectAfter.top + clampedRelY * rectAfter.height;

      // targetY 가 현재 clientY와 얼마나 차이나는가
      const delta = targetY - clientY;

      let newScrollTop = c.scrollTop + delta;
      const maxScrollTop = c.scrollHeight - c.clientHeight;

      if (newScrollTop < 0) newScrollTop = 0;
      if (newScrollTop > maxScrollTop) newScrollTop = maxScrollTop;

      c.scrollTop = newScrollTop;
    };

    // 렌더링이 반영된 뒤에 위치 보정 (두 프레임 정도 여유)
    requestAnimationFrame(() => {
      requestAnimationFrame(adjustScroll);
    });
  };

  // 북마크 추가 버튼 (현재 페이지 토글)
  const addBookmark = () => {
    if (!fileName) return;
    toggleBookmarkPage(currentPage);
  };

  // 북마크로 이동 (오른쪽 컴포넌트에서 사용)
  const goToBookmark = async (bm) => {
    const targetTab = tabs.find((t) =>
      bm.filePath ? t.filePath === bm.filePath : t.fileName === bm.fileName
    );
    if (targetTab) {
      handleSelectTab(targetTab.id);
      setTimeout(() => {
        jumpToPage(bm.page);
      }, 200);
      return;
    }

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

      const newGeneration = thumbnailGenerationRef.current + 1;
      thumbnailGenerationRef.current = newGeneration;
      generateThumbnails(cachedDoc, newGeneration);

      setTimeout(() => {
        scrollToPage(bm.page);
      }, 200);
      return;
    }

    if (bm.filePath && ipcRenderer) {
      try {
        await loadPdfFromPath(bm.filePath, bm.page);
        setTimeout(() => {
          scrollToPage(bm.page);
        }, 200);
      } catch (e) {
        alert(
          `PDF 파일을 다시 여는 데 실패했습니다.\n경로: ${bm.filePath}\n파일이 옮겨졌는지 / 삭제되지 않았는지 확인해주세요.`
        );
      }
      return;
    }

    alert(
      `이 북마크의 PDF("${bm.fileName}") 정보를 찾을 수 없습니다.\n파일을 직접 다시 열어주세요.`
    );
  };

  // 본문 줌 핸들러
  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  };

  const handleResetZoom = () => {
    setScale(INITIAL_SCALE);
  };

  // 지우개
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

  // 형광펜
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

  // 텍스트 검색
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

  // 검색어 지워지면 기존 하이라이트 제거
  useEffect(() => {
    if (!pdf || totalPages === 0) return;
    if (searchQuery.trim() === "" && searchMatches.length > 0) {
      setSearchMatches([]);
      setSearchIndex(0);
    }
  }, [searchQuery, searchMatches.length, pdf, totalPages]);

  const gotoMatch = (nextIndex) => {
    if (searchMatches.length === 0) return;
    const len = searchMatches.length;
    let idx = ((nextIndex % len) + len) % len;
    setSearchIndex(idx);
    const match = searchMatches[idx];
    jumpToPage(match.page);
  };

  const hasSearchResults = searchMatches.length > 0;

  // ✅ 상단 ToolBar로 넘길 헬퍼들
  const pdfLoaded = !!pdf;

  const handlePrevPage = () => {
    if (currentPage > 1) {
      jumpToPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      jumpToPage(currentPage + 1);
    }
  };

  const handlePageInputSubmit = () => {
    const num = Number(pageInput);
    if (!Number.isNaN(num)) {
      jumpToPage(num);
    }
  };

  const handleToggleHighlight = () => {
    setIsHighlightMode((prev) => {
      const next = !prev;
      if (next) setIsEraseMode(false);
      return next;
    });
  };

  const handleToggleErase = () => {
    setIsEraseMode((prev) => {
      const next = !prev;
      if (next) setIsHighlightMode(false);
      return next;
    });
  };

  const handleSearchClick = () => {
    handleSearch();
  };

  const handleGotoMatchIndex = (nextIndex) => {
    gotoMatch(nextIndex);
  };

  // 탭 드래그
  const handleTabDragStart = (e, tabId) => {
    setDraggingTabId(tabId);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tabId);
    }
  };

  const handleTabDragOver = (e, targetTabId) => {
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
  };

  const handleTabDragEnd = () => {
    setDraggingTabId(null);
  };

  return (
    <Container
      $dragOver={isDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
    >
      {/* 왼쪽 페이지 사이드바 (별도 컴포넌트) */}
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
      />

      {/* 중앙 영역: 상단 탭바 + PDF 본문 */}
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

        {/* 중앙 본문 */}
        <Main
          ref={mainRef}
          onScroll={handleScroll}
          onWheel={handleWheel}
          $highlight={isHighlightMode || isEraseMode}
        >
          {/* ✅ 상단 툴바를 별도 컴포넌트로 분리 */}
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
            isHighlightMode={isHighlightMode}
            isEraseMode={isEraseMode}
            onToggleHighlight={handleToggleHighlight}
            onToggleErase={handleToggleErase}
            searchQuery={searchQuery}
            onChangeSearchQuery={setSearchQuery}
            hasSearchResults={hasSearchResults}
            searchIndex={searchIndex}
            searchTotal={searchMatches.length}
            onSearch={handleSearchClick}
            onGotoMatch={handleGotoMatchIndex}
            scale={scale}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={handleResetZoom}
          />

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
                    {/* ✅ 형광펜 캔버스 */}
                    <HighlightCanvas
                      ref={(el) => {
                        if (el) highlightCanvasRefs.current[i] = el;
                      }}
                    />
                    {/* 텍스트 레이어 */}
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
                        zIndex: 2, // 텍스트가 형광펜 위에 오도록
                      }}
                    />
                  </PageContainer>
                );
              })}
          </PagesWrapper>
        </Main>
      </Center>

      {/* 오른쪽 즐겨찾기 사이드바 컴포넌트 */}
      <BookmarkSidebar
        bookmarks={bookmarks}
        setBookmarks={setBookmarks}
        goToBookmark={goToBookmark}
      />
    </Container>
  );
}
