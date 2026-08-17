// anima - ChatGPT ブラウザアダプタ
//
// chatgpt.com のタブに注入して、画像生成などの「生成中 → 完了」を検知し、
// anima デーモンへ通知する。生成中は送信ボタン([data-testid="send-button"])が
// 停止ボタン([data-testid="stop-button"])に変わることを利用して判定する。
//
// 使い方:
//   1) chatgpt.com を開く
//   2) このファイルの中身（またはブックマークレット版）をページで実行
//   → anima 画面の ChatGPT スロットが「作業中 / 返信待ち」で更新される
(function () {
  if (window.__animaChatGPT) {
    console.log('[anima] ChatGPT モニターは既に動作中です');
    return;
  }
  window.__animaChatGPT = true;

  var ANIMA = 'http://localhost:4317';
  var SESSION = 'chatgpt-tab';
  var last = null;

  // 生成中かどうか（停止ボタンが出ていれば生成中）
  function isGenerating() {
    return !!document.querySelector(
      '[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]'
    );
  }

  // 現在の会話タイトル
  function title() {
    return (document.title || 'ChatGPT').replace(/\s*[-–—]\s*ChatGPT.*/, '') || 'ChatGPT';
  }

  function send(kind, detail) {
    fetch(ANIMA + '/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adapter: 'chatgpt-browser',
        session_id: SESSION,
        cwd: '/' + title(),
        kind: kind,
        model_name: 'ChatGPT',
        detail: detail,
        ts: Math.floor(Date.now() / 1000)
      })
    }).catch(function () {});
  }

  // 起動時に接続を通知
  send('start', '接続しました');

  // 毎秒、生成状態の変化を監視
  setInterval(function () {
    var g = isGenerating();
    if (g !== last) {
      if (g) {
        send('prompt', '生成中: ' + title());       // 生成開始 → 作業中（タイマーリセット）
      } else if (last !== null) {
        send('stop', '生成完了: ' + title());        // 生成完了 → 返信待ち（タイマーリセット）
      }
      last = g;
    }
  }, 1000);

  console.log('[anima] ChatGPT モニターを開始しました');
})();
