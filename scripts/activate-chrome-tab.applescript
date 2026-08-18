-- anima: 指定 URL に一致する Google Chrome のタブを前面に出す
-- 使い方: osascript activate-chrome-tab.applescript "<url>"
-- URL は前方一致でなく「含む」で判定（クエリ違いを許容するため、まず ? より前で照合）。
on run argv
  if (count of argv) is 0 then return "no-url"
  set target to item 1 of argv
  -- クエリ以降を落として本体パスで照合する
  set AppleScript's text item delimiters to "?"
  set targetBase to text item 1 of target
  set AppleScript's text item delimiters to ""

  if application "Google Chrome" is not running then return "chrome-not-running"

  tell application "Google Chrome"
    activate
    repeat with w in windows
      set i to 0
      repeat with t in tabs of w
        set i to i + 1
        set u to ""
        try
          set u to URL of t
        end try
        if u starts with targetBase then
          set active tab index of w to i
          set index of w to 1
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "not-found"
end run
