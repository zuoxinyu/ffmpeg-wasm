#include <libavcodec/avcodec.h>
#include <libswscale/swscale.h>

#include <stdio.h>

const int WIN_HEIGHT = 1080, WIN_WIDTH = 1920;

typedef struct Player {
    // decoding stuff
    enum AVCodecID codec_id;
    AVCodec* codec;
    AVCodecContext* avctx;
    AVPacket* packet;
    AVFrame *frame, *dst_frame;
    AVCodecParserContext* parser;
    struct SwsContext* sws_ctx;

    // window properties
    char* title;
    int w, h, x, y, depth;
    int fps;

    // states
    int paused;
    int fullscreened;
    uint32_t last_tick;
    uint32_t period_start_tick;
    uint32_t start_tick;
    int frame_count;
    int period_frame_count;
    // cJSON* last_frame_results;
} Player;

static int create_decoder(Player* player) {
    int ret;

    return 0;
}

void destroy_decoder(Player* player) {
    /* decoder stuff */
    if (player->frame) {
        av_frame_free(&player->frame);
    }

    if (player->dst_frame) {
        av_frame_free(&player->dst_frame);
    }

    if (player->packet) {
        // av_packet_unref(&player->packet);
    }

    if (player->parser) {
        av_parser_close(player->parser);
    }

    if (player->avctx) {
        avcodec_free_context(&player->avctx);
    }
}

Player* create_player() {
    int ret = 0;

    Player* player = calloc(sizeof(Player), 1);
    if (!player) {
        fprintf(stdout, "failed to calloc player\n");
        return NULL;
    }
    player->title = calloc(256, 1);
    if (!player->title) {
        fprintf(stdout, "failed to calloc title\n");
        return NULL;
    }

    player->codec_id = AV_CODEC_ID_H265;
    player->h = WIN_HEIGHT;
    player->w = WIN_WIDTH;
    player->x = 0;
    player->y = 0;
    player->fps = 25;
    sprintf(player->title, "wasm player");

    player->codec = avcodec_find_decoder(player->codec_id);
    if (!player->codec) {
        fprintf(stdout, "avcodec_find_decoder: can't find codec: %d\n", player->codec_id);
        goto FAIL;
    }

    player->avctx = avcodec_alloc_context3(player->codec);
    if (!player->avctx) {
        fprintf(stdout, "avcodec_alloc_context3: can't alloc\n");
        goto FAIL;
    }

    ret = avcodec_open2(player->avctx, player->codec, NULL);
    if (ret < 0) {
        fprintf(stdout, "avcodec_open2: %s\n", av_err2str(ret));
        goto FAIL;
    }

    player->packet = av_packet_alloc();
    if (!player->packet) {
        fprintf(stdout, "av_packet_alloc\n");
        goto FAIL;
    }

    player->frame = av_frame_alloc();
    if (!player->frame) {
        fprintf(stdout, "av_frame_alloc\n");
        goto FAIL;
    }

    player->dst_frame = av_frame_alloc();
    if (!player->dst_frame) {
        fprintf(stdout, "av_frame_alloc\n");
        goto FAIL;
    }

    player->dst_frame->width = 1920;
    player->dst_frame->height = 1080;
    player->dst_frame->format = AV_PIX_FMT_RGBA;
    av_frame_get_buffer(player->dst_frame, 0);

    if (ret < 0) {
        goto FAIL;
    }

    return player;

FAIL:
    destroy_decoder(player);
    return NULL;
}

void* convert(Player* player) {
    int ret;
    AVFrame* f = player->frame;

    player->sws_ctx = sws_getCachedContext(player->sws_ctx, f->width, f->height, AV_PIX_FMT_YUV420P, f->width,
                                           f->height, AV_PIX_FMT_RGBA, 0, NULL, NULL, NULL);

    ret = sws_scale(player->sws_ctx, (const uint8_t* const*)f->data, f->linesize, 0, f->height, player->dst_frame->data,
                    player->dst_frame->linesize);

    if (ret < 0) {
        fprintf(stdout, "failed to sws_scale: %s\n", av_err2str(ret));
        return NULL;
    }

    return player->dst_frame->data[0];
}

uintptr_t on_packet_data(Player* player, void* data, size_t size) {
    int ret = 0;
#ifndef USE_PARSER_DEMUXING
    ret = av_packet_from_data(player->packet, data, (int)size);
    if (ret < 0) {
        fprintf(stdout, "av_packet_from_data: %s\n", av_err2str(ret));
        return -1;
    }
#else
    int read_len = av_parser_parse2(player->parser, player->avctx, &player->packet->data, &player->packet->size, data,
                                    size, AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
    if (read_len < 0) {
        fprintf(stdout, "av_parser_parse2 error\n");
        return -1;
    }
    if (!player->packet->size) {
        return 0;
    }
#endif
    ret = avcodec_send_packet(player->avctx, player->packet);
    if (ret < 0) {
        if (player->frame_count) /* only warn the errors after the first frame decoded */
            fprintf(stdout, "avcodec_send_packet: %s\n", av_err2str(ret));
        return -1;
    }

    while (ret >= 0) {
        ret = avcodec_receive_frame(player->avctx, player->frame);
        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
            return 0;
        } else if (ret < 0) {
            fprintf(stdout, "avcodec_receive_frame: %s\n", av_err2str(ret));
            return -1;
        }

        player->frame_count++;
        if (player->paused) {
            return 0;
        }

        return (uintptr_t)convert(player);
    }

    fprintf(stdout, "avcodec_receive_frame: %s\n", av_err2str(ret));
    return 0;
}

int main(void) {
    av_log_set_level(AV_LOG_QUIET);
    printf("main load\n");
}
