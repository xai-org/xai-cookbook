declare namespace NodeJS {
  export interface ProcessEnv {
    API_URL: string;
    XAI_API_KEY: string;
    HOSTNAME: string;
    PORT?: string;
    PLIVO_AUTH_ID?: string;
    PLIVO_AUTH_TOKEN?: string;
    PLIVO_PHONE_NUMBER?: string;
    PLIVO_APP_ID?: string;
    PLIVO_APP_NAME?: string;
    AUTO_PROVISION?: string;
    TARGET_PHONE_NUMBER?: string;
    ENABLE_TOOLS?: string;
  }
}
