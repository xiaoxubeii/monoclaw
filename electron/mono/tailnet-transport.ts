import { EventEmitter } from 'node:events';
import net from 'node:net';
import type { MonoFrame } from '@mono/types';
import { decodeFrame, encodeFrame } from '@mono/protocol';

export class TailnetJsonConnection extends EventEmitter {
  private readonly socket: net.Socket;
  private buffer = '';
  private readonly frameQueue: MonoFrame[] = [];
  private readonly waiters: Array<{
    resolve: (frame: MonoFrame) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => this.handleChunk(chunk));
    this.socket.on('error', (error) => this.failWaiters(error instanceof Error ? error : new Error(String(error))));
    this.socket.on('close', () => this.failWaiters(new Error('Connection closed')));
  }

  get remoteAddress(): string | undefined {
    return this.socket.remoteAddress ?? undefined;
  }

  get remotePort(): number | undefined {
    return this.socket.remotePort ?? undefined;
  }

  async sendFrame(frame: MonoFrame): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(encodeFrame(frame), (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async nextFrame(timeoutMs = 10000): Promise<MonoFrame> {
    const queued = this.frameQueue.shift();
    if (queued) {
      return queued;
    }

    return new Promise<MonoFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeWaiter(resolve);
        reject(new Error(`Timed out waiting for mono frame after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }

  private removeWaiter(resolve: (frame: MonoFrame) => void): void {
    const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
    }
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const delimiterIndex = this.buffer.indexOf('\n');
      if (delimiterIndex < 0) break;
      const rawLine = this.buffer.slice(0, delimiterIndex).trim();
      this.buffer = this.buffer.slice(delimiterIndex + 1);
      if (!rawLine) continue;

      let frame: MonoFrame;
      try {
        frame = decodeFrame(rawLine);
      } catch (error) {
        const decodeError = error instanceof Error
          ? error
          : new Error(String(error));
        this.failWaiters(decodeError);
        this.emit('error', decodeError);
        this.close();
        return;
      }
      const waiter = this.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(frame);
      } else {
        this.frameQueue.push(frame);
      }
    }
  }

  private failWaiters(error: Error): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

export class TailnetTransport {
  private server: net.Server | null = null;
  private listenerPort: number | null = null;

  async startListener(port: number, onConnection: (connection: TailnetJsonConnection) => void): Promise<number> {
    if (this.server && this.listenerPort) {
      return this.listenerPort;
    }

    this.server = net.createServer((socket) => {
      onConnection(new TailnetJsonConnection(socket));
    });

    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => {
        this.server?.off('listening', handleListening);
        reject(error);
      };
      const handleListening = () => {
        this.server?.off('error', handleError);
        resolve();
      };
      this.server?.once('error', handleError);
      this.server?.once('listening', handleListening);
      this.server?.listen(port, '0.0.0.0');
    });

    const address = this.server.address();
    this.listenerPort = typeof address === 'object' && address ? address.port : port;
    return this.listenerPort;
  }

  async stopListener(): Promise<void> {
    if (!this.server) return;
    const current = this.server;
    this.server = null;
    this.listenerPort = null;
    await new Promise<void>((resolve, reject) => {
      current.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async connect(host: string, port: number, timeoutMs = 8000): Promise<TailnetJsonConnection> {
    return new Promise<TailnetJsonConnection>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy(new Error(`Timed out connecting to ${host}:${port}`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        socket.off('error', handleError);
        socket.off('connect', handleConnect);
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const handleConnect = () => {
        cleanup();
        resolve(new TailnetJsonConnection(socket));
      };

      socket.once('error', handleError);
      socket.once('connect', handleConnect);
    });
  }
}
