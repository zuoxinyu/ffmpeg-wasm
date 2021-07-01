#!/bin/bash
EXTRA_ARGS=
#EXTRA_ARGS='--pre-js main.js'
emcc decoder.c \
    -o decoder.html \
    -IFFmpeg \
    -LFFmpeg/libavcodec \
    -LFFmpeg/libavutil \
    -LFFmpeg/libswscale \
    -lavcodec \
    -lavutil \
    -lswscale \
    -lSDL2 \
    $EXTRA_ARGS \
    --preload-file data \
    -s LLD_REPORT_UNDEFINED \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_RUNTIME_METHODS='[ccall, cwrap, getValue, setValue]' \
    -s EXPORTED_FUNCTIONS='[
        "_SDL_RenderCopy",
        "_SDL_RenderFlush",
        "_SDL_RenderPresent",
        "_SDL_UpdateYUVTexture",
        "_main",
        "_update_frame",
        "_on_packet_data",
        "_create_player",
        "_create_decoder"
        ]'


