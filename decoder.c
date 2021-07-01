#include <libavcodec/avcodec.h>
#include <libswscale/swscale.h>
#include <SDL2/SDL.h>

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

    // window stuff
    SDL_Window* win;
    SDL_Texture* texture;
    SDL_Renderer* renderer;
    SDL_Texture* text_texture;
    SDL_Surface* attr_surface;

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

int create_decoder(Player* player) {
    int ret;

    player->codec = avcodec_find_decoder(player->codec_id);
    if (!player->codec) {
        fprintf(stdout, "avcodec_find_decoder: can't find codec: %d\n", player->codec_id);
        return -1;
    }

    player->avctx = avcodec_alloc_context3(player->codec);
    if (!player->avctx) {
        fprintf(stdout, "avcodec_alloc_context3: can't alloc\n");
        return -1;
    }

    ret = avcodec_open2(player->avctx, player->codec, NULL);
    if (ret < 0) {
        fprintf(stdout, "avcodec_open2: %s\n", av_err2str(ret));
        return -1;
    }

    player->packet = av_packet_alloc();
    if (!player->packet) {
        fprintf(stdout, "av_packet_alloc\n");
        return -1;
    }

    player->frame = av_frame_alloc();
    if (!player->frame) {
        fprintf(stdout, "av_frame_alloc\n");
        return -1;
    }

    player->dst_frame = av_frame_alloc();
    if (!player->frame) {
        fprintf(stdout, "av_frame_alloc\n");
        return -1;
    }
    player->dst_frame->width = 1920;
    player->dst_frame->height = 1080;
    player->dst_frame->format = AV_PIX_FMT_RGBA;
    av_frame_get_buffer(player->dst_frame, 0);

    return 0;
}

Player* create_player() {
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
    player->x = SDL_WINDOWPOS_UNDEFINED;
    player->y = SDL_WINDOWPOS_UNDEFINED;
    player->fps = 25;
    sprintf(player->title, "wasm player");

    int ret = 0;

    // ret = create_window(player);
    // if (ret < 0) {
    //     goto FAIL;
    // }

    ret = create_decoder(player);
    if (ret < 0) {
        goto FAIL;
    }

    return player;

FAIL:
    // destroy_player(player);
    return NULL;
}


int create_window(Player* player) {
    int ret;
    player->win = SDL_CreateWindow(player->title, player->x, player->y, player->w, player->h,
                                   SDL_WINDOW_SHOWN | 0);
    if (!player->win) {
        fprintf(stdout, "SDL_CreateWindow: %s\n", SDL_GetError());
        return -1;
    }

    player->renderer = SDL_CreateRenderer(player->win, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
    if (!player->renderer) {
        fprintf(stdout, "SDL_CreateRenderer: %s\n", SDL_GetError());
        return -1;
    }

    ret = SDL_SetRenderDrawBlendMode(player->renderer, SDL_BLENDMODE_BLEND);
    if (ret < 0) {
        fprintf(stdout, "SDL_SetRenderDrawBlendMode: %s\n", SDL_GetError());
        return -1;
    }

    player->attr_surface = SDL_CreateRGBSurface(0, 200, 200, 8, 0, 0, 0, 0);
    if (!player->attr_surface) {
        fprintf(stdout, "SDL_CreateRGBSurface: %s\n", SDL_GetError());
        return -1;
    }

    // TODO: detect frame format or sws convert each frame
    player->texture =
        SDL_CreateTexture(player->renderer, SDL_PIXELFORMAT_IYUV, SDL_TEXTUREACCESS_STREAMING, player->w, player->h);
    if (!player->texture) {
        fprintf(stdout, "SDL_CreateTexture: %s\n", SDL_GetError());
        return -1;
    }

    return 0;
}


int update_frame(Player* player) {
#ifdef USE_ADAPTIVE_DELAYING
    int32_t start = SDL_GetTicks();
#endif
    int ret;
    int ystride, ustride, vstride;
    uint8_t *y, *u, *v;
    uint8_t* buff = NULL;
    AVFrame* f = player->frame;
    enum AVPixelFormat fmt = f->format;

    player->sws_ctx = sws_getCachedContext(
            player->sws_ctx,
            f->width,
            f->height,
            AV_PIX_FMT_YUV420P,
            f->width,
            f->height,
            AV_PIX_FMT_RGBA,
            0, NULL, NULL, NULL);

    ret = sws_scale(
            player->sws_ctx,
            (const uint8_t* const*)f->data,
            f->linesize,
            0,
            f->height,
            player->dst_frame->data,
            player->dst_frame->linesize);

    if (ret < 0) {
        fprintf(stdout, "failed to sws_scale: %s\n", av_err2str(ret));
    }

    return player->dst_frame->data[0];

    player->period_frame_count++;
    player->last_tick = SDL_GetTicks();
    if (player->start_tick == 0) {
        // printf("decoded frame format: %s\n", av_get_pix_fmt_name(player->frame->format));
        player->start_tick = player->last_tick;
    }
    if (player->period_start_tick == 0) {
        player->period_start_tick = player->last_tick;
    }
    // update_stats(player);

    // update_rects(player);

    /*
    SDL_RenderPresent(player->renderer);
    SDL_RenderFlush(player->renderer);
    */

#ifdef USE_ADAPTIVE_DELAYING
    uint32_t delay = SDL_min(abs(1000 / player->fps - (int32_t)(SDL_GetTicks() - start)), 40);
#else
    uint32_t delay = 20;
#endif
    // make render smoothly. 20 is a chosen value, since
    // during decoding h265, x265 require reading frames
    // ASAP, otherwise frames discarding would happen.
    SDL_Delay(delay);

    return ret;
}

int on_packet_data(Player* player, void* data, size_t size) {
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

        return update_frame(player);
    }

    fprintf(stdout, "avcodec_receive_frame: %s\n", av_err2str(ret));
    return 0;
}

int main(void) {
#ifdef RUNMAIN
    Player *player = create_player();
    if (!player) {
        fprintf(stdout, "failed to create player\n");
        exit(0);
    } else {
        printf("created\n");
    }
    int ret = create_window(player);
    if (ret < 0) {
        fprintf(stdout, "failed to create window\n");
        exit(0);
    }

    char fname[20] = {0};
    static char buf[1024*1024] = {0};
    for (int i = 0; i < 183; i++) {
        sprintf(fname, "data/pkt-%04d", i);
        FILE *pkt = fopen(fname, "r");
        if (!pkt) {
            fprintf(stdout, "failed to open file: %s\n", fname);
            break;
        }
        size_t size = fread(buf, 1, 1024*1024, pkt);
        printf("size: %ld\n", size);
        ret = on_packet_data(player, buf, size);
        if (ret < 0) {
            fprintf(stdout, "error to decode\n");
        }
    }
#else
    printf("main load\n");
#endif
}


