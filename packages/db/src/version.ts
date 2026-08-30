export const expectedMigration = "20260830021619_app_workspace_foundation" as const;

export function migrationNameTimestamp(name: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name);
  if (!match) {
    throw new Error(`Expected migration name is invalid: ${name}`);
  }

  const parts = match.slice(1).map(Number);
  const timestamp = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const date = new Date(timestamp);
  const actualParts = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];

  if (parts.some((part, index) => part !== actualParts[index])) {
    throw new Error(`Expected migration name is invalid: ${name}`);
  }

  return timestamp;
}

export const expectedMigrationTimestamp = migrationNameTimestamp(expectedMigration);
