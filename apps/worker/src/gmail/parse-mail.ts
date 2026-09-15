import type { gmail_v1 } from 'googleapis';
import { preprocessHtml } from '@apply-manager/shared';

/**
 * parseMailContent (스펙 6장): Gmail 메시지에서 제목/발신자/본문/수신시각 추출.
 * - multipart 재귀 순회, base64url 디코딩
 * - text/plain 우선, 없으면 text/html을 preprocessHtml로 스트립
 */

export interface ParsedMail {
  gmailMessageId: string;
  subject: string;
  from: string;
  body: string;
  /** 메일 수신 시각 (internalDate 기준) — application_events.occurred_at의 근거 */
  receivedAt: Date;
}

export function parseMailContent(message: gmail_v1.Schema$Message): ParsedMail {
  const headers = message.payload?.headers ?? [];
  const getHeader = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

  const { plain, html } = collectBodies(message.payload ?? undefined);
  const body =
    plain.length > 0
      ? plain.join('\n').trim()
      : preprocessHtml(html.join('\n')).text;

  const internalDate = Number(message.internalDate);
  return {
    gmailMessageId: message.id ?? '',
    subject: getHeader('Subject'),
    from: getHeader('From'),
    body,
    receivedAt: Number.isFinite(internalDate) && internalDate > 0
      ? new Date(internalDate)
      : new Date(),
  };
}

/** Gmail body.data는 base64url — 표준 base64로 바꿔 utf-8 디코딩 */
export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

interface CollectedBodies {
  plain: string[];
  html: string[];
}

function collectBodies(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: CollectedBodies = { plain: [], html: [] },
): CollectedBodies {
  if (!part) return acc;
  const mimeType = part.mimeType ?? '';
  if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (mimeType.startsWith('text/plain')) acc.plain.push(decoded);
    else if (mimeType.startsWith('text/html')) acc.html.push(decoded);
  }
  for (const child of part.parts ?? []) {
    collectBodies(child, acc);
  }
  return acc;
}
