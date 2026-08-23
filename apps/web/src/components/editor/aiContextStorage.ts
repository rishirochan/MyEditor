export function parseStoredContextIds(
  raw: string | null,
  availableIds: Set<string>
): string[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !Array.isArray(value) ||
      value.length > 2 ||
      !value.every((id) => typeof id === "string")
    ) {
      return null;
    }
    return value.filter((id) => availableIds.has(id));
  } catch {
    return null;
  }
}
