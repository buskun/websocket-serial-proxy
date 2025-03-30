declare global {
  namespace NodeJS {
    interface ProcessEnv {
      WS_PORT?: string
      BAUD_RATE?: string
    }
  }
}

export {}
