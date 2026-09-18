import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import type { Font } from 'fontkit';
import { KINDS, SECTIONS, SUBJECT, concernTopic, paperQuestion } from '@/config/lms';
import { fmtDay, fmtScore } from '@/lib/format';
import { fontkitForPdfLib, openFont } from './fontkit';
import { fitText, wrapText } from './wrap';

/**
 * 답변 PDF — 학생이 시험 뒤에 남긴 질문과 튜터의 답을 한 권으로 묶는다.
 *
 * 순서: 머리말 → 점수(채점이 끝났을 때만) → 질문과 답변 → 총평. 바닥글에 쪽 번호.
 * 색과 글꼴은 사이트와 같다(Pretendard · 파랑은 기본 · 빨강은 '여기를 보라').
 *
 * 여기는 DB 도 저장소도 모른다. 모아 온 값(FeedbackDoc)과 폰트 바이트만 받아 PDF 바이트를
 * 돌려준다 — 그래서 시험에서 그대로 불러 모양을 확인할 수 있다 (test/logic.ts).
 */

export type FeedbackGridCell = {
  no: number;
  /** 매기지 않았으면 null */
  mark: 'o' | 'x' | null;
  chosen: number | null;
  answer: number | null;
};

export type FeedbackConcern = {
  /** 0 = 시험 전체 */
  no: number;
  body: string;
  answer: string | null;
  image: { bytes: Uint8Array; type: 'jpg' | 'png' } | null;
  /** 그 문항을 맞혔나. 채점 전이거나 '시험 전체' 면 null. */
  mark: 'o' | 'x' | null;
  unitLabel: string | null;
};

export type FeedbackDoc = {
  courseName: string;
  examTitle: string;
  examDate: string | null;
  studentName: string;
  tutorName: string | null;
  /** YYYY-MM-DD (한국 날짜) */
  issuedOn: string;
  /** 채점이 끝났을 때만. 반쪽짜리 점수는 싣지 않는다. */
  score: {
    earned: number;
    total: number;
    sections: { label: string; earned: number; total: number }[];
    wrongNos: number[];
    grid: FeedbackGridCell[];
  } | null;
  concerns: FeedbackConcern[];
  overallComment: string | null;
};

export type FontFiles = { regular: Uint8Array; bold: Uint8Array };

/* ───────────────────────────────────────────────────────────── 치수 · 색 */

const PAGE = { w: 595.28, h: 841.89 }; // A4
const M = { top: 54, bottom: 66, left: 48, right: 48 };
const WIDTH = PAGE.w - M.left - M.right;

function hex(value: string): RGB {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// globals.css 의 색 변수와 같은 값. 파랑은 데이터 · 버튼, 빨강은 틀린 것에만.
const C = {
  ink: hex('#191f28'),
  sub: hex('#4e5968'),
  muted: hex('#8b95a1'),
  line: hex('#e5e8eb'),
  surface: hex('#f6f7f9'),
  brand: hex('#3182f6'),
  brandSoft: hex('#eef4fe'),
  mark: hex('#e5342b'),
  white: rgb(1, 1, 1),
};

const BODY = 10.5;
const LEADING = BODY * 1.7;

/* ──────────────────────────────────────────────────────────── 글자 거르기 */

const INVISIBLE = /[​-‏⁠︀-️﻿]/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

/**
 * 폰트에 없는 글자를 걸러 낸다. 그대로 두면 PDF 에 아무것도 안 찍히거나 뜻 모를 네모가 된다.
 * 이모지는 조용히 빼고(학생 질문에 흔하다), 나머지 모르는 글자는 □ 로 자리만 남긴다 —
 * 수식 기호가 사라져 문장 뜻이 바뀌는 것보다 '여기 뭔가 있었다' 가 낫다.
 */
function clean(text: string, font: Font): string {
  let out = '';
  for (const ch of text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '  ')) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '\n') out += ch;
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || INVISIBLE.test(ch)) continue;
    else if (font.hasGlyphForCodePoint(cp)) out += ch;
    else if (PICTOGRAPH.test(ch)) continue;
    else out += '□';
  }
  return out;
}

/* ──────────────────────────────────────────────────────────── 쓰는 손 */

