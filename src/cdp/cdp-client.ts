import WebSocket from 'ws';

export function formatCDPMessage(id: number, method: string, params?: Record<string, unknown>): string {
  return JSON.stringify({ id, method, params });
}

export class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => {
        this.rejectAllPending(err instanceof Error ? err : new Error(String(err)));
        reject(err);
      });
      this.ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : '';
        this.rejectAllPending(new Error(`WebSocket closed: ${code}${reasonStr ? ` ${reasonStr}` : ''}`));
      });
      this.ws.on('message', (data: WebSocket.RawData) => {
        let msg: any;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (msg && msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      });
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [, { reject }] of this.pending) {
      reject(err);
    }
    this.pending.clear();
  }

  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(formatCDPMessage(id, method, params));
    });
  }

  close(): void {
    this.rejectAllPending(new Error('WebSocket closed'));
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
