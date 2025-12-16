declare namespace NodeJS {
  export interface ProcessEnv {
    API_URL: string;
    XAI_API_KEY: string;
    HOSTNAME: string;
    PORT?: string;
  }
}
