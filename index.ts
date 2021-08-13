'use strict'

declare const Module: EmscriptenModule & {cwrap: typeof cwrap}

interface TargetInfo {
    locator: {
        rect: {
            topPixels: string
            leftPixels: string
            widthPixels: string
            heightPixels: string
        }
    }
}

interface FrameInfo {
    faces: TargetInfo[]
    pedestrians: TargetInfo[]
    vehicles: TargetInfo[]
    nonmotors: TargetInfo[]
}

type ExtendedBlob = Blob & {arrayBuffer: () => Promise<ArrayBuffer>}

const createPlayer = Module.cwrap('create_player', 'number', ['number', 'number', 'number']) as (a: number, b: number, c: number) => number
const destroyPlayer = Module.cwrap('destroy_player', 'number', ['number']) as (a: number) => number
const onPacketData = Module.cwrap('on_packet_data', 'number', ['number', 'number', 'array', 'number']) as (a: number, f: boolean, b: Uint8Array, c: number) => number

const vsSource = `
    precision highp float;

    attribute vec2 aPos;
    attribute vec2 aTexCoord;

    varying vec2 vTexCoord;

    void main() {
      gl_Position = vec4(aPos, 0.0, 1.0);
      vTexCoord = aTexCoord;
    }
`

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
`

export default class WebSocketPlayer {
    private url: string
    private handle: number
    private useWebGL: boolean = false
    private width: number = 1920
    private height: number = 1080
    private lastAttachment?: string

    private ws?: WebSocket
    private gl?: WebGLRenderingContext
    private ctx?: CanvasRenderingContext2D
    private canvas: HTMLCanvasElement
    private maskCanvas: HTMLCanvasElement
    private maskCtx?: CanvasRenderingContext2D
    private program?: WebGLProgram
    private buffers: WebGLBuffer[] = []
    private textures: WebGLTexture[] = []

    constructor(opts: {
        url: string,
        height?: number,
        width?: number,
        useWebGL?: boolean,
        h265?: boolean,
        canvas: HTMLCanvasElement,
        maskCanvas: HTMLCanvasElement,
    }) {
        this.handle = createPlayer(opts.width!, opts.height!, opts.h265 ? 1 : 0)
        this.url = opts.url
        this.canvas = canvas
        this.maskCanvas = maskCanvas
        this.width = opts.width || opts.canvas.width
        this.height = opts.height || opts.canvas.height
        this.useWebGL = opts.useWebGL || false
        this.maskCtx = opts.maskCanvas?.getContext('2d')!

        this.useWebGL ? this.initGL(opts.canvas) : this.init2D(opts.canvas)
        console.log('player handle', this.handle)
    }

    play() {
        this.ws = new WebSocket(this.url)
        this.ws.onopen = (ev) => {
            console.log(ev)
        }
        this.ws.onerror = console.error
        this.ws.onmessage = async (ev) => {
            if (ev.data instanceof Blob) {
                const data = await (ev.data as ExtendedBlob).arrayBuffer()
                this.onVideoData(data)
            } else {
                this.onAttachData(ev.data)
            }
        }
    }

    stop() {
        this.ws!.close()
        this.releaseResources()
        destroyPlayer(this.handle)
    }

    protected onVideoData(data: ArrayBuffer) {
        const pixels = new Uint8Array(data)
        const ptr = onPacketData(this.handle, this.useWebGL, pixels, data.byteLength)
        if (ptr < 0) {
            return
        }

        if (this.useWebGL) {
            const planes = new Uint32Array(Module.HEAPU8.buffer, ptr, 8) // frame->data
            const yPlane = new Uint8Array(Module.HEAPU8.buffer, planes[0], this.height * this.width)
            const uPlane = new Uint8Array(Module.HEAPU8.buffer, planes[1], this.height * this.width / 4)
            const vPlane = new Uint8Array(Module.HEAPU8.buffer, planes[2], this.height * this.width / 4)
            this.updateGLTexture(yPlane, uPlane, vPlane)
        } else {
            const rgbPixels = new Uint8ClampedArray(Module.HEAPU8.buffer, ptr, this.height * this.width * 4) // frame->data[0]
            this.ctx!.clearRect(0, 0, this.width, this.height)
            this.update2DTexture(rgbPixels)
        }

        this.update2DRects(this.lastAttachment!)
    }

    protected onAudioData(_: ArrayBuffer) {

    }

    protected onAttachData(data: any) {
        const info = JSON.parse(data)
        if (info.width) {
            console.log(info)
            this.width = info.width
            this.height = info.height
            this.canvas.width = this.width
            this.canvas.height = this.height
            this.maskCanvas.width = this.width
            this.maskCanvas.height = this.height
        }
        this.lastAttachment = data
    }

    private releaseResources() {
        this.buffers.forEach(buf => this.gl?.deleteBuffer(buf))
        this.textures.forEach(tex => this.gl?.deleteTexture(tex))
    }

    private initGL(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl')!
        this.gl = gl

        gl.clearColor(0.0, 0.0, 0.0, 1.0)  // Clear to black, fully opaque
        gl.clearDepth(1.0)                 // Clear everything
        gl.enable(gl.DEPTH_TEST)           // Enable depth testing
        gl.depthFunc(gl.LEQUAL)            // Near things obscure far things
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1) // handle alignment
        this.program = this.createProgram(vsSource, fsSource)!
        gl.useProgram(this.program)

        const pos = gl.getAttribLocation(this.program, 'aPos')
        const posBuffer = this.createBuffers(pos, [
            -1.0, +1.0, // lt
            +1.0, +1.0, // rt
            -1.0, -1.0, // lb
            +1.0, -1.0, // rb
        ])

        const texCoord = gl.getAttribLocation(this.program, 'aTexCoord')
        const texBuffer = this.createBuffers(texCoord, [
            0.0, 0.0, // lt
            1.0, 0.0, // rt
            0.0, 1.0, // lb
            1.0, 1.0, // rb
        ])

        this.buffers.push(posBuffer, texBuffer)

        this.textures.push(this.createTexture())
        this.textures.push(this.createTexture())
        this.textures.push(this.createTexture())

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    private createShader(type: number, code: string): WebGLShader {
        const gl = this.gl!

        const shader = gl.createShader(type)!
        gl.shaderSource(shader, code)
        gl.compileShader(shader)

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('failed to compile shader: ' + gl.getShaderInfoLog(shader))
            gl.deleteShader(shader)
        }

        return shader
    }

    private createProgram(vs: string, fs: string): WebGLProgram {
        const gl = this.gl!

        const vsShader = this.createShader(gl.VERTEX_SHADER, vs)
        const fsShader = this.createShader(gl.FRAGMENT_SHADER, fs)
        const program = gl.createProgram()!

        gl.attachShader(program, vsShader)
        gl.attachShader(program, fsShader)
        gl.linkProgram(program)
        gl.detachShader(program, vsShader)
        gl.detachShader(program, fsShader)
        gl.deleteShader(vsShader)
        gl.deleteShader(fsShader)

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const error = 'failed to link program: ' + gl.getProgramInfoLog(program)
            console.error(error)
        }

        return program
    }

    private createBuffers(location: number, vetices: ArrayLike<number>): WebGLBuffer {
        const gl = this.gl!

        const buffer = gl.createBuffer()!

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vetices), gl.STATIC_DRAW)
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 8, 0)
        gl.enableVertexAttribArray(location)

        return buffer
    }

    private createTexture(): WebGLTexture {
        const gl = this.gl!

        const texture = gl.createTexture()!

        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

        return texture
    }


    private updateGLTexture(...pixels: Uint8Array[]) {
        const gl = this.gl!
        const program = this.program!

        const [y, u, v] = [0, 1, 2]

        gl.bindTexture(gl.TEXTURE_2D, this.textures[y])
        gl.activeTexture(gl.TEXTURE0 + y)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width, this.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels[y])
        gl.uniform1i(gl.getUniformLocation(program, 'uTexY'), y)

        gl.bindTexture(gl.TEXTURE_2D, this.textures[u])
        gl.activeTexture(gl.TEXTURE0 + u)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width >> 1, this.height >> 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels[u])
        gl.uniform1i(gl.getUniformLocation(program, 'uTexU'), u)

        gl.bindTexture(gl.TEXTURE_2D, this.textures[v])
        gl.activeTexture(gl.TEXTURE0 + v)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width >> 1, this.height >> 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels[v])
        gl.uniform1i(gl.getUniformLocation(program, 'uTexV'), v)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    private init2D(canvas: HTMLCanvasElement) {
        this.ctx = canvas.getContext('2d')!
        this.ctx!.clearRect(0, 0, this.width, this.height)
    }

    private update2DTexture(pixels: Uint8ClampedArray) {
        const ctx = this.ctx!

        const imgData = new ImageData(pixels, this.width, this.height)
        ctx.putImageData(imgData, 0, 0)
    }

    private update2DRects(info: string) {
        if (!this.maskCtx) {
            return
        }

        const ctx = this.maskCtx

        ctx.beginPath()
        ctx.clearRect(0, 0, this.width, this.height)

        const json: FrameInfo = JSON.parse(info)
        const {faces, pedestrians, vehicles, nonmotors} = json;
        [...pedestrians, ...faces, ...vehicles, ...nonmotors].forEach(ped => {
            const {leftPixels: x, topPixels: y, widthPixels: w, heightPixels: h} = ped.locator.rect
            ctx.rect(parseInt(x), parseInt(y), parseInt(w), parseInt(h))
            ctx.strokeStyle = '#00ff00'
            ctx.stroke()
        })
    }
}

const playBtn = document.querySelector('#play')! as HTMLButtonElement
const stopBtn = document.querySelector('#stop')! as HTMLButtonElement
const urlInput = document.querySelector('#url')! as HTMLInputElement
const useGL = document.querySelector('#opengl')! as HTMLInputElement
const h265 = document.querySelector('#codec')! as HTMLInputElement
const canvas = document.querySelector('#myCanvas')! as HTMLCanvasElement
const maskCanvas = document.querySelector('#maskCanvas')! as HTMLCanvasElement

let player: WebSocketPlayer

playBtn.addEventListener('click', () => {
    player = new WebSocketPlayer({
        url: urlInput.value,
        useWebGL: useGL.checked,
        h265: h265.checked,
        canvas,
        maskCanvas,
    })
    player.play()
})

stopBtn.addEventListener('click', () => {
    player.stop()
})
