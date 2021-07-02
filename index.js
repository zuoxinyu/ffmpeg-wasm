'use strict'

const createPlayer = Module.cwrap('create_player', 'number', [])
const destroyPlayer = Module.cwrap('destroy_player', 'number', ['number'])
const onPacketData = Module.cwrap('on_packet_data', 'number', ['number', 'array', 'number'])

// const canvas = document.createElement('canvas')
const canvas = document.querySelector('#myCanvas')
const ctx = canvas.getContext('2d')
const gl = canvas.getContext('webgl')

const width = 1920, height = 1080
const vsSource = `
    attribute vec4 aVertexPosition;

    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;

    void main() {
      gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
    }
`

const fsSource = `
    void main() {
      gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    }
`

function createShader(gl, type, code) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, code)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('failed to compile shader: ' + gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }

  return shader
}

function createProgram(gl, vs, fs) {
  const vsShader = createShader(gl, gl.VERTEXT_SHADER, vs)
  const fsShader = createShader(gl, gl.FRAGMENT_SHADER, fs)

  const program = gl.createProgram()
  gl.attachShader(program, vsShader)
  gl.attachShader(program, fsShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('failed to link program: ' + gl.getProgramInfoLog(program))
    return null
  }

  return program
}

function createBuffers(gl, positions) {
  const positionBuffer = gl.createBuffer()

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array(positions),
    gl.STATIC_DRAW)

  return {
    position: positionBuffer,
  }
}

function renderFrameGL(gl, pixels) {
  const program = createProgram(gl, vsSource, fsSource)
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.activeTexture(gl.TEXTURE_2D)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.useProgram(program)
}

function renderFrame2D(ctx, player, pixels) {
  const data = new Uint8Array(pixels)
  const ptr = onPacketData(player, data, pixels.byteLength)
  if (ptr < 0) {
    return false
  }
  const heapBytes = new Uint8ClampedArray(Module.HEAPU8.buffer, ptr, width * height * 4);
  const imgData = new ImageData(heapBytes, width, height)
  ctx.putImageData(imgData, 0, 0)
  return true
}

function renderRects2D(ctx, player, info) {
  const json = JSON.parse(info)
  const {faces, pedestrians, vehicles, nonmotors} = json
  pedestrians.forEach(ped => {
    const {leftPixels: x, topPixels: y, widthPixels: w, heightPixels: h} = ped.locator.rect
    ctx.rect(x, y, w, h)
    ctx.strokeStyle = '#00ff00'
    ctx.stroke()
  })
}

let lastJson = null

const player = {
  ws: null,
  ptr: null,
}

function play(url) {
  const ptr = createPlayer()
  console.log('player ptr', ptr)
  const ws = new WebSocket(url)
  ws.onopen = console.log
  ws.onerror = console.error
  ws.onmessage = (ev) => {
    if (ev.data instanceof Blob) {
      ev.data.arrayBuffer().then(data => {
        ctx.beginPath()
        ctx.clearRect(0, 0, width, height)
        if (renderFrame2D(ctx, ptr, data)) {
          renderRects2D(ctx, ptr, lastJson)
        }
      })
    } else {
      lastJson = ev.data
    }
  }

  player.ws = ws
  player.ptr = ptr
}

function stop() {
  player.ws.close()
  destroyPlayer(player.ptr)
  player.ws = null
  player.ptr = null
}

const playBtn = document.querySelector('#play')
const stopBtn = document.querySelector('#stop')
const urlInput = document.querySelector('#url')

playBtn.addEventListener('click', () => {
  play(urlInput.value)
})

stopBtn.addEventListener('click', () => {
  stop()
})

