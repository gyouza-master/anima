# anima 進捗まとめ

最終更新: 2026-08-17
リポジトリ: https://github.com/gyouza-master/anima

複数の AI セッション（Claude Code / ChatGPT 等）を一元管理する常駐アプリ「管制塔」。
要件定義は `REQUIREMENTS.md`、キャラ設計の元ネタは `~/Desktop/cortex/docs/DESIGN.md`。

---

## いまできていること

### ①管制塔（セッション可視化）
- 6スロット + 待機キュー。新規セッションは空きスロットに自動割当
- WebSocket でリアルタイム更新（タイマーは毎秒自動更新、リロード不要）
- 各カードに: キャラSVG / キャラ名 / 使用AI(🤖) / 作業名 / 状態バッジ / 最新アクティビティ / プロジェクト・セッションID / タイマー

### ②承認仲介（判断待ち）
- Bash 実行時に承認カード（許可/拒否）＋ macOS 通知
- ロングポーリング、120秒でタイムアウト→標準フロールバック

### キャラクター（cortex から移植）
- SVGプロシージャル生成（`public/avatar.js`）。6キャラ: ゼン/ノア/カイ/ミオ/クロ/ハル
- 状態で表情変化: 作業中(一直線目+バウンス) / 判断待ち(困り目+橙の脈打つ光) / 返信待ち(寝てる+zzz) / 完了(笑い目) / エラー(×目)
- キャラ名は固定表示。**編集できるのは「作業名エリア」**（クリックで編集）

### タイマー（2つのタイミングでリセット）
- あなたが送信(prompt) → リセット → 「作業中」カウント開始
- ツール実行(activity) → リセットしない（作業経過が伸びる）
- AI返答完了(stop) → リセット → 「返信待ち」カウント開始

### 稼働中AIの検知＆接続
- 「+ 接続」ボタン → 今Macで動いている AI を一覧表示（`ps`で検知）
- 対応: Claude Code CLI（`claude`）、ChatGPTアプリ、Cursor
- 一覧から選んで接続（架空のものは作れない）

### ChatGPT ブラウザ連携
- `scripts/chatgpt-bookmarklet.txt` のブックマークレットを chatgpt.com で実行
- 生成中→完了を検知して anima に通知（stop-buttonの有無で判定）
- daemon は CORS 対応済み

### その他
- セッション「✕消す」／ヘッダー「🧹全クリア」
- タイマー手動リセット「⟲」

---

## 構成

```
config/
  roster.json         6キャラ（name/color/body/deco/visor/mark）
  approval.json       ポート・承認設定
src/
  daemon.js           Express + WebSocket 本体
  notification.js     macOS通知
public/
  index.html          管制塔UI
  avatar.js           キャラSVG生成
scripts/
  hook-start.sh       SessionStart
  hook-user-prompt.sh UserPromptSubmit（タイマーリセット）
  hook-pre-tool-use.sh  PreToolUse（Bash承認/活動ログ）
  hook-post-tool-use.sh PostToolUse
  hook-notification.sh  Notification
  hook-stop.sh        Stop
  chatgpt-adapter.js  ChatGPT監視スクリプト（可読版）
  chatgpt-bookmarklet.txt ChatGPT監視ブックマークレット
install.sh            Claude Code に hook を登録
com.anima.daemon.plist / scripts/setup-launchd.sh  常駐化
```

## API
- `POST /api/events` … 状態イベント（kind: start/prompt/activity/notification/stop）
- `POST /api/approvals` … 承認リクエスト（ロングポーリング）
- `POST /api/approvals/:id/decision` … 承認決定
- `GET  /api/state` … 全状態スナップショット（roster含む）
- `GET  /api/discover` … 稼働中AIプロセス一覧
- `POST /api/roster` … キャラ設定更新
- `POST /api/sessions/:id/task` … 作業名を設定
- `POST /api/sessions/:id/reset-timer` … タイマー手動リセット
- `DELETE /api/sessions/:id` / `POST /api/sessions/clear` … 削除
- `WS /ws` … リアルタイム配信

---

## 起動手順
```bash
cd ~/Desktop/anima
npm install          # 初回のみ
./install.sh         # Claude Code に hook 登録（初回のみ）
npm start            # daemon 起動
# ブラウザで http://localhost:4317
```

---

## 既知の注意点 / 未検証
- **hook はセッション開始時に読み込まれる**。設定変更後は新しい `claude` セッションでのみ有効
  （途中から設定を足しても、その時走っている会話には効かない）
- タイマーの自動リセット（送信/停止）は **新セッションで要動作確認**
- ChatGPT ブックマークレットは実地の生成テスト未実施（セレクタ `[data-testid="stop-button"]` で判定）
- daemon はメモリ上に状態を保持。再起動で全セッションがクリアされる（永続化は Phase 2）
- launchd 常駐は未セットアップ（手動 `npm start` で運用中）

## 次にやること候補
- [ ] 新セッションでタイマー挙動を検証（送信でリセット→作業中、停止でリセット→返信待ち）
- [ ] ChatGPT ブックマークレットの実地テスト
- [ ] Phase 2: 会話ログの Obsidian Markdown 書き出し
- [ ] 口調・吹き出し（cortex の tone プリセット）
- [ ] 状態の永続化（再起動で消えないように）
