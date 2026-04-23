window.onload = function() {
  // 리모컨 뒤로가기 버튼 막기
  document.addEventListener('keydown', function(e) {
    if (e.keyCode === 10009) { // BACK 키
      e.preventDefault();
    }
  });
};