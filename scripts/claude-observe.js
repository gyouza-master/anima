// anima: claude.ai タブの状態フィンガープリントを返す。
// AppleScript の `execute ... javascript` から評価される（最後の式の値が返る）。
//
// 「生成中かどうか」の判定は daemon 側で行う（このスニペットは状態を持たない）:
//   - stop: 停止ボタンがあれば生成中（最も確実な信号）
//   - len : 会話領域のテキスト長。前回ポーリングから増えていれば生成中（ストリーミング）
//
// ★ claude.ai の DOM が変わったら、このファイルのセレクタだけ直せばよい。
(function () {
  try {
    var box = document.querySelector('[data-testid="chat-messages"]') || document.body;
    var stop = !!document.querySelector('[data-testid*="stop"], button[aria-label*="Stop" i]');
    var text = (box && box.innerText) ? box.innerText : '';
    return JSON.stringify({ len: text.length, stop: stop });
  } catch (e) {
    return JSON.stringify({ err: String(e) });
  }
})();
