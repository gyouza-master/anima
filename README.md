# anima — AI管制塔

複数のAI（Claude Codeセッション）を一元管理する macOS 常駐アプリ。

## 機能

✅ **管制塔**：複数のセッション状態を6スロット + 待機キューで可視化
✅ **承認仲介**：危険なBashコマンドをUIから許可/拒否
✅ **通知**：判断待ち時に macOS ネイティブ通知
✅ **常駐**：launchd で自動起動・常駐

## インストール

### 前提条件
- Node.js 18+
- macOS
- Claude Code

### 1. 依存をインストール

```bash
cd /Users/force/Desktop/anima
npm install
```

### 2. Claude Code にフックを登録

```bash
./install.sh
```

このコマンドで `~/.claude/settings.local.json` に以下フックが登録されます：
- `SessionStart`：セッション開始時
- `PreToolUse`：ツール実行前（Bashは承認待ち）
- `PostToolUse`：ツール実行後
- `Notification`：入力待ち通知
- `Stop`：セッション終了時

### 3. デーモンを常駐化（オプション）

```bash
scripts/setup-launchd.sh
```

ログイン時に自動起動するようにします。

## 使い方

### デーモン起動

```bash
# 手動起動
npm start

# 開発（ファイル監視）
npm run dev
```

### UI へアクセス

```
http://localhost:4317
```

ブラウザで管制塔が開きます。

### 承認の流れ

1. Claude Code セッションが `rm -rf` など危険な Bash コマンドを実行しようとする
2. anima が承認リクエストを受け取り、UIに「承認カード」を表示
3. ユーザーが **許可 / 拒否** を押す
4. フックスクリプトがその決定をセッションに返す
5. セッションはコマンドを実行するか、拒否するか処理

**タイムアウト**：120秒応答なしで、Claude Code の標準確認プロンプトにフォールバック

## 設定

### `config/roster.json`

6つのスロット（キャラクター）の名前と色を定義：

```json
{
  "slots": [
    {"id": 1, "name": "Claude", "color": "#FF6B6B"},
    ...
  ]
}
```

### `config/approval.json`

ポート、タイムアウト、承認対象の設定：

```json
{
  "port": 4317,
  "approval_timeout_ms": 120000,
  "matchers": [
    {"name": "Bash commands", "tool_name": "Bash", "enabled": true}
  ]
}
```

## API

### イベント受信

```bash
POST /api/events
```

Claude Code フックから呼び出され、セッション状態を更新します。

### 承認問い合わせ

```bash
POST /api/approvals
```

承認が必要な場合、フックが同期的に呼び出します（ロングポーリング）。

### UI からの決定

```bash
POST /api/approvals/{id}/decision
```

UI の許可/拒否ボタンから呼び出されます。

### WebSocket

```
WS /ws
```

UI はこのチャネルで状態更新をリアルタイム受信します。

## ログ

イベントログは `logs/events.jsonl` に保存されます。

```bash
tail -f logs/events.jsonl
```

デーモンログ（常駐化時）：

```bash
tail -f ~/Library/Logs/anima/daemon.log
tail -f ~/Library/Logs/anima/daemon-error.log
```

## トラブルシューティング

### デーモンが起動しない

```bash
npm start
```

で手動起動してエラーを確認します。

### フックが機能しない

Claude Code 設定を確認：

```bash
cat ~/.claude/settings.local.json | jq .hooks
```

### 常駐設定を確認

```bash
launchctl list | grep com.anima.daemon
```

### 常駐を削除

```bash
launchctl unload ~/Library/LaunchAgents/com.anima.daemon.plist
```

## Phase 2（予定）

- ③**もう一つの脳みそ**：セッション終了時に会話ログを Obsidian Markdown へ変換・保存
- Obsidian 互換の全文検索
- 他 CLI（Cursor, aider 等）のアダプタ

## ライセンス

MIT
