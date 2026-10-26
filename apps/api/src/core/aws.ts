/**
 * Shared AWS SDK client options. AWS_ENDPOINT_URL points every client at the local
 * emulator (Floci) in development; on AWS it is unset and the default chain (the ECS
 * task role) supplies credentials.
 */
import { config } from "./config";

export function awsClientConfig(region?: string): { region: string; endpoint?: string; forcePathStyle?: boolean } {
  const endpoint = config.AWS_ENDPOINT_URL;
  return {
    region: region || config.AWS_REGION,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  };
}
