import { RawData, Server, WebSocket } from 'ws'
import { SerialPort } from 'serialport'

const WS_PORT = process.env.WS_PORT !== undefined ? parseInt(process.env.WS_PORT) : undefined // WebSocket server port
const BAUD_RATE = process.env.BAUD_RATE !== undefined ? parseInt(process.env.BAUD_RATE) : 115200

// Create WebSocket server
const wss = new Server({ port: WS_PORT })
console.log(`WebSocket server started on ws://localhost:${WS_PORT}`)

// Convert Uint8Array to HEX string
function uint8ArrayToHex(uint8Array: Buffer) {
  return Array.from(uint8Array)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ')
}

// Convert HEX string to Uint8Array
function hexToUint8Array(hex: Buffer) {
  const bytes: number[] = []

  hex
    .toString()
    .split(' ')
    .forEach(hexVal => {
      bytes.push(parseInt(hexVal, 16))
    })

  return new Uint8Array(bytes)
}

const connectionMap: Record<string, SerialPort> = {}

async function initiateSerialPortConnection(ws: WebSocket): Promise<{
  serialPort: SerialPort
  deviceName: string
  unbind: () => void
}> {
  const serialPortList = (await SerialPort.list()) as (import('@serialport/bindings-interface').PortInfo & {
    friendlyName?: string
  })[]

  console.log(`Fetched serial port: ${serialPortList.map(port => JSON.stringify(port)).join(', ')}`)
  const validPortList = serialPortList.filter(port => port.vendorId === '3513')
  console.log(`Valid serial port: ${validPortList.map(port => `(${port.path}) ${port.friendlyName}`)}`)

  return new Promise((resolve, reject) => {
    ws.send(`port_list: ${JSON.stringify(validPortList)}`)

    const handleConnection = async (message: RawData) => {
      const connectionString = message.toString()

      console.log(`Rcv message while initialing connection: ${message}`)

      if (connectionString.startsWith('connect: ')) {
        const portName = connectionString.substring(9)

        if (Object.prototype.hasOwnProperty.call(connectionMap, portName))
          await new Promise(resolve => connectionMap[portName].close(resolve))

        const serialPort = new SerialPort({ path: portName, baudRate: BAUD_RATE })

        serialPort.on('open', async () => {
          console.log(`Serial port ${portName} opened at ${BAUD_RATE} baud.`)
          connectionMap[portName] = serialPort

          const device = serialPortList.find(port => port.path === portName)

          resolve({
            serialPort,
            deviceName: device
              ? (device.friendlyName ?? device.serialNumber ?? device.pnpId ?? device.path)
              : 'unknown',
            unbind: () => ws.off('message', handleConnection),
          })
        })

        serialPort.on('error', err => {
          console.error('Serial Port Error:', err.message)
          if (serialPort.isOpen) serialPort.close()
          delete connectionMap[portName]
          reject(err)
        })
      }
    }

    ws.on('message', handleConnection)
  })
}

wss.on('connection', async ws => {
  try {
    const { serialPort, deviceName, unbind } = await initiateSerialPortConnection(ws)
    console.log('New WebSocket connection established')

    // Handle WebSocket messages (Hex → Serial)
    ws.on('message', (message: Buffer) => {
      console.log(`WebSocket → Serial (HEX): ${message}`)

      // Send to Serial Port
      serialPort.write(hexToUint8Array(message), err => {
        if (err) console.error('Error writing to serial:', err.message)
      })
    })

    // Handle Serial Port data (Binary → WebSocket as HEX)
    serialPort.on('data', (data: Buffer) => {
      const hexData = uint8ArrayToHex(data) // Convert binary data to HEX
      console.log(`Serial → WebSocket (HEX): ${hexData}`)

      ws.send(hexData) // Send HEX data to WebSocket
    })

    ws.send(`connected to: ${deviceName}`)
    unbind()

    ws.on('close', () => {
      console.log('WebSocket connection closed')

      if (serialPort.isOpen) {
        serialPort.flush()
        serialPort.close()
      }
    })

    serialPort.on('close', () => {
      console.log('Serial connection closed')

      for (const portName in connectionMap) {
        if (Object.prototype.hasOwnProperty.call(connectionMap, portName)) {
          if (connectionMap[portName] === serialPort) {
            delete connectionMap[portName]
          }
        }
      }

      if (ws.readyState === ws.OPEN) ws.close()
    })

    ws.on('error', () => {
      if (ws.readyState === ws.OPEN) ws.close()
    })
  } catch (err: unknown) {
    ws.send(`error: ${err instanceof Error ? err.message : (err?.toString() ?? 'unknown')}`)
    ws.close()
  }
})
