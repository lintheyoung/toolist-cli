export type ImageCompressPreset = 'balanced' | 'small' | 'smallest';

const COMPRESS_QUALITY_BY_PRESET: Record<ImageCompressPreset, number> = {
  balanced: 75,
  small: 55,
  smallest: 35,
};

const DEFAULT_WEBP_QUALITY = COMPRESS_QUALITY_BY_PRESET.small;

export function parseImageCompressPreset(value: string | undefined): ImageCompressPreset {
  if (value === 'balanced' || value === 'small' || value === 'smallest') {
    return value;
  }

  throw new Error('Invalid value for --compress.');
}

export function resolveImageQuality(args: {
  quality?: number;
  compress?: ImageCompressPreset;
  to?: string;
}): number | undefined {
  if (args.quality !== undefined) {
    return args.quality;
  }

  if (args.compress) {
    return COMPRESS_QUALITY_BY_PRESET[args.compress];
  }

  const target = args.to?.trim().toLowerCase();

  return target === 'webp' || target === 'image/webp' ? DEFAULT_WEBP_QUALITY : undefined;
}
