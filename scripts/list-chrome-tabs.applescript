-- anima: Google Chrome のタブを列挙して 1行1タブで返す
-- 形式:  <window index><US><tab index><US><URL><US><title>
--   フィールド区切り = 制御文字 US (ASCII 31)、行区切り = linefeed
--   URL / タイトルに現れない文字なので安全にパースできる。
-- 実行には macOS の「オートメーション」権限（このプロセス → Google Chrome）が必要。
on run
  set sep to (character id 31)
  set out to ""
  if application "Google Chrome" is running then
    tell application "Google Chrome"
      set wi to 0
      repeat with w in windows
        set wi to wi + 1
        set ti to 0
        repeat with t in tabs of w
          set ti to ti + 1
          try
            set u to URL of t
          on error
            set u to ""
          end try
          try
            set tt to title of t
          on error
            set tt to ""
          end try
          set out to out & wi & sep & ti & sep & u & sep & tt & linefeed
        end repeat
      end repeat
    end tell
  end if
  return out
end run
