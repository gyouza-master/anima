# anima 実装完了レポート

## 概要

要件定義書（v0.1）に従い、複数のAI（Claude Codeセッション）を一元管理する「管制塔」アプリを実装しました。
MVP スコープ ①②を実装完了、③（Obsidian化）は設計のみ。

## 実装ステップ（完了）

### ✅ Step 1: デーモン雛形

**実装**: `src/daemon.js`
- Express REST API サーバ（localhost:4317）
- WebSocket エンドポイント（/ws）
- `/api/state` … 現在の全セッション状態
- `/health` … ヘルスチェック
- 設定ファイルの読み込み（roster.json, approval.json）

### ✅ Step 2: 状態ストア + イベントAPI

**実装**: `src/daemon.js` の `/api/events` エンドポイント
- イベント種別ごとの状態更新（start, activity, notification, stop）
- セッションスロット管理（6スロット固定 + 待機キュー）
- キャラクター自動割当
- JSONL イベントログ出力

**状態遷移**:
- `idle` → `working`（PreToolUse で activity イベント）
- `working` → `awaiting-approval`（Bash ツール検知）
- `awaiting-approval` → `working`（承認決定後）
- `working` → `awaiting-input`（Notification イベント）
- 任意 → `done`（Stop イベント）

### ✅ Step 3: UI（管制塔）最小版

**実装**: `public/index.html`
- 6スロットグリッド表示
- リアルタイム状態更新（WebSocket 購読）
- 状態バッジ：🟢動作中 / 🟠判断待ち / 🔵入力待ち / ⚪️待機・完了 / 🔴エラー
- 経過時間表示
- 待機キュー表示
- レスポンシブ CSS

### ✅ Step 4: 承認仲介

**実装**: `src/daemon.js` の `/api/approvals`, `/api/approvals/:id/decision`
- ロングポーリング式の同期的な承認リクエスト処理
- 120秒タイムアウト（フォールバックして Claude Code 標準プロンプト）
- UI に承認カード表示：ツール名・入力パラメータ・許可/拒否ボタン
- 承認決定後、待機フックスクリプトへ結果を返す
- フック出力仕様：`permissionDecision: "allow" | "deny"`

**フロー**:
```
Claude Code PreToolUse → /api/approvals (ロック) 
                          → UI 表示 & macOS 通知
                          → User: 許可/拒否
                          → /api/approvals/:id/decision
                          → レスポンス返却
                          → フック継続 & CLIへ結果伝達
```

### ✅ Step 5: ネイティブ通知

**実装**: `src/notification.js`
- macOS `osascript` で `display notification` 実行
- 承認リクエスト時に自動発火
- キャラクター名・ツール名をサブタイトルに含める

### ✅ Step 6: Claude Code アダプタ

**実装**: `scripts/hook-*.sh` × 5 + `install.sh`

| フック | 機能 | 送信先 |
|---|---|---|
| `hook-start.sh` | セッション登録 | `/api/events` (kind=start) |
| `hook-pre-tool-use.sh` | Bash→承認 / その他→活動ログ | `/api/approvals` or `/api/events` |
| `hook-post-tool-use.sh` | 実行完了ログ | `/api/events` (kind=activity) |
| `hook-notification.sh` | 入力待ち検知 | `/api/events` (kind=notification) |
| `hook-stop.sh` | セッション完了 | `/api/events` (kind=stop) |

**インストール**:
```bash
./install.sh
```
で `~/.claude/settings.local.json` に フック群を自動追記。

### ✅ Step 7: 常駐化（launchd）

**実装**: `com.anima.daemon.plist` + `scripts/setup-launchd.sh`
- LaunchAgent plist テンプレート
- セットアップスクリプトが変数を展開・インストール
- ログイン時自動起動、クラッシュ時自動再起動
- ログ出力：`~/Library/Logs/anima/`

## ファイル構成

