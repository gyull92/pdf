import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

// PDF.js 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function PdfViewerWithBookmarks() {
  const [pdf, setPdf] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [bookmarks, setBookmarks] = useState([]);
  const [fileName, setFileName] = useState("");
  const canvasRef = useRef(null);

  // 초기 로드시 북마크 불러오기
  useEffect(() => {
    const saved = localStorage.getItem("gyul-pdf-bookmarks");
    if (saved) setBookmarks(JSON.parse(saved));
  }, []);

  // 북마크 저장
  useEffect(() => {
    localStorage.setItem("gyul-pdf-bookmarks", JSON.stringify(bookmarks));
  }, [bookmarks]);

  // PDF 페이지 렌더링
  const renderPage = async (num) => {
    if (!pdf) return;
    const page = await pdf.getPage(num);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;
  };

  // 페이지 변경 시 렌더링
  useEffect(() => {
    if (pdf) renderPage(currentPage);
  }, [pdf, currentPage]);

  // PDF 파일 열기
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    setPdf(pdfDoc);
    setTotalPages(pdfDoc.numPages);
    setCurrentPage(1);
  };

  // 북마크 추가
  const addBookmark = () => {
    if (!fileName) return;
    const key = `${fileName}-${currentPage}`;
    if (!bookmarks.some((b) => b.key === key)) {
      const newBookmark = { key, fileName, page: currentPage, date: new Date().toLocaleString() };
      setBookmarks([...bookmarks, newBookmark]);
    }
  };

  // 북마크 삭제
  const removeBookmark = (key) => {
    setBookmarks(bookmarks.filter((b) => b.key !== key));
  };

  // 북마크 클릭 시 페이지 이동
  const goToBookmark = async (bm) => {
    if (fileName !== bm.fileName) {
      alert("이 북마크는 다른 파일에 속해 있습니다. 먼저 해당 파일을 열어주세요.");
      return;
    }
    setCurrentPage(bm.page);
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
      {/* 사이드바 */}
      <div style={{ width: "250px", borderRight: "1px solid #ccc", padding: "10px", overflowY: "auto" }}>
        <h3>📑 즐겨찾기</h3>
        {bookmarks.length === 0 && <p style={{ color: "#999" }}>저장된 즐겨찾기가 없습니다.</p>}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {bookmarks.map((bm) => (
            <li key={bm.key} style={{ marginBottom: "6px", borderBottom: "1px solid #eee" }}>
              <button
                onClick={() => goToBookmark(bm)}
                style={{ background: "none", border: "none", color: "#007bff", cursor: "pointer" }}
              >
                📘 {bm.fileName} - {bm.page}p
              </button>
              <div style={{ fontSize: "11px", color: "#777" }}>{bm.date}</div>
              <button
                onClick={() => removeBookmark(bm.key)}
                style={{
                  fontSize: "11px",
                  border: "none",
                  background: "none",
                  color: "red",
                  cursor: "pointer",
                }}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* 본문 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ margin: "10px 0" }}>
          <input type="file" accept="application/pdf" onChange={handleFile} />
        </div>

        {pdf && (
          <>
            <div style={{ marginBottom: "10px" }}>
              <button onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}>◀ 이전</button>
              <span style={{ margin: "0 10px" }}>
                {currentPage} / {totalPages}
              </span>
              <button onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}>다음 ▶</button>
              <button onClick={addBookmark} style={{ marginLeft: "15px" }}>
                ⭐ 북마크 추가
              </button>
            </div>
            <canvas ref={canvasRef} style={{ boxShadow: "0 0 10px rgba(0,0,0,0.2)" }}></canvas>
          </>
        )}
      </div>
    </div>
  );
}
