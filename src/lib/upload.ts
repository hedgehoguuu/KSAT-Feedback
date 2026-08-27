// 서명 URL 발급 → 스토리지 직접 업로드 (BE-1). 서버를 경유하지 않는다.
//
// Supabase 환경변수가 없으면 mock 모드로 떨어져서 키 없이도 ②단계 전체를 돌려볼 수 있다.
// mock 모드에서 파일 이름에 'fail' 이 들어가면 실패로 처리한다 — FE-4 실패 UI 확인용.

export type UploadTarget =
  | { mode: 'supabase'; path: string; signedUrl: string }
  | { mode: 'mock'; path: string };

export async function requestUploadTarget(params: {
  draftId: string;
  subject: string;
  /** 사진마다 고유한 값. 순번을 쓰면 지웠다 다시 올릴 때 먼저 올린 파일을 덮어쓴다. */
  fileId: string;
}): Promise<UploadTarget> {
  const res = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`서명 URL 발급 실패 (${res.status})`);
  return (await res.json()) as UploadTarget;
}

export function uploadBlob(
  target: UploadTarget,
  blob: Blob,
  fileName: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  if (target.mode === 'mock') return mockUpload(fileName, onProgress);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.signedUrl, true);
    xhr.setRequestHeader('content-type', 'image/jpeg');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`업로드 실패 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('연결이 끊겼어요'));
    xhr.onabort = () => reject(new Error('업로드가 취소됐어요'));
    xhr.send(blob);
  });
}

function mockUpload(fileName: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let p = 0;
    const shouldFail = /fail/i.test(fileName);
    const timer = setInterval(() => {
      p += 12 + Math.random() * 18;
      if (p >= 100) {
        clearInterval(timer);
        if (shouldFail) {
          reject(new Error('이 사진만 잘 안 올라갔어요'));
        } else {
          onProgress(100);
          resolve();
        }
        return;
      }
      onProgress(Math.round(p));
    }, 90);
  });
}
