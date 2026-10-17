// 「このアプリについて」。版、データの扱い（外部と通信しないこと）、ライブラリのライセンス。
import { signal } from '@preact/signals';
import { licenses } from 'virtual:toolbox/licenses';
import { Button, Dialog } from '../ui/components';
import { Icon } from '../ui/icons';
import { versionLabel } from './frame';

export const aboutOpen = signal(false);

export function About() {
  return (
    <Dialog
      open={aboutOpen.value}
      onClose={() => (aboutOpen.value = false)}
      class="about"
      title="toolbox について"
      actions={
        <Button variant="primary" onClick={() => (aboutOpen.value = false)}>
          閉じる
        </Button>
      }
    >
      {aboutOpen.value && (
        <div class="about-body">
          <p class="about-version">
            版 <strong>{versionLabel}</strong>
          </p>
          <section class="about-promise">
            <Icon name="shield" />
            <div>
              <h3>この PC の中で完結します</h3>
              <p>
                扱うファイルや入力した内容は、この PC の中だけで処理し、外部へ送信しません。この
                HTML はブラウザーの仕組み（Content Security
                Policy）で、外部との通信そのものを止めています。インストールもネット接続も要りません。
              </p>
            </div>
          </section>
          <section class="about-promise">
            <Icon name="folder" />
            <div>
              <h3>元のファイルを上書きしません</h3>
              <p>
                PDF・画像は、編集・変換した結果を別のファイルとして保存（ダウンロード）します。ローカルノートとプロンプト集だけは、あなたが選んだフォルダのファイルに、保存を確定した時点で書き込みます。
              </p>
            </div>
          </section>
          <details class="about-licenses">
            <summary>使っているライブラリのライセンス</summary>
            <pre class="tb-scroll">{licenses()}</pre>
          </details>
        </div>
      )}
    </Dialog>
  );
}
