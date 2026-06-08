'use strict';

/**
 * VP9/VP8 WebM alpha is only decoded when libvpx decoders are forced before -i.
 * @see https://stackoverflow.com/questions/75788388/how-to-extract-a-single-frame-while-retenaing-transparency-from-a-transparent-vi
 */
function webmDecoderForCodec(codecName) {
  const codec = String(codecName || '').toLowerCase();
  if (codec === 'vp8') return 'libvpx';
  return 'libvpx-vp9';
}

function buildHeroPreviewExtractArgs({ inputPath, outputPath, frameIndex, inputDecoder = 'libvpx-vp9' }) {
  const frame = Math.max(0, Number(frameIndex) || 0);
  return [
    '-y',
    '-c:v', inputDecoder,
    '-i', inputPath,
    '-vf', `select=eq(n\\,${frame}),format=rgba`,
    '-frames:v', '1',
    '-c:v', 'png',
    outputPath,
  ];
}

function pngPixFmtHasAlpha(pixFmt) {
  const fmt = String(pixFmt || '').toLowerCase();
  return fmt.includes('a') || fmt === 'pal8';
}

module.exports = {
  webmDecoderForCodec,
  buildHeroPreviewExtractArgs,
  pngPixFmtHasAlpha,
};
