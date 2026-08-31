export interface FormatBytesOptions {
  readonly decimals?: number;
  readonly sizeType?: 'accurate' | 'normal';
}

const NORMAL_BYTE_UNITS = ['Bytes', 'KB', 'MB', 'GB', 'TB'] as const;
const ACCURATE_BYTE_UNITS = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
const BYTES_PER_UNIT = 1024;

export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  const { decimals = 0, sizeType = 'normal' } = options;
  if (bytes === 0) return '0 Byte';
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT));
  const units = sizeType === 'accurate' ? ACCURATE_BYTE_UNITS : NORMAL_BYTE_UNITS;
  const unit = units[unitIndex] ?? 'Bytes';
  return `${(bytes / BYTES_PER_UNIT ** unitIndex).toFixed(decimals)} ${unit}`;
}
