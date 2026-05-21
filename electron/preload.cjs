// CommonJS preload script
//   프로젝트 package.json에 "type": "module"이 설정되어 있어
//   .js로 두면 ESM으로 처리되어 require()가 실패함.
//   Electron preload는 CJS 컨텍스트에서 로드되므로 확장자를 .cjs로 사용.
window.addEventListener("DOMContentLoaded", () => {
  // 진단용 로그
  // console.log("Preload loaded");
});
