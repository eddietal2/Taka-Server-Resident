type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    ...(meta ?? {}),
  });

  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
