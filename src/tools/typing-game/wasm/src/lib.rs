//! タイピングゲームの文字単位の差分（見本 → 入力）。
//!
//! Myers の O(ND) 法を、先頭から進める形で解く（jsdiff の `diffChars` と同じ進め方）。
//! 編集（追加と削除）の数が同じ並べ方のうち、なるべく先頭から一致させ、抜けを後ろに寄せたものになる。
//! 打ち終えずにやめた場合は、見本の残りが最後にまとめて抜けになる。端に着いた道より外側の対角線は調べない。
//! 道をたどり直すため、歩数ごとに各対角線の最も進んだ位置を残す。残す量が MAX_TRACE を超えるか、
//! 期限（JavaScript の `Date.now()` の値）を過ぎたら計算をやめ、結果を返さない。
//!
//! JavaScript からは、`alloc` で確保した領域に見本と入力のコードポイントを書いて `diff` を呼ぶ。
//! 結果は `[区切りの数, 区切り…]` の u32 の並びで、各区切りは `数 << 2 | 種類`（種類は EQUAL・ADDED・REMOVED）。
//! 使い終えた領域は `dealloc` で返す。

/// 見本と入力の両方にある文字。
const EQUAL: u32 = 0;
/// 入力にだけある文字（打ち間違い・余分）。
const ADDED: u32 = 1;
/// 見本にだけある文字（抜け）。
const REMOVED: u32 = 2;

/// 道をたどり直すために残す位置の数の上限（i32 で 64 MB）。全く違う3000字どうしで約1350万。
const MAX_TRACE: usize = 1 << 24;

/// 差分の区切りを集める。続いている違いは、入力にだけある文字を先、見本にだけある文字を後にまとめる
/// （画面では、打った文字のあとに本来の文字を差し込んで示すため）。
#[derive(Default)]
struct Runs {
    runs: Vec<u32>,
    added: usize,
    removed: usize,
}

impl Runs {
    fn equal(&mut self, count: usize) {
        if count == 0 {
            return;
        }
        self.flush();
        match self.runs.last_mut() {
            Some(last) if *last & 3 == EQUAL => *last += (count as u32) << 2,
            _ => self.runs.push((count as u32) << 2 | EQUAL),
        }
    }

    fn added(&mut self, count: usize) {
        self.added += count;
    }

    fn removed(&mut self, count: usize) {
        self.removed += count;
    }

    fn flush(&mut self) {
        if self.added > 0 {
            self.runs.push((self.added as u32) << 2 | ADDED);
        }
        if self.removed > 0 {
            self.runs.push((self.removed as u32) << 2 | REMOVED);
        }
        self.added = 0;
        self.removed = 0;
    }

    fn finish(mut self) -> Vec<u32> {
        self.flush();
        self.runs
    }
}

fn common_prefix(a: &[u32], b: &[u32]) -> usize {
    a.iter().zip(b).take_while(|(x, y)| x == y).count()
}

/// ある歩数で調べた対角線 k（x − y）の範囲 lo..=hi（1つおき）と、最も進んだ x を置いた位置。
#[derive(Clone, Copy)]
struct Step {
    lo: isize,
    hi: isize,
    start: usize,
}

struct Trace {
    steps: Vec<Step>,
    /// 各対角線の最も進んだ x。道がない対角線は -1。
    xs: Vec<i32>,
}

impl Trace {
    fn x(&self, d: usize, k: isize) -> Option<isize> {
        let step = self.steps[d];
        if k < step.lo || k > step.hi {
            return None;
        }
        let x = self.xs[step.start + ((k - step.lo) / 2) as usize];
        (x >= 0).then_some(x as isize)
    }

    /// 歩数 d で対角線 k に来る直前の位置と、入力の文字を足して（下へ）来たかどうか。
    /// 見本の文字を除く（右へ）のと同じだけ進むなら、足す方を選ぶ。
    fn previous(&self, d: usize, k: isize, n: isize, m: isize) -> Option<(isize, bool)> {
        let down = self.x(d - 1, k + 1).filter(|&x| x - (k + 1) < m);
        let right = self.x(d - 1, k - 1).filter(|&x| x < n);
        match (down, right) {
            (Some(a), Some(b)) if b + 1 > a => Some((b, false)),
            (Some(a), _) => Some((a, true)),
            (None, Some(b)) => Some((b, false)),
            (None, None) => None,
        }
    }
}

