CC=emcc
LDFLAGS= -LFFmpeg/libavcodec -LFFmpeg/libavutil -lavcodec -lavutil -lSDL2
CFLAGS= -IFFmpeg
EXPORTED_FUNCTIONS='[ "_SDL_RenderCopy", "_SDL_RenderFlush", "_SDL_RenderPresent", "_SDL_UpdateYUVTexture", "_main", "_update_frame", "_on_packet_data", "_create_player", "_create_decoder" ]'

decoder: decoder.c
	./compile.sh
