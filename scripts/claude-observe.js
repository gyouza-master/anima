// anima: claude.ai タブの状態フィンガープリントを返す。
// AppleScript の `execute ... javascript` から評価される（最後の式の値が返る）。
//
// 生成中の主信号 = 送信ボタン(chat-send-button)が「存在して無効(disabled)」。
//   claude.ai/design では応答生成中〜思考中の空白の間ずっと disabled のままで、
//   完了すると enabled に戻る（stop ボタンは出ないタブがあるため、これが最も確実）。
// 補助: stop ボタン、会話テキスト長(len)。daemon 側で len の伸びも見て併用する。
//
// ★ claude.ai の DOM が変わったら、このファイルのセレクタだけ直せばよい。
(function () {
  try {
    var box = document.querySelector('[data-testid="chat-messages"]') || document.body;
    var send = document.querySelector('[data-testid="chat-send-button"]');
    var sendDisabled = send ? (send.disabled === true || send.getAttribute('aria-disabled') === 'true') : false;
    var stop = !!document.querySelector('[data-testid*="stop"], button[aria-label*="Stop" i]');
    var text = (box && box.innerText) ? box.innerText : '';
    var busy = (!!send && sendDisabled) || stop;
    return JSON.stringify({ busy: busy, len: text.length, stop: stop, sendDisabled: sendDisabled });
  } catch (e) {
    return JSON.stringify({ err: String(e) });
  }
})();