/// 見本（old）→ 入力（new）の差分の区切り。expired が true を返したら（期限を過ぎたら）None。
fn diff_runs(old: &[u32], new: &[u32], mut expired: impl FnMut() -> bool) -> Option<Vec<u32>> {
    let (n, m) = (old.len() as isize, new.len() as isize);
    let snake = |x: isize, y: isize| x + common_prefix(&old[x as usize..], &new[y as usize..]) as isize;
    let x = snake(0, 0);
    let mut trace = Trace { steps: vec![Step { lo: 0, hi: 0, start: 0 }], xs: vec![x as i32] };
    if x >= n && x >= m {
        return Some(backtrack(&trace, 0, n, m));
    }
    // 端に着いた道より外側の対角線は、その道より短い編集で終わりに着けないため調べない。
    let mut min_k = if x >= m { 1 } else { -m };
    let mut max_k = if x >= n { -1 } else { n };

    for d in 1..=(n + m) as usize {
        if expired() {
            return None;
        }
        let previous = trace.steps[d - 1];
        let parity = d as isize & 1;
        let mut lo = (previous.lo - 1).max(min_k);
        let mut hi = (previous.hi + 1).min(max_k);
        if lo & 1 != parity {
            lo += 1;
        }
        if hi & 1 != parity {
            hi -= 1;
        }
        if lo > hi {
            return None;
        }
        let start = trace.xs.len();
        if start + ((hi - lo) / 2 + 1) as usize > MAX_TRACE {
            return None;
        }
        for k in (lo..=hi).step_by(2) {
            let Some((before, down)) = trace.previous(d, k, n, m) else {
                trace.xs.push(-1);
                continue;
            };
            let x = snake(before + !down as isize, before + !down as isize - k);
            let y = x - k;
            if x >= n && y >= m {
                trace.steps.push(Step { lo, hi, start });
                return Some(backtrack(&trace, d, n, m));
            }
            if x >= n {
                max_k = max_k.min(k - 1);
            }
            if y >= m {
                min_k = min_k.max(k + 1);
            }
            trace.xs.push(x as i32);
        }
        trace.steps.push(Step { lo, hi, start });
    }
    None
}

/// 歩数 d で終わり（n, m）に着いた道を、先頭までたどり直して区切りにする。
fn backtrack(trace: &Trace, mut d: usize, n: isize, m: isize) -> Vec<u32> {
    // 後ろから集め、最後に逆順で Runs に渡す。
    let mut moves: Vec<(u32, usize)> = Vec::new();
    let (mut x, mut y) = (n, m);
    while d > 0 {
        let k = x - y;
        let (before, down) = trace.previous(d, k, n, m).expect("たどった道は前の歩数から来ている");
        let (from_k, kind) = if down { (k + 1, ADDED) } else { (k - 1, REMOVED) };
        let after = before + !down as isize;
        moves.push((EQUAL, (x - after) as usize));
        moves.push((kind, 1));
        x = before;
        y = before - from_k;
        d -= 1;
    }
    moves.push((EQUAL, x as usize));
    debug_assert_eq!(x, y);

    let mut runs = Runs::default();
    for (kind, count) in moves.into_iter().rev() {
        match kind {
            EQUAL => runs.equal(count),
            ADDED => runs.added(count),
            _ => runs.removed(count),
        }
    }
    runs.finish()
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// JavaScript の `Date.now()`。
    fn now() -> f64;
}

/// u32 を len 個置ける領域を確保する。
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u32 {
    let mut buffer = Vec::<u32>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// `alloc` で確保した領域、または `diff` の結果（len は区切りの数 + 1）を返す。
///
/// # Safety
/// ptr と len は、`alloc` の戻り値と引数、または `diff` の戻り値とその長さであること。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u32, len: usize) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len) });
}

