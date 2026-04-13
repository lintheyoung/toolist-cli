export class CliError extends Error {
  code: string;
  status: number;
  details?: unknown;
  requestId?: string;

  constructor({
    code,
    message,
    status,
    details,
    requestId,
  }: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string;
  }) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}
