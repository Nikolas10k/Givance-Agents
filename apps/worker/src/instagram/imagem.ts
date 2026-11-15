import sharp from 'sharp';
import type { InstagramCrop, InstagramFormat } from '@givance/tools';

/**
 * Prepara fotos para o Instagram: JPEG (único formato aceito pela API), orientação corrigida
 * pelo EXIF, largura até 1440 px e proporção dentro do que cada formato aceita. O recorte usa
 * o foco "attention" do sharp, que tende a manter o assunto principal na imagem.
 */

const PROPORCOES: Record<Exclude<InstagramCrop, 'original'>, number> = {
  '1:1': 1,
  '4:5': 0.8,
  '9:16': 9 / 16,
};

/** Limites de proporção (largura/altura) de foto no feed e no carrossel. */
const FEED_MIN = 0.8;
const FEED_MAX = 1.91;
const LARGURA_MAX = 1440;

export interface ImageInfo {
  width: number;
  height: number;
}

export async function imageInfo(data: Uint8Array): Promise<ImageInfo | null> {
  try {
    const meta = await sharp(data).metadata();
    if (!meta.width || !meta.height) return null;
    // Orientações 5 a 8 do EXIF giram 90°: largura e altura trocam.
    const girada = (meta.orientation ?? 1) >= 5;
    return girada
      ? { width: meta.height, height: meta.width }
      : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/** Proporção final (largura/altura) para um recorte, a partir da proporção da foto. */
export function targetAspect(
  crop: InstagramCrop,
  format: InstagramFormat,
  original: number,
): number | null {
  if (crop !== 'original') return PROPORCOES[crop];
  if (format === 'story') return null;
  if (original < FEED_MIN) return FEED_MIN;
  if (original > FEED_MAX) return FEED_MAX;
  return null;
}

export async function prepareImage(
  data: Uint8Array,
  options: { crop: InstagramCrop; format: InstagramFormat; aspect?: number | null },
): Promise<{ data: Buffer; width: number; height: number }> {
  const base = sharp(data, { failOn: 'error' }).rotate();
  const info = await imageInfo(data);
  if (!info) throw new Error('Não consegui ler a imagem.');
  const original = info.width / info.height;
  const aspect =
    options.aspect !== undefined
      ? options.aspect
      : targetAspect(options.crop, options.format, original);

  let pipeline = base;
  let width = Math.min(info.width, LARGURA_MAX);
  let height = Math.round(width / original);
  if (aspect && Math.abs(aspect - original) > 0.01) {
    // Recorta sem ampliar: a dimensão que sobra é cortada.
    if (aspect > original) {
      width = Math.min(info.width, LARGURA_MAX);
      height = Math.round(width / aspect);
    } else {
      height = Math.min(info.height, Math.round(LARGURA_MAX / aspect));
      width = Math.round(height * aspect);
    }
    pipeline = pipeline.resize({ width, height, fit: 'cover', position: sharp.strategy.attention });
  } else if (info.width > LARGURA_MAX) {
    pipeline = pipeline.resize({ width });
  }
  const out = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
  return { data: out, width, height };
}