type Fonts = { regular: PDFFont; bold: PDFFont; glyphs: Font };

type FlowOptions = {
  size?: number;
  font?: PDFFont;
  color?: RGB;
  leading?: number;
  /** 옅은 칸 안에 담는다 (학생 질문 · 총평) */
  box?: RGB;
  /** 왼쪽에 세로 막대를 긋는다 (튜터 답) */
  bar?: RGB;
};

// 시험(test/logic.ts)은 node 가 타입만 벗겨서 돌린다. 그 방식은 생성자 매개변수에
// readonly 를 붙이는 줄임 문법을 못 읽어서, 필드를 따로 적는다.
class Writer {
  readonly pdf: PDFDocument;
  readonly f: Fonts;
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  /** 다음에 쓸 자리의 윗선 (PDF 좌표라 아래로 갈수록 작아진다) */
  y = 0;

  constructor(pdf: PDFDocument, f: Fonts) {
    this.pdf = pdf;
    this.f = f;
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE.w, PAGE.h]);
    this.pages.push(this.page);
    this.y = PAGE.h - M.top;
  }

  get room() {
    return this.y - M.bottom;
  }

  /** 이만큼이 안 남았으면 다음 쪽으로. 제목이 쪽 끝에 홀로 남지 않게 할 때 쓴다. */
  ensure(height: number) {
    if (this.room < height) this.newPage();
  }

  gap(height: number) {
    this.y -= height;
  }

  clean(text: string) {
    return clean(text, this.f.glyphs);
  }

  width(text: string, size: number, font: PDFFont = this.f.regular) {
    return font.widthOfTextAtSize(text, size);
  }

  /** 한 줄. 윗선이 아니라 글자 바닥선(baseline) 기준이다. */
  text(value: string, x: number, baseline: number, size: number, font: PDFFont, color: RGB) {
    if (value) this.page.drawText(value, { x, y: baseline, size, font, color });
  }

  /** 모서리가 둥근 칸. top 은 칸의 윗선이다. */
  roundRect(x: number, top: number, w: number, h: number, r: number, fill: RGB) {
    const k = Math.min(r, w / 2, h / 2);
    // drawSvgPath 는 (x, y) 를 원점으로 두고 아래로 그린다 — SVG 좌표 그대로다.
    const path =
      `M ${k} 0 H ${w - k} Q ${w} 0 ${w} ${k} V ${h - k} Q ${w} ${h} ${w - k} ${h} ` +
      `H ${k} Q 0 ${h} 0 ${h - k} V ${k} Q 0 0 ${k} 0 Z`;
    this.page.drawSvgPath(path, { x, y: top, color: fill });
  }

  rule(color: RGB = C.line, thickness = 0.6) {
    this.page.drawLine({
      start: { x: M.left, y: this.y },
      end: { x: PAGE.w - M.right, y: this.y },
      thickness,
      color,
    });
  }

  /**
   * 문단. 쪽을 넘기며 흐른다 — 긴 답이 한 쪽을 넘어도 잘리지 않는다.
   * 칸과 막대는 쪽마다 그 쪽에 들어간 줄만큼 따로 그린다.
   */
  flow(raw: string, o: FlowOptions = {}) {
    const size = o.size ?? BODY;
    const font = o.font ?? this.f.regular;
    const leading = o.leading ?? size * 1.7;
    const padX = o.box ? 14 : o.bar ? 12 : 0;
    const padY = o.box ? 10 : o.bar ? 2 : 0;
    const lines = wrapText(this.clean(raw), WIDTH - padX * 2, (s) => font.widthOfTextAtSize(s, size));

    let i = 0;
    while (i < lines.length) {
      if (this.room < leading + padY * 2) this.newPage();
      const fit = Math.max(1, Math.floor((this.room - padY * 2) / leading));
      const chunk = lines.slice(i, i + fit);
      const height = chunk.length * leading + padY * 2;
      const top = this.y;

      if (o.box) this.roundRect(M.left, top, WIDTH, height, 8, o.box);
      if (o.bar) this.page.drawRectangle({ x: M.left, y: top - height, width: 2.5, height, color: o.bar });

      // 줄 높이 가운데에 글자를 앉힌다. 0.78 은 Pretendard 의 대문자 높이 쪽으로 기운 값이다.
      let baseline = top - padY - (leading - size) / 2 - size * 0.8;
      for (const line of chunk) {
        this.text(line, M.left + padX, baseline, size, font, o.color ?? C.ink);
        baseline -= leading;
      }

      this.y = top - height;
      i += chunk.length;
      if (i < lines.length) this.newPage();
    }
  }

  /** 작은 딱지 글 ("질문" · "선생님 답변"). 바로 뒤 문단과 떨어지지 않게 두 줄 자리를 함께 잡는다. */
  label(value: string, color: RGB) {
    this.ensure(14 + LEADING * 2);
    this.text(value, M.left, this.y - 9, 8.5, this.f.bold, color);
    this.y -= 15;
  }

  heading(title: string, note?: string) {
    this.ensure(26 + 60);
    const baseline = this.y - 13;
    this.page.drawRectangle({ x: M.left, y: baseline - 2, width: 3.5, height: 15, color: C.brand });
    this.text(title, M.left + 11, baseline, 13.5, this.f.bold, C.ink);
    if (note) {
      const x = M.left + 11 + this.width(title, 13.5, this.f.bold) + 8;
      this.text(this.clean(note), x, baseline, 9.5, this.f.regular, C.muted);
    }
    this.y -= 28;
  }

  image(img: PDFImage) {
    const maxW = WIDTH - 12;
    const maxH = 420;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1.5);
    const w = img.width * scale;
    const h = img.height * scale;
    this.ensure(h + 4);
    const x = M.left + 12;
    this.page.drawImage(img, { x, y: this.y - h, width: w, height: h });
    this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, borderColor: C.line, borderWidth: 0.6 });
    this.y -= h;
  }
}

