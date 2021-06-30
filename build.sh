#!/bin/bash

set -e

#git clone --depth 1 --branch n4.3.1 https://github.com/FFmpeg/FFmpeg

cd FFmpeg

emconfigure ./configure \
    --disable-everything \
    --disable-x86asm \
    --disable-inline-asm \
    --enable-decoder=h264 \
    --enable-decoder=hevc \
    --enable-static \
    --disable-doc \
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
