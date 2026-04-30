export type ImageCompressPreset = 'balanced' | 'small' | 'smallest';

const COMPRESS_QUALITY_BY_PRESET: Record<ImageCompressPreset, number> = {
  balanced: 75,
  small: 55,
  smallest: 35,
};

export function parseImageCompressPreset(value: string | undefined): ImageCompressPreset {
  if (value === 'balanced' || value === 'small' || value === 'smallest') {
    return value;
  }

  throw new Error('Invalid value for --compress.');
}

export function resolveImageQuality(args: {
  quality?: number;
  compress?: ImageCompressPreset;
}): number | undefined {
  if (args.quality !== undefined) {
    return args.quality;
  }

  return args.compress ? COMPRESS_QUALITY_BY_PRESET[args.compress] : undefined;
}
