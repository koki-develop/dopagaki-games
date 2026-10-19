import * as THREE from 'three/webgpu';

/** Canvas 2D に絵を描く手順。ctx の大きさは width × height（CSS ではなく実ピクセル） */
export type Painter = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/**
 * width × height の Canvas に paint で描いて、テクスチャにする。色は sRGB として扱い、ミップマップを作る。
 * DOM のない環境（bun test）では Canvas を作れないので、描かずに 1×1 の白いテクスチャを返す
 */
export function paintedTexture(width: number, height: number, paint: Painter): THREE.Texture {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const ctx = canvas?.getContext('2d') ?? null;
  if (!canvas || !ctx) {
    const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    blank.colorSpace = THREE.SRGBColorSpace;
    blank.needsUpdate = true;
    return blank;
  }
  canvas.width = width;
  canvas.height = height;
  paint(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

/**
 * paintedTexture で作ったテクスチャの Canvas を paint で描き直し、GPU へ送り直す（ミップマップも作り直す）。
 * DOM のない環境で作った 1×1 のテクスチャは描き直せないので投げる
 */
export function repaintTexture(texture: THREE.Texture, paint: Painter): void {
  const canvas = texture.image as unknown;
  const ctx = typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement ? canvas.getContext('2d') : null;
  if (!ctx) throw new Error('the texture was not painted on a canvas');
  paint(ctx, ctx.canvas.width, ctx.canvas.height);
  texture.needsUpdate = true;
}
