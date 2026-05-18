// 获取 Socket.IO 连接 URL
// 生产环境（Zeabur 等）：同域名同端口，Socket.IO 挂在 /socket.io 路径
// 本地开发：支持两种模式
//   - 单服务模式（server.cjs）：同端口 3000
//   - 双服务模式（旧 socket-server.js）：3001 端口
export function getSocketUrl(): string {
  if (typeof window === 'undefined') return '';

  // 强制指定旧的 3001 端口时（本地双服务调试用）
  // 可通过 NEXT_PUBLIC_SOCKET_URL 环境变量覆盖
  if (process.env.NEXT_PUBLIC_SOCKET_URL) {
    return process.env.NEXT_PUBLIC_SOCKET_URL;
  }

  // 生产环境 / 单服务模式：同域名同端口
  return window.location.origin;
}

// Socket.IO 连接路径（统一为默认路径）
export const SOCKET_PATH = '/socket.io';
