import { crc32, deflateSync } from 'node:zlib';

/**
 * 16×12 px の一様な緑（RGB 40,120,80）の JPEG（776 バイト）。
 * Node.js で同じ色の 24 bit BMP を書き、macOS の `sips -s format jpeg -s formatOptions 80` で変換した。
 */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAADAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgADAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwQDAwMEBQQEBAQFBwUFBQUFBwgHBwcHBwcICAgICAgICAoKCgoKCgsLCwsLDQ0NDQ0NDQ0NDf/bAEMBAgICAwMDBgMDBg0JBwkNDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDf/dAAQAAf/aAAwDAQACEQMRAD8A+b6KKK8M/ms//9k=',
  'base64',
);
export const TINY_JPEG_SIZE = { width: 16, height: 12 };

/** RGBA の画素を、Node.js の zlib だけで PNG にする（フィルターなし）。 */
export function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // ビット深度
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 圧縮しても小さくならない画素（線形合同法の乱数）。 */
function noise(length: number) {
  const data = Buffer.alloc(length);
  let seed = 12345;
  for (let index = 0; index < length; index++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    data[index] = seed >>> 24;
  }
  return data;
}

export const PHOTO_SIZE = { width: 400, height: 300 };

/**
 * 写真の多い PDF の代わりに使う合成 PDF（2ページ）。
 * - 400×300 px の圧縮できない画像（Im1）を、両方のページに 300×225 pt で置く（96 dpi）。
 * - 1ページ目には、半分が透明な 100×80 px の画像（Im2、SMask 付き）も置く。保存し直しても大きさが変わらないよう、Flate で圧縮しておく。
 * - 文字は Helvetica の「Page one」「Page two」。
 */
export function photoPdf(): ArrayBuffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Buffer | string) => {
    const buffer =
      typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
    parts.push(buffer);
    length += buffer.length;
  };
  const photo = noise(PHOTO_SIZE.width * PHOTO_SIZE.height * 3);
  const mask = Buffer.alloc(100 * 80, 0);
  for (let y = 0; y < 80; y++) mask.fill(255, y * 100 + 50, y * 100 + 100);
  const red = Buffer.alloc(100 * 80 * 3);
  for (let index = 0; index < red.length; index += 3)
    red.set([200, 50, 50], index);
  const image = (
    width: number,
    height: number,
    colorSpace: string,
    data: Buffer,
    extra = '',
  ) => [
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /${colorSpace} /BitsPerComponent 8${extra} /Length ${data.length} >>\nstream\n`,
    data,
    '\nendstream',
  ];
  const content = (text: string, transparent: boolean) => {
    const body = `q 300 0 0 225 50 500 cm /Im1 Do Q${transparent ? ' q 100 0 0 80 400 300 cm /Im2 Do Q' : ''} BT /F1 24 Tf 50 300 Td (${text}) Tj ET`;
    return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  };
  const page = (contents: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R /Im2 5 0 R >> >> /Contents ${contents} 0 R >>`;
  const objects: (string | (string | Buffer)[])[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [7 0 R 8 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    image(PHOTO_SIZE.width, PHOTO_SIZE.height, 'DeviceRGB', photo),
    image(
      100,
      80,
      'DeviceRGB',
      deflateSync(red),
      ' /Filter /FlateDecode /SMask 6 0 R',
    ),
    image(100, 80, 'DeviceGray', deflateSync(mask), ' /Filter /FlateDecode'),
    page(9),
    page(10),
    content('Page one', true),
    content('Page two', false),
  ];
  push('%PDF-1.7\n');
  objects.forEach((object, index) => {
    offsets.push(length);
    push(`${index + 1} 0 obj\n`);
    for (const part of typeof object === 'string' ? [object] : object)
      push(part);
    push('\nendobj\n');
  });
  const xref = length;
  push(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('') +
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  );
  const pdf = Buffer.concat(parts);
  return new Uint8Array(pdf).buffer;
}
