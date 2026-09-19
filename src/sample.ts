/** 共有可能な合成PDF。外部ファイル・個人情報を含まない。 */
export function createSamplePdf(): ArrayBuffer {
  const image =
    Array.from({ length: 160 * 82 }, (_, i) => {
      const x = i % 160,
        y = Math.floor(i / 160);
      const rgb =
        y > 60
          ? [211, 210, 190]
          : x > 25 && x < 70 && y < 45
            ? [243, 245, 232]
            : [211, 224, 201];
      return rgb.map((n) => n.toString(16).padStart(2, '0')).join('');
    }).join('') + '>';
  const streams = [
    '0.21 0.36 0.29 rg BT /F1 32 Tf 60 720 Td (A place to work.) Tj 0 -46 Td (A place to think.) Tj /F1 14 Tf 0 -62 Td (WORKPLACE PLAN / 2026.09) Tj ET 0.83 0.88 0.80 rg 60 160 475 330 re f',
    '0.21 0.36 0.29 rg BT /F1 28 Tf 60 735 Td (Space for better ideas.) Tj /F1 12 Tf 0 -45 Td (Choose the place that fits your work.) Tj ET q 453.5433 0 0 232.4409 60 350 cm /Im1 Do Q BT /F1 16 Tf 60 290 Td (01 Focus) Tj /F1 12 Tf 0 -28 Td (Natural light. Calm materials. Room to think.) Tj ET',
    '0.21 0.36 0.29 rg BT /F1 28 Tf 60 735 Td (Design around people.) Tj ET 0.83 0.88 0.80 rg 60 280 270 320 re f 0.91 0.94 0.88 rg 340 280 195 150 re f 340 440 195 160 re f 0.21 0.36 0.29 rg BT /F1 16 Tf 95 420 Td (FOCUS) Tj 280 95 Td (MEET) Tj 0 -170 Td (CONNECT) Tj ET',
    '0.21 0.36 0.29 rg BT /F1 28 Tf 60 735 Td (Small steps, better places.) Tj /F1 18 Tf 0 -100 Td (October - Listen) Tj 0 -100 Td (November - Plan) Tj 0 -100 Td (December - Try and improve) Tj ET',
  ];
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [5 0 R 7 0 R 9 0 R 11 0 R] /Count 4 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /XObject /Subtype /Image /Width 160 /Height 82 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${image.length} >>\nstream\n${image}\nendstream`,
  ];
  const japanese = Array.from('企画チーム / サンプル文書', (char) =>
    char.charCodeAt(0).toString(16).padStart(4, '0'),
  ).join('');
  streams.forEach((stream, index) => {
    const content = `${stream}\n0.4 0.47 0.4 rg BT /F1 10 Tf 60 45 Td (SAMPLE DOCUMENT / ${index + 1}) Tj ET BT /F2 10 Tf 60 65 Td <${japanese}> Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Resources << /Font << /F1 3 0 R /F2 13 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
    );
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });
  objects.push(
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UTF16-H /DescendantFonts [14 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> /FontDescriptor 15 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
  );
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(pdf).buffer;
}
