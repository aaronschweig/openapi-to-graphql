import { OpenAPIObject } from './openapi.interface';

export function getSchema(config: OpenAPIObject) {
  return config?.components?.schemas ?? {};
}
