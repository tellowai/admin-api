'use strict';

const { expect } = require('chai');
const {
  webmDecoderForCodec,
  buildHeroPreviewExtractArgs,
  pngPixFmtHasAlpha,
} = require('../../../modules/templates/utils/hero.preview.ffmpeg');

describe('hero.preview.ffmpeg', () => {
  describe('webmDecoderForCodec', () => {
    it('uses libvpx for vp8', () => {
      expect(webmDecoderForCodec('vp8')).to.equal('libvpx');
    });

    it('uses libvpx-vp9 for vp9 and unknown codecs', () => {
      expect(webmDecoderForCodec('vp9')).to.equal('libvpx-vp9');
      expect(webmDecoderForCodec('')).to.equal('libvpx-vp9');
    });
  });

  describe('buildHeroPreviewExtractArgs', () => {
    it('forces libvpx decoder before input and rgba in filter chain', () => {
      const args = buildHeroPreviewExtractArgs({
        inputPath: '/tmp/in.webm',
        outputPath: '/tmp/out.png',
        frameIndex: 3,
        inputDecoder: 'libvpx-vp9',
      });
      expect(args).to.deep.equal([
        '-y',
        '-c:v', 'libvpx-vp9',
        '-i', '/tmp/in.webm',
        '-vf', 'select=eq(n\\,3),format=rgba',
        '-frames:v', '1',
        '-c:v', 'png',
        '/tmp/out.png',
      ]);
    });
  });

  describe('pngPixFmtHasAlpha', () => {
    it('detects alpha-capable pixel formats', () => {
      expect(pngPixFmtHasAlpha('rgba')).to.equal(true);
      expect(pngPixFmtHasAlpha('rgb24')).to.equal(false);
    });
  });
});
