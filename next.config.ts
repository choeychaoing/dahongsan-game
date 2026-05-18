import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 不使用 standalone，使用自定义 server.cjs 统一启动
  // standalone 模式不支持自定义 HTTP server（无法附加 Socket.IO）
};

export default nextConfig;
