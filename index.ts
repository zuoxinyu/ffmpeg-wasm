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

export default class WebSocketPlayer {
    private url: string
    private ptr: number
    private useWebGL: boolean = false
    private ws: WebSocket | null = null
    private gl: WebGLRenderingContext | null = null
    private ctx: CanvasRenderingContext2D | null = null
    private lastJson: string | null = null

    constructor(url: string, canvas: HTMLCanvasElement, useWebGL = true) {
        this.ptr = createPlayer()
        this.url = url
        this.ctx = null
        this.useWebGL = useWebGL
        if (this.useWebGL) {
            this.gl = canvas.getContext('webgl')!
        } else {
            this.ctx = canvas.getContext('2d')!
        }
        console.log('player ptr', this.ptr)
    }

    play() {
        this.ws = new WebSocket(this.url)
        this.ws.onopen = console.log
        this.ws.onerror = console.error
        this.ws.onmessage = (ev) => {
            if (ev.data instanceof Blob) {
                (ev.data as Blob & {arrayBuffer: () => Promise<ArrayBuffer>}).arrayBuffer().then((data: ArrayBuffer) => {
                    const pixels = new Uint8Array(data)
                    const ptr = onPacketData(this.ptr, pixels, data.byteLength)
                    if (ptr < 0) {
                        return false
                    }
                    const heapBytes = new Uint8ClampedArray(Module.HEAPU8.buffer, ptr, width * height * 4)
                    if (this.useWebGL) {
                        this.renderFrameGL(heapBytes)
                    } else {
                        this.ctx!.beginPath()
                        this.ctx!.clearRect(0, 0, width, height)
                        if (this.renderFrame2D(heapBytes)) {
                            this.renderRects2D(this.lastJson!)
                        }
                    }
                })
            } else {
                this.lastJson = ev.data
            }
        }
    }

    stop() {
        this.ws!.close()
        destroyPlayer(this.ptr)
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

    private createProgram(vs: string, fs: string): WebGLProgram | null {
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
            console.error('failed to link program: ' + gl.getProgramInfoLog(program))
            return null
        }

        return program
    }

    private createBuffers(positions: ArrayLike<number>) {
        const gl = this.gl!

        gl.enableVertexAttribArray(0)
        const positionBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

        return {
            position: positionBuffer,
        }
    }

    private renderFrameGL(pixels: Uint8ClampedArray) {
        const gl = this.gl!

        //gl.clearColor(1.0, 1.0, 1.0, 1.0)  // Clear to black, fully opaque
        //gl.clearDepth(1.0)                 // Clear everything
        gl.enable(gl.DEPTH_TEST)           // Enable depth testing
        gl.depthFunc(gl.LEQUAL)            // Near things obscure far things

        const program = this.createProgram(vsSource, fsSource)!
        const positions = [
            -1.0, 1.0,
            1.0, 1.0,
            -1.0, -1.0,
            1.0, -1.0,
        ]

        this.createBuffers(positions)
        gl.useProgram(program)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

        {
            const texCoord = gl.getAttribLocation(program, 'aTexCoord')
            gl.enableVertexAttribArray(texCoord)
            const texCoordBuffer = gl.createBuffer()
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                1.0, -1.0,
                -1.0, -1.0,
                1.0, 1.0,
                -1.0, 1.0,
            ]), gl.STATIC_DRAW)
            gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 0, 0)

            const uSampler = gl.getUniformLocation(program, 'uSampler')

            const texture = gl.createTexture()
            gl.bindTexture(gl.TEXTURE_2D, texture)
            // define size and format of level 0
            const level = 0
            const internalFormat = gl.RGBA
            const border = 0
            const format = gl.RGBA
            const type = gl.UNSIGNED_BYTE
            gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
                width, height, border,
                format, type, pixels)

            // set the filtering so we don't need mips
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

            gl.uniform1i(uSampler, gl.TEXTURE_2D)
        }

    }

    private renderFrame2D(pixels: Uint8ClampedArray) {
        const ctx = this.ctx!

        const imgData = new ImageData(pixels, width, height)
        ctx.putImageData(imgData, 0, 0)
        return true
    }

    private renderRects2D(info: string) {
        const ctx = this.ctx!

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

const createPlayer = Module.cwrap('create_player', 'number', []) as () => number
const destroyPlayer = Module.cwrap('destroy_player', 'number', ['number']) as (a: number) => number
const onPacketData = Module.cwrap('on_packet_data', 'number', ['number', 'array', 'number']) as (a: number, b: Uint8Array, c: number) => number

const playBtn = document.querySelector('#play')! as HTMLButtonElement
const stopBtn = document.querySelector('#stop')! as HTMLButtonElement
const urlInput = document.querySelector('#url')! as HTMLInputElement
const useGL = document.querySelector('#opengl')! as HTMLInputElement
const canvas = document.querySelector('#myCanvas')! as HTMLCanvasElement

const width = 1920, height = 1080
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

    uniform sampler2D uSampler;

    void main() {
      gl_FragColor = texture2D(uSampler, vTexCoord);
    }
`

let player: WebSocketPlayer

playBtn.addEventListener('click', () => {
    player = new WebSocketPlayer(urlInput.value, canvas, useGL.checked)
    player.play()
})

stopBtn.addEventListener('click', () => {
    player.stop()
})

