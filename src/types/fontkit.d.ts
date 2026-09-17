// fontkit 2 는 타입을 싣고 오지 않는다. 이 앱이 쓰는 몇 개만 적는다
// (lib/lms/pdf/fontkit.ts · feedback-pdf.ts). 더 쓰게 되면 여기에 더한다.
declare module 'fontkit' {
  export interface Subset {
    includeGlyph(glyph: number | { id: number }): number;
    encode(): Uint8Array;
  }

  export interface Font {
    hasGlyphForCodePoint(codePoint: number): boolean;
    createSubset(): Subset;
  }

  export function create(buffer: Uint8Array, postscriptName?: string): Font;
}
