import { readFile } from 'node:fs/promises';

import { CliError } from '../../lib/errors.js';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function isPng(buffer: Buffer): boolean {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

function readUInt32BE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function isUnsupportedTinyGrayscaleAlphaPng(buffer: Buffer): boolean {
  if (!isPng(buffer) || buffer.length < 26) {
    return false;
  }

  const width = readUInt32BE(buffer, 16);
  const height = readUInt32BE(buffer, 20);
  const colorType = buffer[25];

  return width === 1 && height === 1 && colorType === 4;
}

export async function assertSupportedConvertInputPath(
  inputPath: string,
  dependencies: {
    readFile?: typeof readFile;
  } = {},
): Promise<void> {
  const readFileImpl = dependencies.readFile ?? readFile;
  const fileBuffer = await readFileImpl(inputPath);

  if (!isUnsupportedTinyGrayscaleAlphaPng(fileBuffer)) {
    return;
  }

  throw new CliError({
    code: 'UNSUPPORTED_INPUT_IMAGE',
    message:
      'Unsupported input image: image.convert_format does not currently support 1x1 grayscale+alpha PNG inputs. Convert the file to RGB PNG or JPEG first.',
    status: 400,
  });
}