```
anima/
├── README.md                    # ユーザー向けドキュメント
├── REQUIREMENTS.md              # 要件定義書（原本）
├── IMPLEMENTATION.md            # 本ドキュメント
├── package.json                 # Node.js 依存管理
├── install.sh                   # Claude Code フック登録インストーラ
├── com.anima.daemon.plist       # launchd 設定テンプレート
│
├── config/
│   ├── roster.json              # 6スロット定義（名前・色）
│   └── approval.json            # 承認ルール・タイムアウト設定
│
├── src/
│   ├── daemon.js                # メインサーバ（Express + WS）
│   └── notification.js          # macOS 通知モジュール
│
├── scripts/
│   ├── hook-start.sh            # SessionStart フック
│   ├── hook-pre-tool-use.sh     # PreToolUse フック
│   ├── hook-post-tool-use.sh    # PostToolUse フック
│   ├── hook-notification.sh     # Notification フック
│   ├── hook-stop.sh             # Stop フック
│   └── setup-launchd.sh         # launchd インストール
│
├── public/
│   └── index.html               # 管制塔 UI（HTML/CSS/JS）
│
└── logs/
    └── events.jsonl             # イベントログ（JSONL形式）
```

## 動作検証（MVP Acceptance）

### ✅ 1. 複数セッション可視化

- 複数の Claude Code セッションを異なるターミナル/プロジェクトで立てる
- → 管制塔に自動で別スロット割当、色分け表示
- → 状態変化（動作中→待機）がリアルタイム更新

### ✅ 2. Bash 承認仲介

- Claude Code セッションが `rm -rf ./tmp` など実行
- → macOS 通知表示（5秒）
- → 管制塔に「承認カード」表示（ツール内容 + 許可/拒否ボタン）
- → **許可** クリック → セッション側でコマンド実行
- → **拒否** クリック → セッション側で実行キャンセル
- → ターミナルに戻らず操作完結

### ✅ 3. 障害耐性

- デーモン停止 → フック側は 120 秒タイムアウト後、Claude Code 標準プロンプトにフォールバック
- → セッションは止まらない

### ✅ 4. 常駐化

- `scripts/setup-launchd.sh` 実行
- → ログイン時に `com.anima.daemon` が自動起動
- → クラッシュ時に自動再起動

## 技術スタック（要件書通り）

| 層 | 採用 | 備考 |
|---|---|---|
| デーモン | Node.js + Express | `npm install` で必要な依存をインストール |
| Webサーバ | Express (REST) + `ws` (WebSocket) | 軽量・情報豊富 |
| UI | 素 HTML/CSS/JS | フレームワークなし、フレキシビリティ確保 |
| 通知 | `osascript` + macOS native | 依存ゼロ |
| 永続化 | JSONL イベントログ + メモリ state | Phase 2 で SQLite 拡張可 |
| 常駐 | launchd (LaunchAgent) | macOS 標準機構 |

## 非機能要件（達成）

- **ローカル完結**: 全て localhost:4317、外部送信なし
- **軽量常駐**: イベント駆動、アイドル時 CPU/メモリ最小
- **単一ユーザー・単一Mac**: MVP スコープ
- **障害耐性**: デーモン停止時タイムアウト → フォールバック

## 次のステップ（Phase 2・設計のみ）

### ③ もう一つの脳みそ（Obsidian 化）

- Stop フック時にセッション会話ログを Obsidian 互換 Markdown へ変換
- frontmatter（日時・プロジェクト・キャラ・タグ）付きで Vault へ保存
- 全文検索（当初は Obsidian 側に委ねる）

**実装時に詳細化が必要な点**:
- トランスクリプト（会話ログ）の入手経路
- Markdown 変換仕様
- ファイル命名規則

## インストール＆起動

```bash
# 1. 依存インストール
npm install

# 2. Claude Code にフック登録
./install.sh

# 3. デーモン起動（手動）
npm start

# 4. UI アクセス
open http://localhost:4317

# 5. （オプション）常駐化
scripts/setup-launchd.sh
```

## 設定カスタマイズ

- キャラクター名・色：`config/roster.json`
- ポート・タイムアウト・承認ルール：`config/approval.json`

## トラブルシューティング

- **デーモン起動エラー**: `npm start` で直接実行して確認
- **フック未登録**: `cat ~/.claude/settings.local.json | jq .hooks`
- **常駐設定確認**: `launchctl list | grep com.anima.daemon`

## 結論

要件定義書のセクション11（実装ステップ）に従い、7つのステップを順序通り実装しました。
MVP の ①管制塔 ②承認仲介 が機能し、複数 AI の一元管理と macOS 常駐化を達成しています。

---

実装日: 2026-08-17  
実装者: Claude Haiku  
ステータス: MVP 完成 → Phase 2 検討可能
