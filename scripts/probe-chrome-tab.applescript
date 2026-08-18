-- anima: 指定 URL の Google Chrome タブで claude-observe.js を実行し、
-- 生成状態の JSON 文字列を返す。
-- 使い方: osascript probe-chrome-tab.applescript "<url>" "<path-to-observe.js>"
-- 「Apple Events からの JavaScript を許可」が ON である必要がある。
on run argv
  if (count of argv) < 2 then return "{\"err\":\"bad-args\"}"
  set target to item 1 of argv
  set jsPath to item 2 of argv

  -- クエリ以降を落として本体パスで照合
  set AppleScript's text item delimiters to "?"
  set base to text item 1 of target
  set AppleScript's text item delimiters to ""

  -- JS をファイルから読む（引用符・多バイトの取り回しを避けるため）
  set fh to open for access (POSIX file jsPath)
  set js to (read fh)
  close access fh

  if application "Google Chrome" is not running then return "{\"err\":\"chrome-not-running\"}"

  tell application "Google Chrome"
    repeat with w in windows
      repeat with t in tabs of w
        set u to ""
        try
          set u to URL of t
        end try
        if u starts with base then
          try
            return execute t javascript js
          on error
            return "{\"err\":\"exec-failed\"}"
          end try
        end if
      end repeat
    end repeat
  end tell
  return "{\"err\":\"tab-not-found\"}"
end run
