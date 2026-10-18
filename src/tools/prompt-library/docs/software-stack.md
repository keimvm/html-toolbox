# プロンプト集 技術構成

元の企画書：[requirements.md](requirements.md)。満たす要件は [software-requirements.md](software-requirements.md) を参照。

## 選定に関わる制約

- toolbox 共通の制約（[要件の制約](software-requirements.md#制約)）と [ツール追加の手順](../../../../docs/development.md#ツールを追加する) に従う。
- プロンプトは本人が選んだフォルダのファイルに残す。ブラウザー内に本文を持たない。

## 採用する技術

| 担当 | 技術 | 役割・採用理由 |
| --- | --- | --- |
| 処理 | TypeScript | 保存ファイルの形を型で表し、読み書きでの取り違えを防ぐ |
| 画面 | Preact ＋ toolbox の共通部品（`src/ui/`） | toolbox の1つのアプリの一部として、ほかのツールと同じ部品で作る |
| 自動テスト | Vitest | 絞り込み（AND）、保存ファイルの読み書き（ファイル API は模擬） |

実行時のライブラリは追加しない。以下はブラウザーの標準機能と toolbox の共通部品でまかなう。

| 役割 | 標準機能・共通部品 | 補足 |
| --- | --- | --- |
| フォルダの選択・読み書き | File System Access API（`showDirectoryPicker()`、`getFileHandle({ create: true })`、`createWritable()`） | ローカルノートと同じ API。書き込み許可はブラウザーの求めに応じて利用者の操作から要求する |
| 保存先の記憶 | IndexedDB に `FileSystemDirectoryHandle` を保存（`src/lib/idb.ts`）、`queryPermission()`・`requestPermission()` | 本文は入れない。新しい版でも引き継げるよう、固定のキーで記録する |
| 保存ファイルの形 | JSON（`JSON.parse`・`JSON.stringify`） | 全プロンプトを1ファイルにまとめる |
| コピー | Clipboard API（`src/lib/clipboard.ts`） | ボタン・数字キーの操作から呼ぶ |
| 編集画面・削除の確認・知らせ | `Dialog`・`ask()`・`toast()`（`src/ui/components.tsx`） | 削除の確認の「削除する」を押した直後に書き込みの許可を求める（`ask()` の `start`） |

## 既存ツールとの関係

- ローカルノート（`src/tools/note-html/session-store.js`・`app.js`）が、フォルダの記憶・許可の再要求を同じ API で実装している。`file://` でフォルダを選んで読み取れることは、ローカルノートの[検証記録](../../note-html/docs/VERIFICATION.md)で確認済み。
- ローカルノートの記録は配置 URL ごと・ほかの復元情報と一緒に持つ形で、このツールの「版をまたいで覚える」要件とは異なる。IndexedDB の1つのキーへの読み書き（接続・transaction の確定待ち・停止時の打ち切り）は役割が同じため、`src/lib/idb.ts` の `createRecordStore()` を両ツールで使う。DB名・キー・記録の形と検査、許可の再要求は各ツールに残す。

## 実装で決めたこと

- **保存ファイル**：選んだフォルダ直下の `prompt-library.json`。`{ "format": "toolbox-prompt-library", "version": 1, "prompts": [{ "id", "title", "body", "tags" }] }` の形で、2字下げの JSON にする。`id` は追加時に `crypto.randomUUID()` で決め、編集・削除の対象を探すのに使う。
- **形式の版**：`version` が新しいファイルは「新しい版の toolbox で開いてください」と示して読まない。形式が違う・JSON として読めない場合も上書きしない。作成直後で中身が空のファイルだけは、失う内容がないため新しい保存ファイルとして扱う。
- **書き込み**：`createWritable()` は一時ファイルに書いて `close()` で置き換えるため、自前の一時ファイルは作らない。書き込む直前にファイルを読み直して変更を当て（`changeLibrary()`）、ほかのタブの変更を消さない。編集対象がほかのタブで削除されていた場合は保存せず知らせる。タブに戻ったとき（`visibilitychange`）にも読み直して一覧を更新する。
- **許可**：フォルダの選択は `mode: 'readwrite'` で行う。記録したフォルダは起動時に `queryPermission()` で確かめ、許可が残っていればそのまま開く。残っていなければ「前回のフォルダを開く」の押下で `requestPermission()` を呼ぶ。書き込みの直前にも確かめる。
- **保存先の記録**：IndexedDB の DB `toolbox-prompt-library`、ストア `folders`、固定のキー `library-folder` に `{ version: 1, folder: FileSystemDirectoryHandle }` を置く。
- **画面**：編集画面と削除の確認は `dialog`、保存先の表示と「保存先を変える…」はヘッダー右の `popover` のメニューに置く。一覧はタイトル順、タグは名前順（`Intl.Collator('ja', { numeric: true })`）。タグの入力は空白・カンマ・読点で区切り、使っているタグを編集画面に候補として並べる。
- **コピー**：`navigator.clipboard.writeText()` が失敗した場合は、編集画面から選択してコピーするよう案内する。

## toolbox の1つのアプリへの移行（2026-10-18）

- 保存ファイルの読み書き（`library.ts`・`storage.ts`）とフォルダの記録（`folder-memory.ts`）は、旧コードとテストをそのまま移した。記録の DB・ストア・キーは変えず、旧版で選んだフォルダを引き継ぐ。
- 画面は共通部品で作り直した。足したもの：一覧の上から9件の数字キーでのコピー、カードのタグでの絞り込み、保存していない入力を捨てる前の確認、ホームから受け取った文章を本文にした新しいプロンプト（`new-from-text`）、ホームに置いたフォルダを保存先にすること（`use-folder`）。置いただけでは書き込みの許可を求められないため、許可が要るときは「（フォルダ名）を保存先にする」のボタンから求める。
- 編集画面は、ほかの画面を見ている間は閉じておき、戻ったら開き直す（隠れた画面のモーダルがほかの画面の操作を止めないため）。

## 未検証事項

- `file://` で開いたページで、Clipboard API の `writeText` が使えるか。
- `file://` の IndexedDB が toolbox の版（解凍先のフォルダ）をまたいで共有され、保存したフォルダの記録を新しい版で読めるか。共有されない場合は、新しい版で一度フォルダを選び直すことになる。
- `file://` での書き込み許可と保存ファイルの作成・上書き（ローカルノートでも書き込みの実機確認は未完了）。
- 会社の PC のブラウザー設定（管理ポリシー）で、File System Access API が止められていないか。

## 実装時に委ねること

- ファイル構成、関数・型の分け方。
- 保存ファイルの書き込み方の細部（一時ファイル経由かどうかなど）と、IndexedDB の DB 名・キー名。
