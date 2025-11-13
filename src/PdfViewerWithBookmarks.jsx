import { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

// PDF.js 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Styled Components
const Container = styled.div`
  display: flex;
  height: 100vh;
  font-family: sans-serif;
`;

const Sidebar = styled.div`
  width: 250px;
  border-right: 1px solid #ccc;
  padding: 10px;
  overflow-y: auto;
`;

const Main = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: auto;
`;

const Toolbar = styled.div`
  margin: 10px 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Canvas = styled.canvas`
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
`;

const PageThumbnail = styled.div`
  margin-bottom: 5px;
  cursor: pointer;
  border: ${(props) => (props.active ? "2px solid #007bff" : "1px solid #eee")};
  padding: 2px;
  img {
    width: 100%;
    display: block;
  }
`;

const RightSidebar = styled.div`
  width: 300px;
  border-left: 1px solid #ccc;
  padding: 10px;
  overflow-y: auto;
`;

const FileGroup = styled.div`
  margin-bottom: 15px;
`;

const FileTitle = styled.div`
  font-weight: bold;
  cursor: pointer;
  user-select: none;
`;

const BookmarkList = styled.ul`
  list-style: none;
  padding: 5px 0 0 10px;
  margin: 0;
`;

const BookmarkItem = styled.li`
  margin-bottom: 6px;
  border-bottom: 1px solid #eee;
`;

const BookmarkButton = styled.button`
  background: none;
  border: none;
  color: #007bff;
  cursor: pointer;
`;

const RemoveButton = styled.button`
  font-size: 11px;
  border: none;
  background: none;
  color: red;
  cursor: pointer;
  margin-left: 5px;
`;

const EmptyText = styled.p`
  color: #999;
`;

export default function PdfViewerWithBookmarks() {
  const [pdf, setPdf] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [bookmarks, setBookmarks] = useState([]);
  const [fileName, setFileName] = useState("");
  const [collapsedFiles, setCollapsedFiles] = useState({});
  const [thumbnails, setThumbnails] = useState([]);
  const canvasRef = useRef(null);

  // 로컬스토리지에서 북마크 불러오기
  useEffect(() => {
    const saved = localStorage.getItem("gyul-pdf-bookmarks");
    if (saved) setBookmarks(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("gyul-pdf-bookmarks", JSON.stringify(bookmarks));
  }, [bookmarks]);

  // PDF 렌더링
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

  useEffect(() => {
    if (pdf) renderPage(currentPage);
  }, [pdf, currentPage]);

  // 페이지 썸네일 생성
  const generateThumbnails = async (pdfDoc) => {
    const thumbs = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 0.2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      thumbs.push(canvas.toDataURL());
    }
    setThumbnails(thumbs);
  };

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
    generateThumbnails(pdfDoc);
  };

  // 북마크 추가/삭제
  const addBookmark = () => {
    if (!fileName) return;
    const key = `${fileName}-${currentPage}`;
    if (!bookmarks.some((b) => b.key === key)) {
      const newBookmark = {
        key,
        fileName,
        page: currentPage,
        date: new Date().toLocaleString(),
      };
      setBookmarks([...bookmarks, newBookmark]);
    }
  };

  const removeBookmark = (key) => {
    setBookmarks(bookmarks.filter((b) => b.key !== key));
  };

  const goToBookmark = (bm) => {
    if (fileName !== bm.fileName) {
      alert("이 북마크는 다른 파일에 속해 있습니다. 먼저 해당 파일을 열어주세요.");
      return;
    }
    setCurrentPage(bm.page);
  };

  const toggleFile = (file) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [file]: !prev[file],
    }));
  };

  const groupedBookmarks = bookmarks.reduce((acc, bm) => {
    if (!acc[bm.fileName]) acc[bm.fileName] = [];
    acc[bm.fileName].push(bm);
    return acc;
  }, {});

  return (
    <Container>
      {/* 왼쪽 페이지 썸네일 */}
      <Sidebar>
        <h3>📄 페이지</h3>
        {thumbnails.map((src, idx) => (
          <PageThumbnail
            key={idx}
            active={currentPage === idx + 1}
            onClick={() => setCurrentPage(idx + 1)}
          >
            <img src={src} alt={`Page ${idx + 1}`} />
            <div style={{ textAlign: "center", fontSize: "12px" }}>{idx + 1}</div>
          </PageThumbnail>
        ))}
      </Sidebar>

      {/* 중앙 PDF 캔버스 */}
      <Main>
        <Toolbar>
          <input type="file" accept="application/pdf" onChange={handleFile} />
          {pdf && (
            <>
              <button onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}>◀ 이전</button>
              <span>
                {currentPage} / {totalPages}
              </span>
              <button onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}>
                다음 ▶
              </button>
              <button onClick={addBookmark}>⭐ 북마크 추가</button>
            </>
          )}
        </Toolbar>
        {pdf && <Canvas ref={canvasRef} />}
      </Main>

      {/* 오른쪽 즐겨찾기 */}
      <RightSidebar>
        <h3>📑 즐겨찾기</h3>
        {bookmarks.length === 0 && <EmptyText>저장된 즐겨찾기가 없습니다.</EmptyText>}
        {Object.entries(groupedBookmarks).map(([file, bms]) => (
          <FileGroup key={file}>
            <FileTitle onClick={() => toggleFile(file)}>
              {collapsedFiles[file] ? "▶" : "▼"} {file}
            </FileTitle>
            {!collapsedFiles[file] && (
              <BookmarkList>
                {bms.map((bm) => (
                  <BookmarkItem key={bm.key}>
                    <BookmarkButton onClick={() => goToBookmark(bm)}>
                      📘 {bm.page}p
                    </BookmarkButton>
                    <div style={{ fontSize: "11px", color: "#777" }}>{bm.date}</div>
                    <RemoveButton onClick={() => removeBookmark(bm.key)}>삭제</RemoveButton>
                  </BookmarkItem>
                ))}
              </BookmarkList>
            )}
          </FileGroup>
        ))}
      </RightSidebar>
    </Container>
  );
}
