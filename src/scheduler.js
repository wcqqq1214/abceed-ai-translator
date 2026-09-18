// One background job leaves room for an interactive lookup; at most two jobs total.
export class RequestScheduler {
  constructor() { this.queue = []; this.active = 0; this.background = 0; }
  run(task, { priority = 0, signal } = {}) {
    return new Promise((resolve, reject) => {
      const job = { task, priority, signal, resolve, reject };
      job.abort = () => {
        const index = this.queue.indexOf(job);
        if (index < 0) return;
        this.queue.splice(index, 1);
        signal?.removeEventListener('abort', job.abort);
        reject(new Error('翻译已暂停。'));
      };
      if (signal?.aborted) { reject(new Error('翻译已暂停。')); return; }
      signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job);
      this.queue.sort((a, b) => b.priority - a.priority);
      this.drain();
    });
  }
  drain() {
    while (this.active < 2) {
      const index = this.queue.findIndex(job => job.priority > 0 || this.background === 0);
      if (index < 0) return;
      const job = this.queue.splice(index, 1)[0];
      job.signal?.removeEventListener('abort', job.abort);
      this.active++;
      if (!job.priority) this.background++;
      Promise.resolve().then(() => {
        if (job.signal?.aborted) throw new Error('翻译已暂停。');
        return job.task();
      }).then(job.resolve, job.reject).finally(() => {
        this.active--;
        if (!job.priority) this.background--;
        this.drain();
      });
    }
  }
  wrap(translate, priority = 0) {
    return (text, config, signal, ...rest) => this.run(() => translate(text, config, signal, ...rest), { priority, signal });
  }
}
