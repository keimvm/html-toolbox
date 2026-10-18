// 経過時間・かかった時間の表示。打っている間は秒まで、結果は0.1秒まで出す。

function parts(ms: number, tenths: boolean) {
  const unit = tenths ? 100 : 1000;
  const total = Math.floor(Math.max(0, ms) / unit);
  const seconds = tenths ? Math.floor(total / 10) : total;
  return {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
    tenth: tenths ? total % 10 : undefined,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** 「0:07」「12:34.5」「1:02:03.4」の形。tenths で0.1秒の桁を付ける。切り捨てる。 */
export function formatClock(ms: number, { tenths = false } = {}): string {
  const { hours, minutes, seconds, tenth } = parts(ms, tenths);
  const clock = hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  return tenth === undefined ? clock : `${clock}.${tenth}`;
}

/** 読み上げ用。「7.0秒」「12分34.5秒」「1時間2分3.4秒」。 */
export function formatSpoken(ms: number): string {
  const { hours, minutes, seconds, tenth } = parts(ms, true);
  return (
    (hours ? `${hours}時間` : '') +
    (hours || minutes ? `${minutes}分` : '') +
    `${seconds}.${tenth}秒`
  );
}
