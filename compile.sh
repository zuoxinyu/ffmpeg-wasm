#!/bin/bash
emcc test.c \
    -o test.html \
    -IFFmpeg \
    -LFFmpeg/libavcodec \
    -LFFmpeg/libavutil \
    -lavcodec \
    -lavutil \
    -lSDL2 \
    --preload-file data \
    -s LLD_REPORT_UNDEFINED \
    -s EXPORTED_RUNTIME_METHODS='[ccall, cwrap]' \
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
