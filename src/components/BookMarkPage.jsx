import { useState, useEffect, useRef } from "react";
import styled from "styled-components";

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

// 우측 사이드바 (리사이즈 가능)
const RightSidebar = styled.div`
  width: ${(props) => props.$width}px;
  border-left: 1px solid #ccc;
  padding: 10px;
  overflow-y: auto;
  flex-shrink: 0;
  background: #fff;
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

// 🔹 우측 사이드바 헤더(즐겨찾기) - 항상 상단 고정
const RightSidebarHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  background: #fff;
  padding-bottom: 4px;
  margin-bottom: 8px;
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
  padding: 4px 4px;
  gap: 4px;
  border-radius: 4px;
  background: ${(props) => (props.$selected ? "#e6f0ff" : "transparent")};
`;

const BookmarkHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const BookmarkHeaderTopRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const BookmarkFileName = styled.span`
  font-size: 11px;
  color: #333;
  display: -webkit-box;
  -webkit-line-clamp: 2; /* 최대 2줄 */
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis; /* 2줄 넘으면 ... 처리 */
  word-break: break-all; /* 칸 좁을 때 단어 중간이라도 줄바꿈 */
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
  margin-left: 4px;
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

// 자동 라벨 / 커스텀 라벨 처리 헬퍼
const getBookmarkDisplayLabel = (label, idx) => {
  const trimmed = (label || "").trim();
  if (!trimmed) {
    return `즐겨찾기${idx + 1}`;
  }
  return trimmed;
};

export default function BookmarkSidebar({
  bookmarks,
  setBookmarks,
  goToBookmark,
}) {
  // 접힘 상태 & 리사이즈
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const rightDragActiveRef = useRef(false);
  const rightDragStartXRef = useRef(0);
  const rightDragStartWidthRef = useRef(320);

  // 폴더 상태
  const [folders, setFolders] = useState([]);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState({});

  // 북마크 편집/선택/드래그 상태
  const [editingKey, setEditingKey] = useState(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [selectedBookmarkKeys, setSelectedBookmarkKeys] = useState([]);
  const [lastSelectedBookmarkKey, setLastSelectedBookmarkKey] = useState(null);
  const [draggingBookmarkKeys, setDraggingBookmarkKeys] = useState([]);

  // 컨텍스트 메뉴 상태
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    type: null, // 'folder' | 'bookmark' | 'unassigned'
    target: null, // { folderId } or { key }
  });

  // 폴더 변경 모달 상태
  const [folderDialog, setFolderDialog] = useState({
    visible: false,
    bookmarkKey: null,
    value: "",
  });

  // 폴더 로컬스토리지 로드/저장
  useEffect(() => {
    const savedFolders = localStorage.getItem("gyul-pdf-folders");
    if (savedFolders) setFolders(JSON.parse(savedFolders));
  }, []);

  useEffect(() => {
    localStorage.setItem("gyul-pdf-folders", JSON.stringify(folders));
  }, [folders]);

  // 오른쪽 사이드바 리사이즈
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

  // 컨텍스트 메뉴 닫기
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

  // 폴더 관련
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

  const removeBookmark = (key) => {
    setBookmarks((prev) => prev.filter((b) => b.key !== key));
  };

  // 텍스트용 인덱스 맵
  const indexMap = {};
  bookmarks.forEach((bm, idx) => {
    indexMap[bm.key] = idx;
  });

  const unassignedBookmarks = bookmarks.filter((bm) => !bm.folderId);
  const unassignedKeys = unassignedBookmarks.map((b) => b.key);

  // 컨텍스트 메뉴 핸들러
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

    if (!selectedBookmarkKeys.includes(bm.key)) {
      setSelectedBookmarkKeys([bm.key]);
      setLastSelectedBookmarkKey(bm.key);
    }

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      type: "bookmark",
      target: { key: bm.key },
    });
  };

  const handleUnassignedContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      type: "unassigned",
      target: null,
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

  const handleDeleteAllBookmarksInFolder = (folderId) => {
    const folder = folders.find((f) => f.id === folderId);
    const name = folder ? folder.name : "";
    const count = bookmarks.filter((bm) => bm.folderId === folderId).length;

    if (count === 0) {
      alert("이 폴더에는 삭제할 즐겨찾기가 없습니다.");
      return;
    }

    if (
      !window.confirm(
        `"${name}" 폴더 안의 ${count}개 즐겨찾기를 모두 삭제하시겠습니까?`
      )
    ) {
      return;
    }

    setBookmarks((prev) => prev.filter((bm) => bm.folderId !== folderId));
  };

  const handleDeleteAllUnassignedBookmarks = () => {
    const count = bookmarks.filter((bm) => !bm.folderId).length;

    if (count === 0) {
      alert("'폴더 없음'에 삭제할 즐겨찾기가 없습니다.");
      return;
    }

    if (
      !window.confirm(
        `'폴더 없음'에 있는 ${count}개의 즐겨찾기를 모두 삭제하시겠습니까?`
      )
    ) {
      return;
    }

    setBookmarks((prev) => prev.filter((bm) => bm.folderId));
  };

  const handleFolderDeleteAllBookmarksFromMenu = () => {
    if (!contextMenu.target) return;
    handleDeleteAllBookmarksInFolder(contextMenu.target.folderId);
    closeContextMenu();
  };

  const handleUnassignedDeleteAllFromMenu = () => {
    handleDeleteAllUnassignedBookmarks();
    closeContextMenu();
  };

  // 즐겨찾기 클릭(단일/다중/범위 선택)
  const handleBookmarkClick = (e, bm, visibleKeys) => {
    e.stopPropagation();

    const allKeysInOrder =
      Array.isArray(visibleKeys) && visibleKeys.length > 0
        ? visibleKeys
        : bookmarks.map((b) => b.key);

    // Shift 범위 선택
    if (e.shiftKey && lastSelectedBookmarkKey) {
      const lastIndex = allKeysInOrder.indexOf(lastSelectedBookmarkKey);
      const currentIndex = allKeysInOrder.indexOf(bm.key);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const [start, end] =
          lastIndex < currentIndex
            ? [lastIndex, currentIndex]
            : [currentIndex, lastIndex];

        const rangeKeys = allKeysInOrder.slice(start, end + 1);

        setSelectedBookmarkKeys((prev) =>
          Array.from(new Set([...prev, ...rangeKeys]))
        );
        return;
      }
    }

    // Ctrl / Cmd 다중 선택
    if (e.ctrlKey || e.metaKey) {
      setSelectedBookmarkKeys((prev) =>
        prev.includes(bm.key)
          ? prev.filter((k) => k !== bm.key)
          : [...prev, bm.key]
      );
      setLastSelectedBookmarkKey(bm.key);
      return;
    }

    // 일반 클릭: 단일 선택
    setSelectedBookmarkKeys([bm.key]);
    setLastSelectedBookmarkKey(bm.key);
  };

  // 즐겨찾기 드래그
  const handleBookmarkDragStart = (e, bm) => {
    let keysToDrag = selectedBookmarkKeys.includes(bm.key)
      ? selectedBookmarkKeys
      : [bm.key];

    if (!selectedBookmarkKeys.includes(bm.key)) {
      setSelectedBookmarkKeys(keysToDrag);
      setLastSelectedBookmarkKey(bm.key);
    }

    setDraggingBookmarkKeys(keysToDrag);

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify(keysToDrag));
    }
  };

  const handleBookmarkDragEnd = () => {
    setDraggingBookmarkKeys([]);
  };

  // 폴더로 드롭했을 때 즐겨찾기 이동
  const handleBookmarkDropOnFolder = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();

    let keys = draggingBookmarkKeys;

    if ((!keys || keys.length === 0) && e.dataTransfer) {
      const data = e.dataTransfer.getData("text/plain");
      if (data) {
        try {
          keys = JSON.parse(data);
        } catch (err) {
          keys = [];
        }
      }
    }

    if (!keys || keys.length === 0) return;

    setBookmarks((prev) =>
      prev.map((bm) => (keys.includes(bm.key) ? { ...bm, folderId } : bm))
    );

    setDraggingBookmarkKeys([]);
  };

  // '폴더 없음'으로 드롭했을 때 폴더 해제
  const handleBookmarkDropOnUnassigned = (e) => {
    e.preventDefault();
    e.stopPropagation();

    let keys = draggingBookmarkKeys;

    if ((!keys || keys.length === 0) && e.dataTransfer) {
      const data = e.dataTransfer.getData("text/plain");
      if (data) {
        try {
          keys = JSON.parse(data);
        } catch (err) {
          keys = [];
        }
      }
    }

    if (!keys || keys.length === 0) return;

    setBookmarks((prev) =>
      prev.map((bm) => (keys.includes(bm.key) ? { ...bm, folderId: null } : bm))
    );

    setDraggingBookmarkKeys([]);
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

  return (
    <>
      {isRightCollapsed ? (
        <RightCollapsedTab onClick={() => setIsRightCollapsed(false)}>
          📑 즐겨찾기
        </RightCollapsedTab>
      ) : (
        <>
          <RightResizeHandle onMouseDown={handleRightResizeMouseDown} />

          <RightSidebar $width={rightSidebarWidth}>
            <RightSidebarHeader>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
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
            </RightSidebarHeader>

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
                const folderBookmarkKeys = folderBookmarks.map((b) => b.key);

                return (
                  <FolderWrapper
                    key={folder.id}
                    onContextMenu={(e) => handleFolderContextMenu(e, folder)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => handleBookmarkDropOnFolder(e, folder.id)}
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
                          <FolderName
                            onClick={() => toggleFolderCollapse(folder.id)}
                          >
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
                            const selected = selectedBookmarkKeys.includes(
                              bm.key
                            );

                            return (
                              <BookmarkItem
                                key={bm.key}
                                $selected={selected}
                                draggable
                                onClick={(e) =>
                                  handleBookmarkClick(e, bm, folderBookmarkKeys)
                                }
                                onDragStart={(e) =>
                                  handleBookmarkDragStart(e, bm)
                                }
                                onDragEnd={handleBookmarkDragEnd}
                                onContextMenu={(e) =>
                                  handleBookmarkContextMenu(e, bm)
                                }
                              >
                                <BookmarkHeaderTopRow>
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
                                    {bm.page}p
                                  </BookmarkPageText>
                                </BookmarkHeaderTopRow>
                                <BookmarkFileName title={bm.fileName}>
                                  {bm.fileName}
                                </BookmarkFileName>
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
            <div
              onContextMenu={handleUnassignedContextMenu}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) {
                  e.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={handleBookmarkDropOnUnassigned}
              style={{
                marginTop: 8,
                paddingBottom: 8,
              }}
            >
              <h4 style={{ margin: "0 0 4px", cursor: "default" }}>
                📌 폴더 없음
              </h4>

              <FolderBookmarkList>
                {unassignedBookmarks.length === 0 ? (
                  <EmptyFolderText>
                    이 영역에 드롭하면 ‘폴더 없음’으로 이동합니다.
                  </EmptyFolderText>
                ) : (
                  unassignedBookmarks.map((bm) => {
                    const displayLabel = getBookmarkDisplayLabel(
                      bm.label,
                      indexMap[bm.key]
                    );
                    const selected = selectedBookmarkKeys.includes(bm.key);
                    return (
                      <BookmarkItem
                        key={bm.key}
                        $selected={selected}
                        draggable
                        onClick={(e) =>
                          handleBookmarkClick(e, bm, unassignedKeys)
                        }
                        onDragStart={(e) => handleBookmarkDragStart(e, bm)}
                        onDragEnd={handleBookmarkDragEnd}
                        onContextMenu={(e) => handleBookmarkContextMenu(e, bm)}
                      >
                        <BookmarkHeader>
                          <BookmarkHeaderTopRow>
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

                            <BookmarkPageText>{bm.page}p</BookmarkPageText>
                          </BookmarkHeaderTopRow>
                          <BookmarkFileName title={bm.fileName}>
                            {bm.fileName}
                          </BookmarkFileName>
                        </BookmarkHeader>

                        <BookmarkMiddleRow />
                      </BookmarkItem>
                    );
                  })
                )}
              </FolderBookmarkList>
            </div>
          </RightSidebar>
        </>
      )}

      {/* 폴더 컨텍스트 메뉴 */}
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
            폴더 삭제
          </ContextMenuItem>
          <ContextMenuItem onClick={handleFolderDeleteAllBookmarksFromMenu}>
            폴더 내 즐겨찾기 모두 삭제
          </ContextMenuItem>
        </ContextMenu>
      )}

      {/* 북마크 컨텍스트 메뉴 */}
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

      {/* '폴더 없음' 컨텍스트 메뉴 */}
      {contextMenu.visible && contextMenu.type === "unassigned" && (
        <ContextMenu
          $x={contextMenu.x}
          $y={contextMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuItem onClick={handleUnassignedDeleteAllFromMenu}>
            '폴더 없음' 즐겨찾기 모두 삭제
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
    </>
  );
}
