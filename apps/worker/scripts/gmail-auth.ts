import { createServer } from 'node:http';
import { google } from 'googleapis';

/**
 * Gmail OAuth 2.0 refresh token 발급 스크립트 (스펙 6장 인증).
 * 로컬에서 1회 실행 → 출력된 refresh token을 GitHub Secrets(GMAIL_REFRESH_TOKEN)에 저장.
 *
 * 사용법:
 *   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... pnpm --filter @apply-manager/worker gmail-auth
 *
 * Google Cloud Console에서 OAuth 클라이언트(데스크톱 앱 또는 웹 앱)를 만들고,
 * 웹 앱 타입이면 승인된 리디렉션 URI에 http://localhost:53682/oauth2/callback 을 추가한다.
 */

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars are required');
  process.exit(1);
}

const port = Number(process.env.GMAIL_AUTH_PORT ?? '53682');
const redirectUri = `http://localhost:${port}/oauth2/callback`;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // refresh token을 항상 재발급받기 위해
  scope: ['https://www.googleapis.com/auth/gmail.readonly'],
});

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname !== '/oauth2/callback') {
      res.writeHead(404).end('not found');
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (error || !code) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`인증 실패: ${error ?? 'code 파라미터 없음'}`);
      console.error(`OAuth callback error: ${error ?? 'missing code'}`);
      server.close();
      process.exitCode = 1;
      return;
    }
    try {
      const { tokens } = await oauth2.getToken(code);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>인증 완료</h1><p>터미널에서 refresh token을 확인하세요. 이 창은 닫아도 됩니다.</p>');
      if (!tokens.refresh_token) {
        console.error(
          'refresh token이 응답에 없습니다. Google 계정 보안 설정에서 이 앱의 기존 액세스 권한을 삭제한 뒤 다시 시도하세요.',
        );
        process.exitCode = 1;
      } else {
        console.log('\n=== Gmail refresh token 발급 완료 ===');
        console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('\n위 값을 GitHub repository secrets에 저장하세요.');
      }
    } catch (tokenError) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('토큰 교환 실패 — 터미널 로그를 확인하세요.');
      console.error('token exchange failed:', tokenError);
      process.exitCode = 1;
    }
    server.close();
  })();
});

server.listen(port, () => {
  console.log('브라우저에서 아래 URL을 열어 Google 계정 인증을 진행하세요:\n');
  console.log(authUrl);
  console.log(`\n(로컬 콜백 대기 중: ${redirectUri})`);
});
