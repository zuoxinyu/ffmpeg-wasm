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
    $EXTRA_ARGS \
    --preload-file data \
    -s LLD_REPORT_UNDEFINED \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_RUNTIME_METHODS='[ccall, cwrap, getValue, setValue]' \
    -s EXPORTED_FUNCTIONS='[ "_main", "_on_packet_data", "_create_player" ]'

