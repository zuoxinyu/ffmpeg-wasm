'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const createPlayer = Module.cwrap('create_player', 'number', ['number', 'number', 'number']);
const destroyPlayer = Module.cwrap('destroy_player', 'number', ['number']);
const onPacketData = Module.cwrap('on_packet_data', 'number', ['number', 'number', 'array', 'number']);
const vsSource = `
    precision highp float;

    attribute vec2 aPos;
    attribute vec2 aTexCoord;

    varying vec2 vTexCoord;

    void main() {
      gl_Position = vec4(aPos, 0.0, 1.0);
      vTexCoord = aTexCoord;
    }
`;
const fsSource = `
    precision highp float;

    varying vec2 vTexCoord;

    uniform sampler2D uTexY;
    uniform sampler2D uTexU;
    uniform sampler2D uTexV;

    void main() {
      vec3 yuv;
      vec3 rgb;
      yuv.x = texture2D(uTexY, vTexCoord).r;
      yuv.y = texture2D(uTexU, vTexCoord).r - 0.5;
      yuv.z = texture2D(uTexV, vTexCoord).r - 0.5;
      rgb = mat3( 1,       1,         1,
                  0,       -0.39465,  2.03211,
                  1.13983, -0.58060,  0) * yuv;
      gl_FragColor = vec4(rgb, 1);
    }
`;
export default class WebSocketPlayer {
    constructor(opts) {
        var _a;
        this.useWebGL = false;
        this.width = 1920;
        this.height = 1080;
        this.buffers = [];
        this.textures = [];
        this.handle = createPlayer(opts.width, opts.height, opts.h265 ? 1 : 0);
        this.url = opts.url;
        this.canvas = canvas;
        this.maskCanvas = maskCanvas;
        this.width = opts.width || opts.canvas.width;
        this.height = opts.height || opts.canvas.height;
        this.useWebGL = opts.useWebGL || false;
        this.maskCtx = (_a = opts.maskCanvas) === null || _a === void 0 ? void 0 : _a.getContext('2d');
        this.useWebGL ? this.initGL(opts.canvas) : this.init2D(opts.canvas);
        console.log('player handle', this.handle);
    }
    play() {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = (ev) => {
            console.log(ev);
        };
        this.ws.onerror = console.error;
        this.ws.onmessage = (ev) => __awaiter(this, void 0, void 0, function* () {
            if (ev.data instanceof Blob) {
                const data = yield ev.data.arrayBuffer();
                this.onVideoData(data);
            }
            else {
                this.onAttachData(ev.data);
            }
        });
    }
    stop() {
        this.ws.close();
        this.releaseResources();
        destroyPlayer(this.handle);
    }
    onVideoData(data) {
        const pixels = new Uint8Array(data);
        const ptr = onPacketData(this.handle, this.useWebGL, pixels, data.byteLength);
        if (ptr < 0) {
            return;
        }
        if (this.useWebGL) {
            const planes = new Uint32Array(Module.HEAPU8.buffer, ptr, 8); // frame->data
            const yPlane = new Uint8Array(Module.HEAPU8.buffer, planes[0], this.height * this.width);
            const uPlane = new Uint8Array(Module.HEAPU8.buffer, planes[1], this.height * this.width / 4);
            const vPlane = new Uint8Array(Module.HEAPU8.buffer, planes[2], this.height * this.width / 4);
            this.updateGLTexture(yPlane, uPlane, vPlane);
        }
        else {
            const rgbPixels = new Uint8ClampedArray(Module.HEAPU8.buffer, ptr, this.height * this.width * 4); // frame->data[0]
            this.ctx.clearRect(0, 0, this.width, this.height);
            this.update2DTexture(rgbPixels);
        }
        this.update2DRects(this.lastAttachment);
    }
    onAudioData(_) {
    }
    onAttachData(data) {
        const info = JSON.parse(data);
        if (info.width) {
            console.log(info);
            this.width = info.width;
            this.height = info.height;
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.maskCanvas.width = this.width;
            this.maskCanvas.height = this.height;
        }
        this.lastAttachment = data;
    }
    releaseResources() {
        this.buffers.forEach(buf => { var _a; return (_a = this.gl) === null || _a === void 0 ? void 0 : _a.deleteBuffer(buf); });
        this.textures.forEach(tex => { var _a; return (_a = this.gl) === null || _a === void 0 ? void 0 : _a.deleteTexture(tex); });
    }
    initGL(canvas) {
        const gl = canvas.getContext('webgl');
        this.gl = gl;
        gl.clearColor(0.0, 0.0, 0.0, 1.0); // Clear to black, fully opaque
        gl.clearDepth(1.0); // Clear everything
        gl.enable(gl.DEPTH_TEST); // Enable depth testing
        gl.depthFunc(gl.LEQUAL); // Near things obscure far things
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // handle alignment
        this.program = this.createProgram(vsSource, fsSource);
        gl.useProgram(this.program);
        const pos = gl.getAttribLocation(this.program, 'aPos');
        const posBuffer = this.createBuffers(pos, [
            -1.0, +1.0,
            +1.0, +1.0,
            -1.0, -1.0,
            +1.0, -1.0,
        ]);
        const texCoord = gl.getAttribLocation(this.program, 'aTexCoord');
        const texBuffer = this.createBuffers(texCoord, [
            0.0, 0.0,
            1.0, 0.0,
            0.0, 1.0,
            1.0, 1.0,
        ]);
        this.buffers.push(posBuffer, texBuffer);
        this.textures.push(this.createTexture());
        this.textures.push(this.createTexture());
        this.textures.push(this.createTexture());
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    createShader(type, code) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, code);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('failed to compile shader: ' + gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
        }
        return shader;
    }
    createProgram(vs, fs) {
        const gl = this.gl;
        const vsShader = this.createShader(gl.VERTEX_SHADER, vs);
        const fsShader = this.createShader(gl.FRAGMENT_SHADER, fs);
        const program = gl.createProgram();
        gl.attachShader(program, vsShader);
        gl.attachShader(program, fsShader);
        gl.linkProgram(program);
        gl.detachShader(program, vsShader);
        gl.detachShader(program, fsShader);
        gl.deleteShader(vsShader);
        gl.deleteShader(fsShader);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const error = 'failed to link program: ' + gl.getProgramInfoLog(program);
            console.error(error);
        }
        return program;
    }
    createBuffers(location, vetices) {
        const gl = this.gl;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vetices), gl.STATIC_DRAW);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 8, 0);
        gl.enableVertexAttribArray(location);
        return buffer;
    }
    createTexture() {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return texture;
    }
    updateGLTexture(...pixels) {
        const gl = this.gl;
        const program = this.program;
        const [y, u, v] = [0, 1, 2];
        gl.bindTexture(gl.TEXTURE_2D, this.textures[y]);
        gl.activeTexture(gl.TEXTURE0 + y);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width, this.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels[y]);
        gl.uniform1i(gl.getUniformLocation(program, 'uTexY'), y);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[u]);
        gl.activeTexture(gl.TEXTURE0 + u);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width >> 1, this.height >> 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels[u]);
        gl.uniform1i(gl.getUniformLocation(program, 'uTexU'), u);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[v]);
        gl.activeTexture(gl.TEXTURE0 + v);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width >> 1, this.height >> 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels[v]);
        gl.uniform1i(gl.getUniformLocation(program, 'uTexV'), v);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    init2D(canvas) {
        this.ctx = canvas.getContext('2d');
        this.ctx.clearRect(0, 0, this.width, this.height);
    }
    update2DTexture(pixels) {
        const ctx = this.ctx;
        const imgData = new ImageData(pixels, this.width, this.height);
        ctx.putImageData(imgData, 0, 0);
    }
    update2DRects(info) {
        if (!this.maskCtx) {
            return;
        }
        const ctx = this.maskCtx;
        ctx.beginPath();
        ctx.clearRect(0, 0, this.width, this.height);
        const json = JSON.parse(info);
        const { faces, pedestrians, vehicles, nonmotors } = json;
        [...pedestrians, ...faces, ...vehicles, ...nonmotors].forEach(ped => {
            const { leftPixels: x, topPixels: y, widthPixels: w, heightPixels: h } = ped.locator.rect;
            ctx.rect(parseInt(x), parseInt(y), parseInt(w), parseInt(h));
            ctx.strokeStyle = '#00ff00';
            ctx.stroke();
        });
    }
}
const playBtn = document.querySelector('#play');
const stopBtn = document.querySelector('#stop');
const urlInput = document.querySelector('#url');
const useGL = document.querySelector('#opengl');
const h265 = document.querySelector('#codec');
const canvas = document.querySelector('#myCanvas');
const maskCanvas = document.querySelector('#maskCanvas');
let player;
playBtn.addEventListener('click', () => {
    player = new WebSocketPlayer({
        url: urlInput.value,
        useWebGL: useGL.checked,
        h265: h265.checked,
        canvas,
        maskCanvas,
    });
    player.play();
});
stopBtn.addEventListener('click', () => {
    player.stop();
});
