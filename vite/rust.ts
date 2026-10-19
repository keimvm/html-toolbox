// Rust で書いた WebAssembly を、Vite が読み込む前に cargo でビルドするプラグイン。
//
// - 出力（<クレート>/target/wasm32-unknown-unknown/release/*.wasm）は、ツールが `?init` で読み込む。
//   配布物では Vite が Base64 で JavaScript に埋め込み、テスト（Node.js）ではファイルから読む。
// - Rust の版と target はクレートの rust-toolchain.toml で固定する。rustup はカレントディレクトリでこのファイルを探すため、
//   cargo はクレートのフォルダで呼ぶ。
// - 開発サーバーでは、Rust のソースを書き換えたらビルドし直して画面を読み込み直す。
import { execFileSync } from 'node:child_process';
import { join, sep } from 'node:path';
import type { Plugin } from 'vite';

/** 配布物に入れる Rust のクレート（リポジトリ直下からの場所）。 */
export const CRATES = ['src/engine/diff/wasm'];

function build(dir: string) {
  try {
    execFileSync(
      'cargo',
      ['build', '--quiet', '--release', '--locked', '--target', 'wasm32-unknown-unknown'],
      { cwd: dir, stdio: 'inherit' },
    );
  } catch (error) {
    throw new Error(
      `Rust のビルドに失敗しました（${dir}）。rustup で Rust を入れてあるか確かめてください。`,
      { cause: error },
    );
  }
}

export function rustWasm({ root }: { root: string }): Plugin {
  const dirs = CRATES.map((crate) => join(root, crate));
  return {
    name: 'toolbox:rust-wasm',
    configResolved() {
      for (const dir of dirs) build(dir);
    },
    configureServer(server) {
      // Vite はリポジトリ直下から下を見張っている。
      const sources = dirs.map((dir) => join(dir, 'src') + sep);
      server.watcher.on('change', (file) => {
        const index = sources.findIndex((source) => file.startsWith(source));
        if (index < 0 || !file.endsWith('.rs')) return;
        try {
          build(dirs[index]!);
          server.ws.send({ type: 'full-reload' });
        } catch (error) {
          server.config.logger.error(String(error));
        }
      });
    },
  };
}