/// 見本と入力（コードポイントの並び）の差分。期限（`Date.now()` の値）を過ぎたら null。
///
/// # Safety
/// sample・input は、それぞれ u32 を sample_len・input_len 個読める領域であること。
#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn diff(
    sample: *const u32,
    sample_len: usize,
    input: *const u32,
    input_len: usize,
    deadline: f64,
) -> *mut u32 {
    let sample = unsafe { std::slice::from_raw_parts(sample, sample_len) };
    let input = unsafe { std::slice::from_raw_parts(input, input_len) };
    match diff_runs(sample, input, || unsafe { now() > deadline }) {
        Some(runs) => {
            let mut out = Vec::with_capacity(runs.len() + 1);
            out.push(runs.len() as u32);
            out.extend(runs);
            Box::into_raw(out.into_boxed_slice()) as *mut u32
        }
        None => std::ptr::null_mut(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(text: &str) -> Vec<u32> {
        text.chars().map(u32::from).collect()
    }

    fn runs(old: &str, new: &str) -> Vec<(u32, usize)> {
        diff_runs(&codes(old), &codes(new), || false)
            .unwrap()
            .into_iter()
            .map(|run| (run & 3, (run >> 2) as usize))
            .collect()
    }

    /// 区切りから見本と入力を組み立て直せるか、続いている違いが「追加 → 削除」の順か、編集の数が最小かを確かめる。
    fn check(old: &[u32], new: &[u32]) {
        let result = diff_runs(old, new, || false).unwrap();
        let (mut s, mut t, mut edits) = (0, 0, 0);
        let mut previous: Option<u32> = None;
        for run in result {
            let (kind, count) = (run & 3, (run >> 2) as usize);
            assert!(count > 0);
            match kind {
                EQUAL => {
                    assert_ne!(previous, Some(EQUAL));
                    assert_eq!(old[s..s + count], new[t..t + count]);
                    s += count;
                    t += count;
                }
                ADDED => {
                    assert!(previous.is_none() || previous == Some(EQUAL));
                    t += count;
                    edits += count;
                }
                REMOVED => {
                    assert_ne!(previous, Some(REMOVED));
                    s += count;
                    edits += count;
                }
                _ => unreachable!(),
            }
            previous = Some(kind);
        }
        assert_eq!((s, t), (old.len(), new.len()));
        assert_eq!(edits, old.len() + new.len() - 2 * lcs(old, new));
    }

    fn lcs(a: &[u32], b: &[u32]) -> usize {
        let mut row = vec![0; b.len() + 1];
        for x in a {
            let mut diagonal = 0;
            for (j, y) in b.iter().enumerate() {
                let above = row[j + 1];
                row[j + 1] = if x == y { diagonal + 1 } else { above.max(row[j]) };
                diagonal = above;
            }
        }
        row[b.len()]
    }

    #[test]
    fn 抜けと打ち間違い() {
        assert_eq!(
            runs("今日はいい天気", "今日いい転気"),
            [(EQUAL, 2), (REMOVED, 1), (EQUAL, 2), (ADDED, 1), (REMOVED, 1), (EQUAL, 1)]
        );
    }

    #[test]
    fn 一致と空() {
        assert_eq!(runs("あいう", "あいう"), [(EQUAL, 3)]);
        assert_eq!(runs("", "あい"), [(ADDED, 2)]);
        assert_eq!(runs("あい", ""), [(REMOVED, 2)]);
        assert!(runs("", "").is_empty());
    }

    #[test]
    fn 補助面の文字は1文字() {
        assert_eq!(runs("𠮷野家", "吉野家"), [(ADDED, 1), (REMOVED, 1), (EQUAL, 2)]);
    }

    #[test]
    fn 編集の数が同じなら先頭から一致させ抜けを後ろに寄せる() {
        assert_eq!(
            runs("あいうえあいうえあいうえ", "あXいうあXいう"),
            [(EQUAL, 1), (ADDED, 1), (EQUAL, 2), (REMOVED, 1), (EQUAL, 1), (ADDED, 1), (EQUAL, 2), (REMOVED, 5)]
        );
        assert_eq!(runs("あいうえお", "あい"), [(EQUAL, 2), (REMOVED, 3)]);
    }

    #[test]
    fn 遠くの同じ文字にも一致させて編集を最小にする() {
        assert_eq!(runs("あいうえおかきくけこの", "あいの"), [(EQUAL, 2), (REMOVED, 8), (EQUAL, 1)]);
    }

    #[test]
    fn 編集の数が最小になる() {
        // 小さな文字の種類で、偶奇・長さの違う組み合わせを作る（乱数は固定の線形合同法）。
        let mut seed: u32 = 12345;
        let mut next = move |limit: u32| {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
            (seed >> 16) % limit
        };
        for _ in 0..2000 {
            let old: Vec<u32> = (0..next(12)).map(|_| next(4)).collect();
            let new: Vec<u32> = (0..next(12)).map(|_| next(4)).collect();
            check(&old, &new);
        }
        check(
            &codes("選挙控えるトランプ米政権、軽油で欧州に圧力日本は国内精製で距離"),
            &codes("選挙を控えるトランプ米政権、経由で欧州に圧力日本は国内"),
        );
    }

    #[test]
    fn 期限を過ぎたら結果を返さない() {
        let old = codes(&"あいうえお".repeat(100));
        let new = codes(&"アイウエオ".repeat(100));
        assert!(diff_runs(&old, &new, || true).is_none());
        // 前後の一致だけで済む場合は、期限を確かめずに返す。
        assert!(diff_runs(&old, &old, || true).is_some());
    }
}
