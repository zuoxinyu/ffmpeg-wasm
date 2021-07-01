console.log('run')
const wsUrl = 'ws://10.122.100.206:8080/v5/videos/6cb2c55d-1689-49d9-a013-e6ccb2a81a6a/stream?view=pvf'
const canvas = document.getElementById('myCanvas')
const ctx = canvas.getContext('2d')
const createPlayer = Module.cwrap('create_player', 'number', [])
const createDecoder = Module.cwrap('create_decoder', 'number', ['number'])
const onPacketData = Module.cwrap('on_packet_data', 'number', ['number', 'array', 'number'])


function createConnection(url) {
  const player = createPlayer()
  console.log('player ptr', player)
  createDecoder(player)
  const ws = new WebSocket(url)
  ws.onopen = console.log
  ws.onerror = console.error
  ws.onmessage = (ev) => {
    if (ev.data instanceof Blob) {
      // console.log(ev.data)
      ev.data.arrayBuffer().then(data => {
        let arr = new Uint8Array(data)
        const ptr = onPacketData(player, arr, data.byteLength)
        if (ptr > 0) {
          const heapBytes = new Uint8ClampedArray(Module.HEAPU8.buffer, ptr, 1920 * 1080 * 4);
          const imgData = new ImageData(heapBytes, 1920, 1080)
          ctx.putImageData(imgData, 0, 0)
        }
      })
    } else {
      // console.log(ev.data)
    }
  }
}
