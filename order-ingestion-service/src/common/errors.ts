/**
 * Raised when a raw customer payload cannot be mapped into the canonical
 * shape (missing required field, unmappable status, unparseable date, ...).
 * The pipeline treats these as non-retryable and routes the record to the
 * dead-letter store with the reason attached.
 */
export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormalizationError';
  }
}

/**
 * Raised when a normalized order fails canonical-model validation
 * (class-validator). Also non-retryable; also dead-lettered.
 */
export class ValidationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationFailedError';
  }
}
