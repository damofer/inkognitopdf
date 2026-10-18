export const UPSTREAM: string;
export interface RelayRequest {
  method: string;
  contentType: string | undefined;
  body: Uint8Array | undefined;
}
export interface RelayResponse {
  status: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
}
export function relay(
  request: RelayRequest,
  fetchImpl?: typeof fetch,
): Promise<RelayResponse>;
