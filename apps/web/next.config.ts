import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 워크스페이스 패키지는 TS 소스를 그대로 export하므로 Next가 트랜스파일한다.
  transpilePackages: [
    "@apply-manager/db",
    "@apply-manager/scraper",
    "@apply-manager/shared",
  ],
};

export default nextConfig;
