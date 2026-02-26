type LogLevel = 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

function write(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context || {}),
  };

  const serialized = JSON.stringify(entry);
  if (level === 'error') {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export const logger = {
  info(message: string, context?: LogContext) {
    write('info', message, context);
  },
  warn(message: string, context?: LogContext) {
    write('warn', message, context);
  },
  error(message: string, context?: LogContext) {
    write('error', message, context);
  },
};
