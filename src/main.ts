import './style.css';

const status = document.querySelector<HTMLParagraphElement>('#status');

if (!status) {
  throw new Error('起動状態の表示先が見つかりません。');
}

status.textContent = '開発準備ができました。PDF編集機能はこれから追加します。';
