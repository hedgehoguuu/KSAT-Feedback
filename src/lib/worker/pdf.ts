import 'server-only';
import { PDFDocument } from 'pdf-lib';

/** 페이지 한 변의 최대 길이(pt). A4 긴 변(842pt)보다 조금 크게 잡아 화면에서 읽기 좋게 둔다. */
const MAX_EDGE = 1000;

export type PdfSource = { bytes: Uint8Array; name: string };

/**
 * 과목별 사진을 업로드 순서대로 PDF 한 개로 합친다 (BE-3).
 *
 * 페이지 크기를 사진 비율에 맞춰 정한다. 고정 규격에 끼워 넣지 않으므로
 * 세로·가로가 섞여 있어도 잘리거나 여백에 갇히지 않는다.
 */
export async function mergeToPdf(sources: PdfSource[]): Promise<Uint8Array> {
  if (sources.length === 0) throw new Error('합칠 사진이 없습니다');

  const pdf = await PDFDocument.create();
  pdf.setTitle('시험지');
  pdf.setCreator('KSAT-Feedback');

  for (const source of sources) {
    // 업로드 단계에서 전부 JPEG 로 정규화된다 (BE-1). 혹시 PNG 가 섞여도 받아준다.
    const image = isPng(source.bytes)
      ? await pdf.embedPng(source.bytes)
      : await pdf.embedJpg(source.bytes);

    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = image.width * scale;
    const height = image.height * scale;

    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }

  return pdf.save();
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

/** 파일명: {접수번호}_{학년}_{과목}.pdf (BE-3 AC) */
export function pdfFileName(receiptNo: string, grade: number, subjectLabel: string): string {
  return `${receiptNo}_고${grade}_${subjectLabel}.pdf`;
}