/* ──────────────────────────────────────────────────────────── 조각들 */

function header(w: Writer, doc: FeedbackDoc) {
  w.text(`${SUBJECT.course} · 질문 답변`, M.left, w.y - 9, 9.5, w.f.bold, C.brand);
  w.gap(18);
  w.flow(doc.examTitle, { size: 22, font: w.f.bold, leading: 31 });
  w.gap(2);
  w.flow(`${doc.studentName} 학생 · ${doc.courseName}`, { size: 11.5, color: C.sub, leading: 19 });

  const meta = [
    doc.examDate ? `시험 ${fmtDay(doc.examDate)}` : null,
    doc.tutorName ? `담당 ${doc.tutorName} 선생님` : null,
    `보낸 날 ${fmtDay(doc.issuedOn)}`,
  ].filter(Boolean);
  w.flow(meta.join('   ·   '), { size: 9, color: C.muted, leading: 16 });

  w.gap(12);
  w.rule(C.ink, 0.9);
  w.gap(22);
}

function scoreBlock(w: Writer, score: NonNullable<FeedbackDoc['score']>) {
  w.heading('점수');

  const boxes = [
    { label: '총점', value: fmtScore(score.earned), unit: `/ ${fmtScore(score.total)}` },
    ...score.sections.map((s) => ({ label: s.label, value: fmtScore(s.earned), unit: `/ ${fmtScore(s.total)}` })),
  ];
  const gapX = 10;
  const boxW = (WIDTH - gapX * (boxes.length - 1)) / boxes.length;
  const boxH = 58;
  w.ensure(boxH + 40 + 2 * 48 + 30);

  const top = w.y;
  boxes.forEach((box, i) => {
    const x = M.left + i * (boxW + gapX);
    w.roundRect(x, top, boxW, boxH, 10, i === 0 ? C.brandSoft : C.surface);
    w.text(box.label, x + 14, top - 18, 9, w.f.bold, i === 0 ? C.brand : C.muted);
    w.text(box.value, x + 14, top - 44, 22, w.f.bold, C.ink);
    w.text(box.unit, x + 18 + w.width(box.value, 22, w.f.bold), top - 44, 10.5, w.f.regular, C.muted);
  });
  w.y = top - boxH - 14;

  const wrong = score.wrongNos.length > 0 ? `틀린 문항   ${score.wrongNos.join(', ')}` : '틀린 문항이 없어요';
  w.flow(wrong, { size: 10.5, font: w.f.bold, color: score.wrongNos.length > 0 ? C.mark : C.brand, leading: 18 });
  w.gap(8);

  grid(w, score.grid);
  w.gap(4);
  // 튜터가 X 만 누르고 학생 답을 옮겨 적지 않으면 그 칸은 ‘?→정답’ 이 된다.
  w.flow('O 맞음 · X 틀림 · X 아래 숫자는 ‘내가 쓴 답 → 정답’(‘?’ 는 내 답이 기록되지 않은 칸) · 굵은 세로줄 오른쪽(23–30)이 미적분', {
    size: 8,
    color: C.muted,
    leading: 13,
  });
  w.gap(22);
}

