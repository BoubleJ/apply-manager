import { describe, expect, it } from 'vitest';
import { isVerificationOnlyMail } from './classify';
import type { ParsedMail } from './parse-mail';

function mail(subject: string, body = ''): ParsedMail {
  return {
    gmailMessageId: 'test',
    subject,
    from: 'noreply@example.com',
    body,
    receivedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('isVerificationOnlyMail', () => {
  // 실제 수신 메일 문구 (그리팅 no-reply@greetinghr.com) — 회귀 방지용
  it('그리팅 이메일 확인 안내 메일을 거른다', () => {
    expect(
      isVerificationOnlyMail(
        mail(
          '[CJ올리브영] 지원서에 첨부하신 이메일 확인 안내 메일입니다.',
          [
            'CJ올리브영',
            '이메일 주소 확인이 완료되었습니다.',
            '작성 중이시던 지원서 페이지로 돌아가 제출을 이어가 주세요.',
            '지원 공고',
            '코어플랫폼유닛 Front-end 개발채용',
          ].join('\n'),
        ),
      ),
    ).toBe(true);
  });

  it('이메일 인증 완료 + 지원서 계속 작성 안내는 거른다', () => {
    expect(
      isVerificationOnlyMail(
        mail(
          '[그리팅] 이메일 주소 확인이 완료되었습니다',
          '이메일 주소 확인이 완료되었습니다. 아래 버튼을 눌러 지원서를 계속 작성해 주세요.',
        ),
      ),
    ).toBe(true);
  });

  it('제목에만 인증 신호가 있고 본문에 제출 전 신호가 있어도 거른다', () => {
    expect(
      isVerificationOnlyMail(
        mail('이메일 인증 안내', '인증이 완료되면 지원을 완료할 수 있습니다.'),
      ),
    ).toBe(true);
  });

  it('띄어쓰기가 달라도 매칭한다', () => {
    expect(
      isVerificationOnlyMail(
        mail('본인인증 완료 안내', '이어서 작성하실 수 있습니다. 지원서작성을 계속 진행해주세요.'),
      ),
    ).toBe(true);
  });

  it('영문 인증 메일도 거른다', () => {
    expect(
      isVerificationOnlyMail(
        mail(
          'Verify your email address',
          'Your email has been verified. Please continue your application.',
        ),
      ),
    ).toBe(true);
  });

  it('실제 지원 접수 완료 메일은 통과시킨다', () => {
    expect(
      isVerificationOnlyMail(
        mail(
          '[토스] 지원서가 정상적으로 접수되었습니다',
          '지원해 주셔서 감사합니다. 서류 검토 후 결과를 안내드리겠습니다.',
        ),
      ),
    ).toBe(false);
  });

  it('인증 신호만 있고 제출 전 신호가 없으면 자르지 않는다 — LLM 필터에 맡긴다', () => {
    expect(
      isVerificationOnlyMail(
        mail('본인인증 후 면접 일정을 확정해 주세요', '1차 면접 일정 조율을 위해 본인 인증이 필요합니다.'),
      ),
    ).toBe(false);
  });

  it('제출 전 신호만 있고 인증 신호가 없으면 자르지 않는다', () => {
    expect(
      isVerificationOnlyMail(mail('지원서를 제출해 주세요', '마감이 임박했습니다.')),
    ).toBe(false);
  });

  it('전형 결과 메일은 통과시킨다', () => {
    expect(
      isVerificationOnlyMail(
        mail('서류 전형 결과 안내', '아쉽지만 좋은 결과를 드리지 못하게 되었습니다.'),
      ),
    ).toBe(false);
  });
});
