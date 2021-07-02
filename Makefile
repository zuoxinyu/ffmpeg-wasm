CC=emcc
LDFLAGS= -LFFmpeg/libavcodec -LFFmpeg/libavutil -lavcodec -lavutil 
CFLAGS= -IFFmpeg
EXPORTED_FUNCTIONS='[ "_main", "_on_packet_data", "_create_player" ]'

decoder: decoder.c
	./compile.sh