/** 1–15 · 16–30 두 줄. 한눈에 어디서 무너졌는지 보이게 하는 자리다. */
function grid(w: Writer, cells: FeedbackGridCell[]) {
  const cols = 15;
  const cellW = WIDTH / cols;
  const cellH = 48;
  w.ensure(cellH * 2 + 8);

  for (let r = 0; r * cols < cells.length; r += 1) {
    const row = cells.slice(r * cols, (r + 1) * cols);
    const top = w.y;
    w.roundRect(M.left, top, WIDTH, cellH, 8, C.surface);

    row.forEach((cell, i) => {
      const x = M.left + i * cellW;
      const center = x + cellW / 2;
      const centered = (value: string, baseline: number, size: number, font: PDFFont, color: RGB) =>
        w.text(value, center - w.width(value, size, font) / 2, baseline, size, font, color);

      if (i > 0) {
        // 공통과 미적분의 경계(22|23)는 굵게 긋는다.
        const boundary = cell.no === 23;
        w.page.drawLine({
          start: { x, y: top - (boundary ? 4 : 10) },
          end: { x, y: top - cellH + (boundary ? 4 : 10) },
          thickness: boundary ? 1.4 : 0.5,
          color: boundary ? C.sub : C.line,
        });
      }

      centered(String(cell.no), top - 12, 7.5, w.f.bold, C.muted);
      if (cell.mark === 'o') centered('O', top - 29, 13, w.f.bold, C.brand);
      else if (cell.mark === 'x') centered('X', top - 29, 13, w.f.bold, C.mark);
      else centered('—', top - 28, 10, w.f.regular, C.muted);

      if (cell.mark === 'x') {
        // 칸이 좁아 동그라미 숫자(③)는 뭉개진다. 여기서만 맨 숫자로 적는다.
        const plain = (v: number | null) => (v === null ? '?' : String(v));
        const detail = `${plain(cell.chosen)}→${plain(cell.answer)}`;
        let size = 7;
        while (size > 4.5 && w.width(detail, size) > cellW - 4) size -= 0.5;
        centered(detail, top - 41, size, w.f.regular, C.mark);
      }
    });

    w.y = top - cellH - 6;
  }
}

/** 카드의 머리 줄과 질문 두어 줄. 이만큼은 한 쪽에 같이 있어야 읽힌다. */
const CARD_HEAD = 24 + 15 + LEADING * 3 + 20;

function concernCard(w: Writer, c: FeedbackConcern, image: PDFImage | null, last: boolean) {
  w.ensure(CARD_HEAD);

  const top = w.y;
  const q = paperQuestion(c.no);
  const badge = c.no === 0 ? concernTopic(0) : `${c.no}번`;
  const badgeW = w.width(badge, 10, w.f.bold) + 18;
  w.roundRect(M.left, top, badgeW, 21, 10.5, c.mark === 'x' ? C.mark : C.brand);
  w.text(badge, M.left + 9, top - 14.5, 10, w.f.bold, C.white);

  const meta = q
    ? [SECTIONS[q.section], KINDS[q.kind], `${q.points}점`, c.unitLabel].filter(Boolean).join(' · ')
    : '어느 한 문항이 아닌 이야기';
  w.text(w.clean(meta), M.left + badgeW + 9, top - 14.5, 9, w.f.regular, C.muted);

  if (c.mark) {
    const result = c.mark === 'o' ? '맞힌 문항' : '틀린 문항';
    const size = 9;
    w.text(result, PAGE.w - M.right - w.width(result, size, w.f.bold), top - 14.5, size, w.f.bold, c.mark === 'o' ? C.brand : C.mark);
  }
  w.y = top - 21 - 12;

  w.label('내 질문', C.muted);
  w.flow(c.body, { box: C.surface });
  w.gap(12);

  w.label('선생님 답변', C.brand);
  if (c.answer) w.flow(c.answer, { bar: C.brand });
  if (image) {
    if (c.answer) w.gap(10);
    w.image(image);
  }
  // 튜터가 보내기 전에 미리 볼 때만 생긴다. 보낼 때는 다 달렸는지 먼저 확인한다.
  if (!c.answer && !image) w.flow('아직 답을 달지 않았어요', { bar: C.line, color: C.muted });

  w.gap(20);
  if (!last) {
    // 다음 카드가 이 쪽에 못 들어가면 구분선 없이 넘긴다. 새 쪽 맨 위에 선만 걸리면 군더더기다.
    if (w.room < 20 + CARD_HEAD) {
      w.newPage();
    } else {
      w.rule(C.line, 0.6);
      w.gap(20);
    }
  }
}

