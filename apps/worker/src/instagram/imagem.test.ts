import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { imageInfo, prepareImage, targetAspect } from './imagem';

async function foto(width: number, height: number, format: 'png' | 'jpeg' = 'png') {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  });
  return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

describe('preparo de fotos para o Instagram', () => {
  it('proporção alvo: recorte pedido vale; original fica dentro dos limites do feed', () => {
    expect(targetAspect('4:5', 'feed', 1.5)).toBe(0.8);
    expect(targetAspect('original', 'feed', 1.2)).toBeNull();
    expect(targetAspect('original', 'feed', 0.5)).toBe(0.8);
    expect(targetAspect('original', 'carrossel', 3)).toBe(1.91);
    expect(targetAspect('original', 'story', 0.5)).toBeNull();
  });

  it('recorta 4:5 a partir de uma foto deitada e converte para JPEG', async () => {
    const r = await prepareImage(await foto(2000, 1000), { crop: '4:5', format: 'feed' });
    const meta = await sharp(r.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([800, 1000]);
    expect(r.width / r.height).toBeCloseTo(0.8, 2);
  });

  it('foto muito alta no feed vira 4:5; foto grande é reduzida para 1440 de largura', async () => {
    const alta = await prepareImage(await foto(1000, 3000), { crop: 'original', format: 'feed' });
    expect(alta.width / alta.height).toBeCloseTo(0.8, 2);
    const grande = await prepareImage(await foto(4000, 3000, 'jpeg'), {
      crop: 'original',
      format: 'feed',
    });
    expect([grande.width, grande.height]).toEqual([1440, 1080]);
  });

  it('story 9:16 e lê dimensões; arquivo que não é imagem falha', async () => {
    const story = await prepareImage(await foto(1080, 1080), { crop: '9:16', format: 'story' });
    expect(story.width / story.height).toBeCloseTo(9 / 16, 2);
    expect(await imageInfo(await foto(30, 20))).toEqual({ width: 30, height: 20 });
    expect(await imageInfo(new TextEncoder().encode('não é imagem'))).toBeNull();
    await expect(
      prepareImage(new TextEncoder().encode('x'), { crop: '1:1', format: 'feed' }),
    ).rejects.toThrow();
  });
});
