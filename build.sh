#!/bin/bash

set -e

if [[ -d FFmpeg ]]; then
  echo 'already cloned'
else
  git clone --depth 1 --branch n4.3.1 https://github.com/FFmpeg/FFmpeg
fi

cd FFmpeg

EXTRA_ARGS=--enable-small

emconfigure ./configure \
    --disable-everything \
    --disable-x86asm \
    --disable-inline-asm \
    --enable-decoder=h264 \
    --enable-decoder=hevc \
    --enable-static \
    --disable-doc \
    --disable-network \
    --disable-ffmpeg \
    --disable-ffprobe \
    --disable-ffplay \
    --cc=emcc \
    --ar=emar \
    --cxx=em++ \
    --objcc=emcc \
    --dep-cc=emcc \
    --ranlib=emranlib

emmake make -j