function footers(w: Writer, doc: FeedbackDoc) {
  const total = w.pages.length;
  const size = 8;
  w.pages.forEach((page, i) => {
    const baseline = M.bottom - 34;
    page.drawLine({
      start: { x: M.left, y: baseline + 13 },
      end: { x: PAGE.w - M.right, y: baseline + 13 },
      thickness: 0.5,
      color: C.line,
    });
    const right = `${i + 1} / ${total}`;
    const rightW = w.f.regular.widthOfTextAtSize(right, size);
    const left = fitText(
      w.clean(`${doc.studentName} · ${doc.examTitle} · ${doc.courseName}`),
      WIDTH - rightW - 24,
      (s) => w.f.regular.widthOfTextAtSize(s, size),
    );
    page.drawText(left, { x: M.left, y: baseline, size, font: w.f.regular, color: C.muted });
    page.drawText(right, { x: PAGE.w - M.right - rightW, y: baseline, size, font: w.f.regular, color: C.muted });
  });
}

/* ──────────────────────────────────────────────────────────────── 조립 */

export async function renderFeedbackPdf(doc: FeedbackDoc, fonts: FontFiles): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitForPdfLib);
  pdf.setTitle(`${doc.examTitle} 질문 답변 — ${doc.studentName}`, { showInWindowTitleBar: true });
  pdf.setSubject(`${SUBJECT.course} · ${doc.courseName}`);
  pdf.setAuthor(doc.tutorName ?? doc.courseName);
  pdf.setCreator('KSAT-Feedback');
  pdf.setLanguage('ko-KR');

  // 쓰인 글자만 잘라 넣는다. 한글 폰트를 통째로 넣으면 굵기 하나에 1MB 가 넘는다.
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const w = new Writer(pdf, { regular, bold, glyphs: openFont(fonts.regular) });

  // 사진은 미리 넣어 둔다. 넣는 일은 기다려야 하고, 글을 흘리는 쪽은 기다리지 않는다.
  const images = await Promise.all(
    doc.concerns.map(async (c) => {
      if (!c.image) return null;
      try {
        return c.image.type === 'png' ? await pdf.embedPng(c.image.bytes) : await pdf.embedJpg(c.image.bytes);
      } catch {
        // 깨진 사진 한 장 때문에 PDF 전체가 안 나가면 안 된다. 그 자리는 글로 남긴다.
        return null;
      }
    }),
  );

  header(w, doc);
  if (doc.score) scoreBlock(w, doc.score);

  w.heading('질문과 답변', `${doc.concerns.length}개`);
  doc.concerns.forEach((c, i) => {
    const missing = c.image && !images[i] ? '(풀이 사진을 열지 못해 싣지 못했어요)' : null;
    concernCard(
      w,
      missing ? { ...c, answer: [c.answer, missing].filter(Boolean).join('\n\n') } : c,
      images[i],
      i === doc.concerns.length - 1,
    );
  });

  if (doc.overallComment?.trim()) {
    w.gap(8);
    w.heading('선생님 총평');
    w.flow(doc.overallComment, { box: C.brandSoft });
  }

  footers(w, doc);
  return pdf.save();
}
