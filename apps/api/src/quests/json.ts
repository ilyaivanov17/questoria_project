export type JsonRecord = Record<string, unknown>;

export function asJsonRecord(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
}

export function asOptionList(value: unknown): Array<{ id: string; label: string }> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const option = asJsonRecord(item);
    if (typeof option.id !== 'string' || typeof option.label !== 'string') return [];
    return [{ id: option.id, label: option.label }];
  });
}
