// file:// では保存領域を共有し得るため、HTML の配置場所ごとに記録する。
export function sessionKey(href) {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  return url.href;
}
